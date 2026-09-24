using ApiCore.Services;
using ApiCore.Models;
using ApiCore.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.RateLimiting;
using System.Text.Json;

namespace ApiCore.Controllers;

/*
Сервис для обработки отправки данных в систему
Содержит:
    UploadFiles - endpoint для отправки файлов с фронта
*/

[ApiController]
[Route("api/v1/analysis")]
public class AnalysisController : ControllerBase
{
    private readonly AppDbContext _context;
    private readonly ReportsService _reportsService;
    private readonly AiProviderAvailabilityService _providerAvailability;
    private readonly IConfiguration _configuration;

    private static readonly HashSet<string> BenchmarkExtensions = new(StringComparer.OrdinalIgnoreCase)
        { ".csv", ".xlsx", ".xls" };
    private static readonly HashSet<string> ResponseExtensions = new(StringComparer.OrdinalIgnoreCase)
        { ".csv", ".xlsx", ".xls", ".zip" };
    private static readonly HashSet<string> ModelTypes = new(StringComparer.OrdinalIgnoreCase)
        { "deepseek", "gigachat", "sbergpt", "local_llm", "qwen_local", "qwen", "local" };

    public AnalysisController(
        AppDbContext context,
        ReportsService reportsService,
        AiProviderAvailabilityService providerAvailability,
        IConfiguration configuration)
    {
        _context = context;
        _reportsService = reportsService;
        _providerAvailability = providerAvailability;
        _configuration = configuration;
    }

    [HttpPost("upload")]
    [EnableRateLimiting("uploads")]
    public async Task<IActionResult> UploadFiles(
        [FromForm] IFormFile benchmarkFile,           // Эталонный файл (JSON/CSV)
        [FromForm] List<IFormFile> userResponseFiles,    // Массив файлов с реальными ответами студентов
        [FromForm] string modelType = "deepseek",
        CancellationToken cancellationToken = default)
    {
        // 1. Быстрая валидация (Критерий ТЗ: Обработка ошибок)
        if (benchmarkFile == null || benchmarkFile.Length == 0)
            return BadRequest(new { error = "Отсутствует или пуст файл с эталонными ответами." });

        if (userResponseFiles == null || !userResponseFiles.Any())
            return BadRequest(new { error = "Необходимо загрузить хотя бы один файл с ответами пользователей." });

        var maxFileCount = _configuration.GetValue<int?>("Uploads:MaxResponseFileCount") ?? 50;
        var maxFileSizeMb = _configuration.GetValue<long?>("Uploads:MaxFileSizeMb") ?? 50;
        var maxFileSizeBytes = maxFileSizeMb * 1024 * 1024;

        if (userResponseFiles.Count > maxFileCount)
            return BadRequest(new { error = $"За один запуск можно загрузить не более {maxFileCount} файлов ответов." });

        if (!ModelTypes.Contains(modelType))
            return BadRequest(new { error = "Неизвестная модель. Допустимые значения: deepseek, gigachat, local_llm." });

        if (!BenchmarkExtensions.Contains(Path.GetExtension(benchmarkFile.FileName)))
            return BadRequest(new { error = "Эталонный файл должен иметь формат CSV, XLSX или XLS." });

        var invalidResponse = userResponseFiles.FirstOrDefault(file =>
            !ResponseExtensions.Contains(Path.GetExtension(file.FileName)));
        if (invalidResponse != null)
            return BadRequest(new { error = $"Файл '{Path.GetFileName(invalidResponse.FileName)}' имеет неподдерживаемый формат." });

        if (benchmarkFile.Length > maxFileSizeBytes || userResponseFiles.Any(file => file.Length > maxFileSizeBytes))
            return BadRequest(new { error = $"Размер каждого файла не должен превышать {maxFileSizeMb} МБ." });

        var userIdClaim = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(userIdClaim) || !Guid.TryParse(userIdClaim, out var userId))
        {
            return Unauthorized(new { error = "Пользователь не авторизован." });
        }

