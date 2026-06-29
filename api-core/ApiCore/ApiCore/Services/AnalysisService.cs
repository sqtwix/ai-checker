using ApiCore.Models;
using ApiCore.Data;
using System.Text;
using System.Text.Json;
using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using System.IO.Compression;

namespace ApiCore.Services;
/*
Сервис для парсинга файлов и отправки в ai-driver
*/

public class AnalysisService
{
    public static readonly ConcurrentDictionary<string, (string Status, CourseBatchAnalysisResult? Result, string? Error)> TaskTracker = new();

    private readonly ValidationService _validationService;
    private readonly ILogger<AnalysisService> _logger;
    private readonly FileParser _fileParser;
    private readonly HttpClient _httpClient;
    private readonly AppDbContext _dbContext;

    public AnalysisService(ValidationService validationService, 
        ILogger<AnalysisService> logger,
        FileParser fileParser,
        HttpClient httpClient,
        AppDbContext dbContext)  
    {
        _validationService = validationService;
        _logger = logger;
        _httpClient = httpClient;
        _fileParser = fileParser;
        _dbContext = dbContext;
    }

    public async Task ProcessAnalysisAsync(string taskId, Guid userId, string benchmarkPath, List<string> userResponsePaths, string modelType, string tempDir)
    {
        _logger.LogInformation($"[Task {taskId}] Начало фоновой обработки пакета файлов.");
        TaskTracker[taskId] = ("Processing", null, null);

        // Получаем объект отчета из базы данных
        var report = await _dbContext.AnalysisReports.FindAsync(taskId);

        try
        {
            // 0. Распаковка ZIP архивов, если они присутствуют
            var expandedPaths = new List<string>();
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
                            foreach (var entry in archive.Entries)
                            {
                                if (string.IsNullOrEmpty(entry.Name)) continue;
                                
                                // Пропускаем системные/скрытые файлы macOS/Windows
                                if (entry.FullName.StartsWith("__MACOSX") || entry.Name.StartsWith("._") || entry.Name.Equals(".DS_Store", StringComparison.OrdinalIgnoreCase))
                                    continue;

                                var nestedExt = Path.GetExtension(entry.Name).ToLowerSuffix();
                                if (nestedExt == ".xlsx" || nestedExt == ".xls" || nestedExt == ".csv" || nestedExt == ".json")
                                {
                                    var destinationPath = Path.Combine(zipExtractDir, entry.Name);
                                    
                                    // Обработка конфликтов имен файлов
                                    int counter = 1;
                                    while (File.Exists(destinationPath))
                                    {
                                        var nameWithoutExt = Path.GetFileNameWithoutExtension(entry.Name);
                                        destinationPath = Path.Combine(zipExtractDir, $"{nameWithoutExt}_{counter++}{nestedExt}");
                                    }
                                    
                                    entry.ExtractToFile(destinationPath);
                                    expandedPaths.Add(destinationPath);
                                }
                            }
                        }
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError($"[Task {taskId}] Ошибка распаковки ZIP '{Path.GetFileName(path)}': {ex.Message}");
                        throw new Exception($"Не удалось обработать ZIP-архив '{Path.GetFileName(path)}': {ex.Message}");
                    }
                }
                else
                {
                    expandedPaths.Add(path);
                }
            }
            userResponsePaths = expandedPaths;

            // 1. Повторная глубокая валидация в фоне
            var validation = _validationService.ValidateFiles(benchmarkPath, userResponsePaths);
            if (!validation.IsValid)
            {
                var errors = string.Join("; ", validation.Errors);
                _logger.LogError($"[Task {taskId}] Фоновая валидация провалена: {errors}");
                TaskTracker[taskId] = ("Failed", null, $"Validation failed: {errors}");

                if (report != null)
                {
                    report.Status = "Failed";
                    report.Error = $"Validation failed: {errors}";
                    await _dbContext.SaveChangesAsync();
                }
                return;
            }

            // 2. Парсинг файла
            _logger.LogInformation($"[Task {taskId}] Запуск циклического парсинга CSV файлов...");
            CourseBatchAnalysisRequest payload = _fileParser.ParseToBatchRequest(benchmarkPath, userResponsePaths);
            payload.BatchId = taskId;

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
                "qwen_local" or "qwen" or "local" => "agents/get_qwen_local_data_analysis",
                _ => "agents/get_deepseek_data_analysis"
            };

            // Отправляем POST запрос в сервис ai-driver
            var response = await _httpClient.PostAsync(endpoint, httpContent);

            if (response.IsSuccessStatusCode)
            {
                _logger.LogInformation($"[Task {taskId}] Данные успешно доставлены в ai-driver. Получение результатов...");
                string responseBody = await response.Content.ReadAsStringAsync();
                var result = JsonSerializer.Deserialize<CourseBatchAnalysisResult>(responseBody, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                TaskTracker[taskId] = ("Completed", result, null);

                if (report != null)
                {
                    report.Status = "Completed";
                    report.ResultJson = responseBody;
                    await _dbContext.SaveChangesAsync();
                }
            }
            else
            {
                string errorContext = await response.Content.ReadAsStringAsync();
                _logger.LogError($"[Task {taskId}] ai-driver вернул ошибку: {response.StatusCode}. Контекст: {errorContext}");
                TaskTracker[taskId] = ("Failed", null, $"ai-driver returned error {response.StatusCode}: {errorContext}");

                if (report != null)
                {
                    report.Status = "Failed";
                    report.Error = $"ai-driver returned error {response.StatusCode}: {errorContext}";
                    await _dbContext.SaveChangesAsync();
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError($"[Task {taskId}] Критическая ошибка при обработке: {ex.Message}");
            TaskTracker[taskId] = ("Failed", null, ex.Message);

            if (report != null)
            {
                report.Status = "Failed";
                report.Error = ex.Message;
                await _dbContext.SaveChangesAsync();
            }
        }
        finally
        {
            try
            {
                if (Directory.Exists(tempDir))
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
}