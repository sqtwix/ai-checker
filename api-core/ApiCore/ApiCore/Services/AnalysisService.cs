using ApiCore.Models;
using System.Text;
using System.Text.Json;

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

            // 2. Парсинг файла
            _logger.LogInformation($"[Task {taskId}] Запуск циклического парсинга CSV файлов...");
            CourseBatchAnalysisRequest payload = _fileParser.ParseToBatchRequest(benchmarkFile, userResponseFiles);
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
                _logger.LogInformation($"[Task {taskId}] Данные успешно доставлены в ai-driver. Переходим в режим ожидания вебхука.");
            }
            else
            {
                string errorContext = await response.Content.ReadAsStringAsync();
                _logger.LogError($"[Task {taskId}] ai-driver вернул ошибку: {response.StatusCode}. Контекст: {errorContext}");
            }
        }
        catch (Exception ex)
        {
            _logger.LogError($"[Task {taskId}] Критическая ошибка при обработке: {ex.Message}");
        }
    }
}