using ApiCore.Models;
using ApiCore.Data;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using System.IO.Compression;
using System.Security.Cryptography;

namespace ApiCore.Services;
/*
Сервис для парсинга файлов и отправки в ai-driver
*/

public class AnalysisService
{
    private readonly ValidationService _validationService;
    private readonly ILogger<AnalysisService> _logger;
    private readonly FileParser _fileParser;
    private readonly HttpClient _httpClient;
    private readonly AppDbContext _dbContext;
    private readonly IConfiguration _configuration;

    public AnalysisService(ValidationService validationService, 
        ILogger<AnalysisService> logger,
        FileParser fileParser,
        HttpClient httpClient,
        AppDbContext dbContext,
        IConfiguration configuration)
    {
        _validationService = validationService;
        _logger = logger;
        _httpClient = httpClient;
        _fileParser = fileParser;
        _dbContext = dbContext;
        _configuration = configuration;
    }

    public async Task ProcessQueuedAnalysisAsync(string taskId, CancellationToken cancellationToken)
    {
        var report = await _dbContext.AnalysisReports.FindAsync([taskId], cancellationToken);
        if (report?.PayloadJson == null || string.IsNullOrWhiteSpace(report.ModelType))
        {
            if (report != null)
            {
                report.Status = "Failed";
                report.Error = "Не удалось восстановить данные задачи. Запустите анализ повторно.";
                report.UpdatedAt = DateTime.UtcNow;
                await SaveReportAsync(report, cancellationToken);
            }
            return;
        }

        AnalysisJobPayload? payload;
        try
        {
            payload = JsonSerializer.Deserialize<AnalysisJobPayload>(report.PayloadJson);
        }
        catch (JsonException)
        {
            payload = null;
        }
        if (payload == null)
        {
            report.Status = "Failed";
            report.Error = "Сохранённые данные задачи повреждены. Запустите анализ повторно.";
            report.UpdatedAt = DateTime.UtcNow;
            await SaveReportAsync(report, cancellationToken);
            return;
        }

        await ProcessAnalysisAsync(
            taskId,
            report.UserId,
            payload.BenchmarkPath,
            payload.UserResponsePaths,
            report.ModelType,
            payload.TempDirectory,
            cancellationToken,
            payload.CorrelationId);
    }