        var canonicalModel = modelType.ToLowerInvariant() switch
        {
            "gigachat" or "sbergpt" => "gigachat",
            "local_llm" or "qwen_local" or "qwen" or "local" => "local_llm",
            _ => "deepseek"
        };
        if (!await _providerAvailability.IsAvailableAsync(canonicalModel, cancellationToken))
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new
            {
                error = "Выбранный AI-провайдер не настроен или недоступен. Обратитесь к администратору.",
                code = "MODEL_UNAVAILABLE"
            });
        }

        var queueCapacity = Math.Max(1, _configuration.GetValue<int?>("AnalysisQueue:Capacity") ?? 20);
        var activeJobs = await _context.AnalysisReports.CountAsync(
            report => report.Status == "Queued" || report.Status == "Retrying" || report.Status == "Processing",
            cancellationToken);
        if (activeJobs >= queueCapacity)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new
            {
                error = "Очередь анализа временно заполнена. Повторите попытку позже."
            });
        }

        // 2. Генерируем уникальный ID для этой задачи анализа
        var taskId = Guid.NewGuid().ToString();

        // Создаем временную папку для сохранения файлов в пределах запроса
        var jobsRoot = _configuration["AnalysisQueue:JobsDirectory"]
            ?? Path.Combine(Directory.GetCurrentDirectory(), "analysis_jobs");
        var tempDir = Path.Combine(Path.GetFullPath(jobsRoot), taskId);
        Directory.CreateDirectory(tempDir);

        try
        {
            var benchmarkPath = BuildSafeUploadPath(tempDir, benchmarkFile.FileName, "benchmark");
            await using (var stream = new FileStream(benchmarkPath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                await benchmarkFile.CopyToAsync(stream, cancellationToken);
            }

            var userResponsePaths = new List<string>();
            for (var index = 0; index < userResponseFiles.Count; index++)
            {
                var file = userResponseFiles[index];
                var path = BuildSafeUploadPath(tempDir, file.FileName, $"response-{index + 1}");
                await using var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None);
                await file.CopyToAsync(stream, cancellationToken);
                userResponsePaths.Add(path);
            }

            var courseName = FileParser.ExtractCourseName(Path.GetFileName(benchmarkFile.FileName));
            var report = new AnalysisReport
            {
                Id = taskId,
                UserId = userId,
                CourseName = courseName,
                Status = "Queued",
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
                ModelType = canonicalModel,
                PayloadJson = JsonSerializer.Serialize(new AnalysisJobPayload(
                    benchmarkPath,
                    userResponsePaths,
                    tempDir,
                    HttpContext.Response.Headers["X-Correlation-ID"].FirstOrDefault()))
            };

            // Serialize the final capacity check with the insert. The earlier
            // count is a fast rejection path only; concurrent requests can all
            // pass it before any of them inserts a row.
            await using var admissionTransaction = await _context.Database.BeginTransactionAsync(cancellationToken);
            await _context.Database.ExecuteSqlRawAsync(
                "LOCK TABLE analysis_reports IN SHARE ROW EXCLUSIVE MODE",
                cancellationToken);
            activeJobs = await _context.AnalysisReports.CountAsync(
                existing => existing.Status == "Queued"
                    || existing.Status == "Retrying"
                    || existing.Status == "Processing",
                cancellationToken);
            if (activeJobs >= queueCapacity)
            {
                await admissionTransaction.RollbackAsync(cancellationToken);
                if (Directory.Exists(tempDir)) Directory.Delete(tempDir, true);
                return StatusCode(StatusCodes.Status503ServiceUnavailable, new
                {
                    error = "Очередь анализа временно заполнена. Повторите попытку позже."
                });
            }

            _context.AnalysisReports.Add(report);
            await _context.SaveChangesAsync(cancellationToken);
            await admissionTransaction.CommitAsync(cancellationToken);

            return Accepted(new
            {
                task_id = taskId,
                message = "Файлы проверены и поставлены в очередь анализа."
            });
        }
        catch
        {
            if (Directory.Exists(tempDir)) Directory.Delete(tempDir, true);
            throw;
        }
    }

    private static string BuildSafeUploadPath(string directory, string originalName, string prefix)
    {
        var extension = Path.GetExtension(Path.GetFileName(originalName)).ToLowerInvariant();
        var originalStem = Path.GetFileNameWithoutExtension(Path.GetFileName(originalName));
        var safeStem = new string(originalStem
            .Where(character => char.IsLetterOrDigit(character) || character is ' ' or '-' or '_' or '.')
            .Take(120)
            .ToArray()).Trim();
        if (string.IsNullOrWhiteSpace(safeStem)) safeStem = "uploaded-file";
        var targetDirectory = Path.Combine(directory, prefix);
        Directory.CreateDirectory(targetDirectory);
        return Path.Combine(targetDirectory, safeStem + extension);
    }

    [HttpGet("status/{taskId}")]
    public async Task<IActionResult> GetStatus(string taskId)
    {
        var userIdClaim = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(userIdClaim) || !Guid.TryParse(userIdClaim, out var userId))
        {
            return Unauthorized(new { error = "Пользователь не авторизован." });
        }

        var report = await _context.AnalysisReports
            .FirstOrDefaultAsync(r => r.Id == taskId && r.UserId == userId);

        if (report != null)
        {
            CourseBatchAnalysisResult? result = null;
            if (!string.IsNullOrEmpty(report.ResultJson))
            {
                result = System.Text.Json.JsonSerializer.Deserialize<CourseBatchAnalysisResult>(
                    report.ResultJson, 
                    new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true }
                );
            }

            return Ok(new
            {
                status = report.Status,
                result = result,
                error = report.Error
            });
        }

        return NotFound(new { error = $"Задача с ID {taskId} не найдена." });
    }

    [HttpPost("cancel/{taskId}")]
    public async Task<IActionResult> CancelAnalysis(string taskId)
    {
        if (!Guid.TryParse(User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value, out var userId))
            return Unauthorized();
        var owned = _context.AnalysisReports.Where(report => report.Id == taskId && report.UserId == userId);
        var changed = await owned.Where(report => report.Status == "Queued" || report.Status == "Retrying")
            .ExecuteUpdateAsync(update => update
                .SetProperty(report => report.Status, "Cancelled")
                .SetProperty(report => report.Error, "Анализ остановлен пользователем.")
                .SetProperty(report => report.NextRetryAt, (DateTime?)null)
                .SetProperty(report => report.UpdatedAt, DateTime.UtcNow));
        changed += await owned.Where(report => report.Status == "Processing")
            .ExecuteUpdateAsync(update => update
                .SetProperty(report => report.Status, "Cancelling")
                .SetProperty(report => report.Error, "Остановка запрошена. Завершается текущий запрос к модели.")
                .SetProperty(report => report.NextRetryAt, (DateTime?)null)
                .SetProperty(report => report.UpdatedAt, DateTime.UtcNow));
        var status = await owned.Select(report => report.Status).FirstOrDefaultAsync();
        if (status == null) return NotFound(new { error = "Задача не найдена." });
        if (changed == 0 && status is not ("Cancelling" or "Cancelled"))
            return Conflict(new { error = "Задача уже завершена. Обновите отчёт.", status });
        return Ok(new { status });
    }

    [HttpGet("history")]
    public async Task<IActionResult> GetHistory([FromQuery] bool includeArchived = false, [FromQuery] bool onlyArchived = false)
    {
        var userIdClaim = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(userIdClaim) || !Guid.TryParse(userIdClaim, out var userId))
        {
            return Unauthorized(new { error = "Пользователь не авторизован." });
        }

        var reports = await _reportsService.GetHistoryAsync(userId, includeArchived, onlyArchived);
        return Ok(reports);
    }

    [HttpPut("rename/{taskId}")]
    [RequestSizeLimit(4_096)]
    public async Task<IActionResult> RenameReport(string taskId, [FromBody] RenameReportRequest request)
    {
        var userIdClaim = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(userIdClaim) || !Guid.TryParse(userIdClaim, out var userId))
        {
            return Unauthorized(new { error = "Пользователь не авторизован." });
        }

        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return BadRequest(new { error = "Название не может быть пустым." });
        }

        if (request.Name.Trim().Length > 200)
        {
            return BadRequest(new { error = "Название не должно превышать 200 символов." });
        }

        var success = await _reportsService.RenameReportAsync(taskId, userId, request.Name);
        if (!success)
        {
            return NotFound(new { error = "Отчет не найден." });
        }

        return Ok(new { message = "Отчет успешно переименован.", courseName = request.Name.Trim() });
    }

    [HttpPut("archive/{taskId}")]
    public async Task<IActionResult> ArchiveReport(string taskId)
    {
        var userIdClaim = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(userIdClaim) || !Guid.TryParse(userIdClaim, out var userId))
        {
            return Unauthorized(new { error = "Пользователь не авторизован." });
        }

        var success = await _reportsService.ArchiveReportAsync(taskId, userId);
        if (!success)
        {
            return NotFound(new { error = "Отчет не найден." });
        }

        return Ok(new { message = "Отчет успешно архивирован." });
    }

    [HttpPut("unarchive/{taskId}")]
    public async Task<IActionResult> UnarchiveReport(string taskId)
    {
        var userIdClaim = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(userIdClaim) || !Guid.TryParse(userIdClaim, out var userId))
        {
            return Unauthorized(new { error = "Пользователь не авторизован." });
        }

        var success = await _reportsService.UnarchiveReportAsync(taskId, userId);
        if (!success)
        {
            return NotFound(new { error = "Отчет не найден." });
        }

        return Ok(new { message = "Отчет успешно разархивирован." });
    }
}

public class RenameReportRequest
{
    public string Name { get; set; } = string.Empty;
}
