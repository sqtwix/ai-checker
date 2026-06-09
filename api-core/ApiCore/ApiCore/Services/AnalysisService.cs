using ApiCore.Models;

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

    public AnalysisService(ValidationService validationService, 
        ILogger<AnalysisService> logger,
        FileParser fileParser,
        HttpClient httpClient)  
    {
        _validationService = validationService;
        _logger = logger;
        _httpClient = httpClient;
        _fileParser = fileParser;
    }

    public async Task ProcessAnalysisAsync(string taskId, IFormFile benchmarkFile, List<IFormFile> userResponseFiles, string modelType)
    {
        _logger.LogInformation($"[Task {taskId}] Начало фоновой обработки пакета файлов.");

        try
        {
            // 1. Повторная глубокая валидация в фоне
            var validation = _validationService.ValidateFiles(benchmarkFile, userResponseFiles);
            if (!validation.IsValid)
            {
                var errors = string.Join("; ", validation.Errors);
                _logger.LogError($"[Task {taskId}] Фоновая валидация провалена: {errors}");
                return;
            }

            _logger.LogInformation($"[Task {taskId}] Запуск циклического парсинга CSV файлов...");
            CourseBatchAnalysisRequest payload = _fileParser.ParseToBatchRequest(benchmarkFile, userResponseFiles);
            payload.BatchId = taskId; // Привязываем сгенерированный контроллером ID задачи

            // TODO: Шаг 3. Отправка контракта по HTTP в Python ai-driver
            _logger.LogInformation($"[Task {taskId}] Запрос отправлен в ai-driver. Ожидание вебхука...");
        }
        catch (Exception ex)
        {
            _logger.LogError($"[Task {taskId}] Критическая ошибка при обработке: {ex.Message}");
        }
    }
}