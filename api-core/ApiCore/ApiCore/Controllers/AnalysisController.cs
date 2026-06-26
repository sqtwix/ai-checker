using ApiCore.Services;
using Microsoft.AspNetCore.Mvc;

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

    public AnalysisController(AnalysisService analysisService)
    {
        _analysisService = analysisService;
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

        // 3. Отдаем парсинг и отправку в фоновый сервис БЕЗ await, чтобы не блокировать фронтенд
        _ = Task.Run(() => _analysisService.ProcessAnalysisAsync(taskId, benchmarkPath, userResponsePaths, modelType, tempDir));

        // Возвращаем фронту ID задачи. Фронт начнет слушать WebSocket/SignalR с этим ID
        return Accepted(new
        {
            task_id = taskId,
            message = "Файлы успешно прошли первичную валидацию и приняты в обработку ИИ-агентами."
        });
    }

    [HttpGet("status/{taskId}")]
    public IActionResult GetStatus(string taskId)
    {
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
}