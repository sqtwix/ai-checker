using System.Text;
using ApiCore.Models;

namespace ApiCore.Services;

public class ValidationService
{
    private readonly string[] _allowedExtensions = { ".csv", ".json" };
    private readonly string[] _requiredUserHeaders = { "Пользователь", "Дата", "Статус", "Баллы" };

    public ValidationResult ValidateFiles(IFormFile benchmarkFile, List<IFormFile> userResponseFiles)
    {
        var result = new ValidationResult();

        // 1. Проверка расширений файлов
        ValidateExtension(benchmarkFile, "Эталонный файл", result);
        foreach (var file in userResponseFiles)
        {
            ValidateExtension(file, $"Файл ответов '{file.FileName}'", result);
        }

        if (!result.IsValid) return result; // Если расширения битые, дальше проверять нет смысла

        // 2. Валидация структуры эталонного файла
        ValidateBenchmarkStructure(benchmarkFile, result);

        // 3. Валидация структуры файлов с ответами студентов
        foreach (var file in userResponseFiles)
        {
            ValidateUserResponseStructure(file, result);
        }

        return result;
    }

    private void ValidateExtension(IFormFile file, string fileLabel, ValidationResult result)
    {
        var ext = Path.GetExtension(file.FileName).ToLowerSuffix();
        if (!_allowedExtensions.Contains(ext))
        {
            result.AddError($"{fileLabel} имеет недопустимое расширение '{ext}'. Допускаются только: .csv, .json");
        }
    }

    private void ValidateBenchmarkStructure(IFormFile file, ValidationResult result)
    {
        try
        {
            using var stream = file.OpenReadStream();
            using var reader = new StreamReader(stream, Encoding.UTF8);

            var headerLine = reader.ReadLine();
            if (string.IsNullOrWhiteSpace(headerLine))
            {
                result.AddError($"Файл эталона '{file.FileName}' пуст или поврежден.");
                return;
            }

            // В эталоне должны быть колонки с вопросами
            var columns = headerLine.Split(',');
            if (columns.Length < 1)
            {
                result.AddError($"В файле эталона '{file.FileName}' не обнаружено колонок с вопросами.");
            }
        }
        catch (Exception ex)
        {
            result.AddError($"Не удалось прочитать файл эталона '{file.FileName}': {ex.Message}");
        }
    }

    private void ValidateUserResponseStructure(IFormFile file, ValidationResult result)
    {
        try
        {
            using var stream = file.OpenReadStream();
            using var reader = new StreamReader(stream, Encoding.UTF8);

            var headerLine = reader.ReadLine();
            if (string.IsNullOrWhiteSpace(headerLine))
            {
                result.AddError($"Файл ответов '{file.FileName}' пуст.");
                return;
            }

            // Проверяем наличие обязательных метаданных LMS (Пользователь, Дата, Статус, Баллы)
            foreach (var requiredHeader in _requiredUserHeaders)
            {
                if (!headerLine.Contains(requiredHeader))
                {
                    result.AddError($"В файле '{file.FileName}' отсутствует обязательная колонка '{requiredHeader}'.");
                }
            }

            // Проверяем циклическую структуру (минимум один вопрос должен быть)
            // На основе твоих данных: после 4 базовых колонок идут блоки вопросов
            var columns = headerLine.Split(',');
            if (columns.Length < 5)
            {
                result.AddError($"Файл '{file.FileName}' содержит метаданные, но в нем нет колонок с ответами на вопросы.");
            }
        }
        catch (Exception ex)
        {
            result.AddError($"Не удалось прочитать файл ответов '{file.FileName}': {ex.Message}");
        }
    }
}

// Легковесный хелпер для безопасного извлечения расширения
public static class StringExtensions
{
    public static string ToLowerSuffix(this string? value) => value?.ToLowerInvariant() ?? string.Empty;
}