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
    [HttpPost("upload")]
    [DisableRequestSizeLimit] // Чтобы методисты могли загружать тяжелые CSV/архивы
    public async Task<IActionResult> UploadFiles(
        [FromForm] IFormFile benchmarkFile,        // Тот самый эталонный файл (JSON/CSV) [cite: 9, 18]
        [FromForm] List<IFormFile> userResponseFiles, // Массив файлов с реальными ответами студентов [cite: 10, 18]
        [FromForm] string modelType = "deepseek")  // Выбор нейросети (deepseek или gigachat) [cite: 17, 53]
    {
        [cite_start]// 1. Быстрая валидация (Критерий ТЗ: Обработка ошибок) [cite: 24, 32, 37]
        if (benchmarkFile == null || benchmarkFile.Length == 0)
            return BadRequest(new { error = "Отсутствует или пуст файл с эталонными ответами." });

        if (userResponseFiles == null || !userResponseFiles.Any())
            return BadRequest(new { error = "Необходимо загрузить хотя бы один файл с ответами пользователей." });

        // 2. Генерируем уникальный ID для этой задачи анализа
        var taskId = Guid.NewGuid().ToString();

        // 3. Отдаем парсинг и отправку в фоновый сервис, чтобы не блокировать фронтенд
        // _analysisService.StartBackgroundAnalysis(taskId, benchmarkFile, userResponseFiles, modelType);

        // Возвращаем фронту ID задачи. Фронт начнет слушать WebSocket/SignalR с этим ID
        return Accepted(new { task_id = taskId, message = "Файлы успешно загружены и приняты в обработку." });
    }
}