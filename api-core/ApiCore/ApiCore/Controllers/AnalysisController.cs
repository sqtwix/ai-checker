using ApiCore.Services;
using ApiCore.Models;
using ApiCore.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

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
    private readonly AnalysisService _analysisService;
    private readonly AppDbContext _context;
    private readonly IServiceScopeFactory _serviceScopeFactory;

    public AnalysisController(AnalysisService analysisService, AppDbContext context, IServiceScopeFactory serviceScopeFactory)
    {
        _analysisService = analysisService;
        _context = context;
        _serviceScopeFactory = serviceScopeFactory;
    }

    [HttpPost("upload")]
    [DisableRequestSizeLimit] // Чтобы методисты могли загружать тяжелые CSV/архивы
    public async Task<IActionResult> UploadFiles(
        [FromForm] IFormFile benchmarkFile,           // Эталонный файл (JSON/CSV)
        [FromForm] List<IFormFile> userResponseFiles,    // Массив файлов с реальными ответами студентов
        [FromForm] string modelType = "deepseek")     // Выбор нейросети (deepseek или gigachat)
    {
        // 1. Быстрая валидация (Критерий ТЗ: Обработка ошибок)
        if (benchmarkFile == null || benchmarkFile.Length == 0)
            return BadRequest(new { error = "Отсутствует или пуст файл с эталонными ответами." });

        if (userResponseFiles == null || !userResponseFiles.Any())
            return BadRequest(new { error = "Необходимо загрузить хотя бы один файл с ответами пользователей." });

        var userIdClaim = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(userIdClaim) || !Guid.TryParse(userIdClaim, out var userId))
        {
            return Unauthorized(new { error = "Пользователь не авторизован." });
        }

        // 2. Генерируем уникальный ID для этой задачи анализа
        var taskId = Guid.NewGuid().ToString();

        // Создаем временную папку для сохранения файлов в пределах запроса
        var tempDir = Path.Combine(Directory.GetCurrentDirectory(), "temp_uploads", taskId);
        Directory.CreateDirectory(tempDir);

        var benchmarkPath = Path.Combine(tempDir, benchmarkFile.FileName);
        using (var stream = new FileStream(benchmarkPath, FileMode.Create))
        {
            await benchmarkFile.CopyToAsync(stream);
        }

        var userResponsePaths = new List<string>();
        foreach (var file in userResponseFiles)
        {
            var path = Path.Combine(tempDir, file.FileName);
            using (var stream = new FileStream(path, FileMode.Create))
            {
                await file.CopyToAsync(stream);
            }
            userResponsePaths.Add(path);
        }

        // Сохраняем информацию об отчете в базу данных
        var courseName = FileParser.ExtractCourseName(benchmarkFile.FileName);
        var report = new AnalysisReport
        {
            Id = taskId,
            UserId = userId,
            CourseName = courseName,
            Status = "Processing",
            CreatedAt = DateTime.UtcNow
        };
        _context.AnalysisReports.Add(report);
        await _context.SaveChangesAsync();

        // 3. Отдаем парсинг и отправку в фоновый сервис БЕЗ await, чтобы не блокировать фронтенд
        // Используем IServiceScopeFactory, чтобы scoped-зависимости (такие как AppDbContext) не уничтожались при завершении HTTP-запроса
        _ = Task.Run(async () =>
        {
            using var scope = _serviceScopeFactory.CreateScope();
            var scopedService = scope.ServiceProvider.GetRequiredService<AnalysisService>();
            await scopedService.ProcessAnalysisAsync(taskId, userId, benchmarkPath, userResponsePaths, modelType, tempDir);
        });

        // Возвращаем фронту ID задачи. Фронт начнет слушать WebSocket/SignalR с этим ID
        return Accepted(new
        {
            task_id = taskId,
            message = "Файлы успешно прошли первичную валидацию и приняты в обработку ИИ-агентами."
        });
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

        // Резервный поиск во временном in-memory кэше
        if (AnalysisService.TaskTracker.TryGetValue(taskId, out var task))
        {
            return Ok(new
            {
                status = task.Status,
                result = task.Result,
                error = task.Error
            });
        }

        return NotFound(new { error = $"Задача с ID {taskId} не найдена." });
    }

    [HttpGet("history")]
    public async Task<IActionResult> GetHistory()
    {
        var userIdClaim = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(userIdClaim) || !Guid.TryParse(userIdClaim, out var userId))
        {
            return Unauthorized(new { error = "Пользователь не авторизован." });
        }

        var reports = await _context.AnalysisReports
            .Where(r => r.UserId == userId)
            .OrderByDescending(r => r.CreatedAt)
            .ToListAsync();

        var listDto = new List<AnalysisReportDto>();
        foreach (var report in reports)
        {
            CourseBatchAnalysisResult? result = null;
            if (!string.IsNullOrEmpty(report.ResultJson))
            {
                result = System.Text.Json.JsonSerializer.Deserialize<CourseBatchAnalysisResult>(
                    report.ResultJson, 
                    new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true }
                );
            }

            listDto.Add(new AnalysisReportDto
            {
                Id = report.Id,
                CourseName = report.CourseName,
                CreatedAt = report.CreatedAt,
                Status = report.Status,
                Result = result,
                Error = report.Error
            });
        }

        return Ok(listDto);
    }
}