    public async Task ProcessAnalysisAsync(
        string taskId,
        Guid userId,
        string benchmarkPath,
        List<string> userResponsePaths,
        string modelType,
        string tempDir,
        CancellationToken cancellationToken = default,
        string? correlationId = null)
    {
        _logger.LogInformation("[Task {TaskId}] Начало фоновой обработки пакета файлов.", taskId);
        // Получаем объект отчета из базы данных
        var report = await _dbContext.AnalysisReports.FindAsync([taskId], cancellationToken);
        var cleanupFiles = true;

        try
        {
            if (report?.Status is "Cancelling" or "Cancelled")
            {
                await SaveReportAsync(report, cancellationToken);
                return;
            }
            // 0. Распаковка ZIP архивов, если они присутствуют
            var expandedPaths = new List<string>();
            const int maxArchiveEntries = 200;
            const long maxArchiveUncompressedBytes = 200L * 1024 * 1024;
            var acceptedArchiveEntries = 0;
            long totalArchiveUncompressedBytes = 0;
            foreach (var path in userResponsePaths)
            {
                var ext = Path.GetExtension(path).ToLowerSuffix();
                if (ext == ".zip")
                {
                    _logger.LogInformation($"[Task {taskId}] Обнаружен ZIP-архив: {Path.GetFileName(path)}. Распаковка...");
                    var zipExtractDir = Path.Combine(tempDir, "extracted_" + Path.GetFileNameWithoutExtension(path));
                    Directory.CreateDirectory(zipExtractDir);
                    
                    try
                    {
                        using (var archive = System.IO.Compression.ZipFile.OpenRead(path))
                        {
                            if (archive.Entries.Count > maxArchiveEntries)
                            {
                                throw new InvalidDataException("ZIP-архив превышает безопасный лимит: 200 записей.");
                            }

                            var entryIndex = 0;
                            foreach (var entry in archive.Entries)
                            {
                                entryIndex++;
                                cancellationToken.ThrowIfCancellationRequested();
                                if (string.IsNullOrEmpty(entry.Name)) continue;
                                
                                // Пропускаем системные/скрытые файлы macOS/Windows
                                if (entry.FullName.StartsWith("__MACOSX") || entry.Name.StartsWith("._") || entry.Name.Equals(".DS_Store", StringComparison.OrdinalIgnoreCase))
                                    continue;

                                var nestedExt = Path.GetExtension(entry.Name).ToLowerSuffix();
                                if (nestedExt == ".xlsx" || nestedExt == ".xls" || nestedExt == ".csv")
                                {
                                    acceptedArchiveEntries++;
                                    totalArchiveUncompressedBytes += entry.Length;
                                    if (acceptedArchiveEntries > maxArchiveEntries
                                        || totalArchiveUncompressedBytes > maxArchiveUncompressedBytes)
                                    {
                                        throw new InvalidDataException("ZIP-архив превышает безопасный лимит: 200 файлов или 200 МБ распакованных данных.");
                                    }

                                    // Stable paths on retry keep test/question IDs and checkpoints
                                    // unchanged. A separate directory preserves duplicate filenames.
                                    var entryDirectory = Path.Combine(zipExtractDir, entryIndex.ToString());
                                    Directory.CreateDirectory(entryDirectory);
                                    var destinationPath = Path.Combine(entryDirectory, entry.Name);
                                    entry.ExtractToFile(destinationPath, overwrite: true);
                                    expandedPaths.Add(destinationPath);
                                }
                            }
                        }
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError($"[Task {taskId}] Ошибка распаковки ZIP '{Path.GetFileName(path)}': {ex.Message}");
                        throw new InvalidDataException($"Не удалось безопасно обработать ZIP-архив '{Path.GetFileName(path)}'.", ex);
                    }
                }
                else
                {
                    expandedPaths.Add(path);
                }
            }
            userResponsePaths = expandedPaths;
            if (userResponsePaths.Count == 0)
            {
                throw new InvalidDataException("В загруженных ZIP-архивах нет файлов CSV, XLS или XLSX.");
            }

            // 1. Повторная глубокая валидация в фоне
            var validation = _validationService.ValidateFiles(benchmarkPath, userResponsePaths);
            if (!validation.IsValid)
            {
                var errors = string.Join("; ", validation.Errors);
                _logger.LogError($"[Task {taskId}] Фоновая валидация провалена: {errors}");
                if (report != null)
                {
                    report.Status = "Failed";
                    report.Error = $"Validation failed: {errors}";
                    report.PayloadJson = null;
                    report.UpdatedAt = DateTime.UtcNow;
                    await SaveReportAsync(report, cancellationToken);
                }
                return;
            }

            // 2. Парсинг файла
            _logger.LogInformation($"[Task {taskId}] Запуск циклического парсинга CSV файлов...");
            CourseBatchAnalysisRequest payload = _fileParser.ParseToBatchRequest(benchmarkPath, userResponsePaths);
            payload.BatchId = taskId;
            if (report != null) payload.CourseName = report.CourseName;
            var studentAliases = PseudonymizeStudentIds(payload, taskId);

            // 3. Отправка JSON-контракта в Python AI-Driver
            _logger.LogInformation($"[Task {taskId}] Парсинг завершен. Отправка контракта в ai-driver...");

            var jsonSerializerOptions = new JsonSerializerOptions { WriteIndented = false };
            string jsonString = JsonSerializer.Serialize(payload, jsonSerializerOptions);
            var httpContent = new StringContent(jsonString, Encoding.UTF8, "application/json");

            // Отправляем POST запрос в сервис ai-driver (url берется из конфига docker-compose)
            // Определяем эндпоинт в зависимости от выбранной модели ИИ
            string endpoint = modelType?.ToLower() switch
            {
                "gigachat" or "sbergpt" => "agents/get_sbergpt_data_analysis",
                "local_llm" or "qwen_local" or "qwen" or "local" => "agents/get_local_llm_data_analysis",
                _ => "agents/get_deepseek_data_analysis"
            };

            // Отправляем POST запрос в сервис ai-driver
            using var request = new HttpRequestMessage(HttpMethod.Post, endpoint) { Content = httpContent };
            if (!string.IsNullOrWhiteSpace(correlationId))
                request.Headers.TryAddWithoutValidation("X-Correlation-ID", correlationId);
            using var response = await _httpClient.SendAsync(request, cancellationToken);

            if (response.IsSuccessStatusCode)
            {
                _logger.LogInformation($"[Task {taskId}] Данные успешно доставлены в ai-driver. Получение результатов...");
                string responseBody = await response.Content.ReadAsStringAsync(cancellationToken);
                var result = JsonSerializer.Deserialize<CourseBatchAnalysisResult>(responseBody, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                if (result == null)
                {
                    throw new InvalidDataException("AI-driver вернул пустой или некорректный результат.");
                }
                RestoreStudentIds(result, studentAliases);
                result.PdfData = PdfReportDataBuilder.Build(payload);
                responseBody = JsonSerializer.Serialize(result, jsonSerializerOptions);
                if (report != null)
                {
                    report.Status = "Completed";
                    report.ResultJson = responseBody;
                    report.Error = null;
                    report.PayloadJson = null;
                    report.UpdatedAt = DateTime.UtcNow;
                    await SaveReportAsync(report, cancellationToken);
                }
            }
            else
            {
                string errorContext = await response.Content.ReadAsStringAsync(cancellationToken);
                _logger.LogError($"[Task {taskId}] ai-driver вернул ошибку: {response.StatusCode}. Контекст: {errorContext}");
                var isRetryable = (int)response.StatusCode == 429 || (int)response.StatusCode >= 500;
                var publicError = $"Сервис анализа вернул ошибку {(int)response.StatusCode}. Проверьте настройки выбранной модели и повторите попытку.";
                if (report != null)
                {
                    if (isRetryable && CanRetry(report))
                    {
                        ScheduleRetry(report, publicError);
                        cleanupFiles = false;
                    }
                    else
                    {
                        report.Status = "Failed";
                        report.Error = publicError;
                        report.PayloadJson = null;
                        report.UpdatedAt = DateTime.UtcNow;
                    }
                    await SaveReportAsync(report, cancellationToken);
                }
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            if (report != null)
            {
                if (report.Status == "Completed" && report.ResultJson != null)
                {
                    report.Error = null;
                    report.NextRetryAt = null;
                }
                else if (report.Status == "Failed")
                {
                    report.NextRetryAt = null;
                }
                else if (report.PayloadJson != null && CanRetry(report))
                {
                    report.Status = "Retrying";
                    report.Error = "Обработка продолжится автоматически после запуска сервиса.";
                    report.NextRetryAt = DateTime.UtcNow;
                    cleanupFiles = false;
                }
                else
                {
                    report.Status = "Failed";
                    report.Error = "Анализ прерван после исчерпания разрешённых попыток. Запустите его повторно.";
                    report.PayloadJson = null;
                    report.NextRetryAt = null;
                }
                report.UpdatedAt = DateTime.UtcNow;
                await SaveReportAsync(report, CancellationToken.None);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError($"[Task {taskId}] Критическая ошибка при обработке: {ex.Message}");
            if (report != null)
            {
                if (ex is not InvalidDataException && CanRetry(report))
                {
                    ScheduleRetry(report, "Временная ошибка сервиса анализа. Повтор будет выполнен автоматически.");
                    cleanupFiles = false;
                }
                else
                {
                    report.Status = "Failed";
                    report.Error = ex is InvalidDataException
                        ? ex.Message
                        : "Не удалось выполнить анализ. Проверьте формат файлов и настройки выбранной модели.";
                    report.PayloadJson = null;
                    report.UpdatedAt = DateTime.UtcNow;
                }
                await SaveReportAsync(report, CancellationToken.None);
            }
        }
        finally
        {
            if (report?.Status == "Cancelled") cleanupFiles = true;
            try
            {
                if (cleanupFiles && Directory.Exists(tempDir))
                {
                    Directory.Delete(tempDir, true);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError($"[Task {taskId}] Не удалось удалить временную директорию {tempDir}: {ex.Message}");
            }
        }
    }

    private bool CanRetry(AnalysisReport report)
    {
        var maxAttempts = Math.Clamp(_configuration.GetValue<int?>("AnalysisQueue:MaxAttempts") ?? 3, 1, 10);
        return report.AttemptCount < maxAttempts;
    }

    private async Task SaveReportAsync(AnalysisReport report, CancellationToken token)
    {
        // Cancellation and completion compete in one atomic database update.
        // A late model result or retry can never resurrect a cancelled task.
        var changed = await _dbContext.AnalysisReports
            .Where(item => item.Id == report.Id && item.Status != "Cancelling" && item.Status != "Cancelled")
            .ExecuteUpdateAsync(update => update
                .SetProperty(item => item.Status, report.Status)
                .SetProperty(item => item.ResultJson, report.ResultJson)
                .SetProperty(item => item.Error, report.Error)
                .SetProperty(item => item.PayloadJson, report.PayloadJson)
                .SetProperty(item => item.NextRetryAt, report.NextRetryAt)
                .SetProperty(item => item.UpdatedAt, report.UpdatedAt), token);
        if (changed == 0)
        {
            await _dbContext.AnalysisReports.Where(item => item.Id == report.Id && item.Status == "Cancelling")
                .ExecuteUpdateAsync(update => update
                    .SetProperty(item => item.Status, "Cancelled")
                    .SetProperty(item => item.Error, "Анализ остановлен пользователем.")
                    .SetProperty(item => item.ResultJson, (string?)null)
                    .SetProperty(item => item.PayloadJson, (string?)null)
                    .SetProperty(item => item.NextRetryAt, (DateTime?)null)
                    .SetProperty(item => item.UpdatedAt, DateTime.UtcNow), token);
        }
        await _dbContext.Entry(report).ReloadAsync(token);
    }

    private static void ScheduleRetry(AnalysisReport report, string message)
    {
        report.Status = "Retrying";
        report.Error = message;
        report.NextRetryAt = DateTime.UtcNow.AddSeconds(Math.Min(30, Math.Max(5, report.AttemptCount * 5)));
        report.UpdatedAt = DateTime.UtcNow;
    }

    private Dictionary<string, string> PseudonymizeStudentIds(CourseBatchAnalysisRequest payload, string taskId)
    {
        var secret = _configuration["JwtSettings:Secret"]
            ?? throw new InvalidOperationException("JWT secret is unavailable for pseudonymization.");
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var reverseMap = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var attempt in payload.Tests.SelectMany(test => test.StudentAttempts))
        {
            var original = attempt.StudentId;
            var digest = hmac.ComputeHash(Encoding.UTF8.GetBytes($"{taskId}:{original}"));
            var alias = $"student-{Convert.ToHexString(digest)[..16].ToLowerInvariant()}";
            reverseMap[alias] = original;
            attempt.StudentId = alias;
        }
        return reverseMap;
    }

    private static void RestoreStudentIds(CourseBatchAnalysisResult result, IReadOnlyDictionary<string, string> reverseMap)
    {
        foreach (var detail in result.StudentDetailedAnalyses)
            if (reverseMap.TryGetValue(detail.StudentId, out var original)) detail.StudentId = original;
        foreach (var anomaly in result.Anomalies)
            if (reverseMap.TryGetValue(anomaly.StudentId, out var original)) anomaly.StudentId = original;
    }
}
