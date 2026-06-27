using System.Text;
using ApiCore.Models;

namespace ApiCore.Services;

public class ValidationService
{
    private readonly string[] _allowedExtensions = { ".csv", ".json" };
    private readonly string[] _requiredUserHeaders = { "Пользователь", "Дата", "Статус", "Баллы" };

    public ValidationResult ValidateFiles(string benchmarkPath, List<string> userResponsePaths)
    {
        var result = new ValidationResult();

        // 1. Проверка расширений файлов
        ValidateExtension(benchmarkPath, "Эталонный файл", result);
        foreach (var path in userResponsePaths)
        {
            ValidateExtension(path, $"Файл ответов '{Path.GetFileName(path)}'", result);
        }

        if (!result.IsValid) return result; // Если расширения битые, дальше проверять нет смысла

        // 2. Валидация структуры эталонного файла
        ValidateBenchmarkStructure(benchmarkPath, result);

        // 3. Валидация структуры файлов с ответами студентов
        foreach (var path in userResponsePaths)
        {
            ValidateUserResponseStructure(path, result);
        }

        return result;
    }

    private void ValidateExtension(string filePath, string fileLabel, ValidationResult result)
    {
        var ext = Path.GetExtension(filePath).ToLowerSuffix();
        if (!_allowedExtensions.Contains(ext))
        {
            result.AddError($"{fileLabel} имеет недопустимое расширение '{ext}'. Допускаются только: .csv, .json");
        }
    }

    private void ValidateBenchmarkStructure(string filePath, ValidationResult result)
    {
        var fileName = Path.GetFileName(filePath);
        try
        {
            using var stream = File.OpenRead(filePath);
            var encoding = GetEncoding(stream);
            using var reader = new StreamReader(stream, encoding);

            var headerLine = reader.ReadLine();
            if (string.IsNullOrWhiteSpace(headerLine))
            {
                result.AddError($"Файл эталона '{fileName}' пуст или поврежден.");
                return;
            }

            // В эталоне должны быть колонки с вопросами (поддерживаем запятую и точку с запятой)
            char delimiter = headerLine.Contains(';') ? ';' : ',';
            var columns = headerLine.Split(delimiter);
            if (columns.Length < 1)
            {
                result.AddError($"В файле эталона '{fileName}' не обнаружено колонок с вопросами.");
            }
        }
        catch (Exception ex)
        {
            result.AddError($"Не удалось прочитать файл эталона '{fileName}': {ex.Message}");
        }
    }

    private void ValidateUserResponseStructure(string filePath, ValidationResult result)
    {
        var fileName = Path.GetFileName(filePath);
        try
        {
            using var stream = File.OpenRead(filePath);
            var encoding = GetEncoding(stream);
            using var reader = new StreamReader(stream, encoding);

            var headerLine = reader.ReadLine();
            if (string.IsNullOrWhiteSpace(headerLine))
            {
                result.AddError($"Файл ответов '{fileName}' пуст.");
                return;
            }

            var subHeaderLine = reader.ReadLine() ?? "";
            var combinedHeaders = headerLine + " " + subHeaderLine;

            // Проверяем наличие обязательных метаданных LMS (Пользователь, Дата, Статус, Баллы)
            foreach (var requiredHeader in _requiredUserHeaders)
            {
                if (!combinedHeaders.Contains(requiredHeader))
                {
                    result.AddError($"В файле '{fileName}' отсутствует обязательная колонка '{requiredHeader}'.");
                }
            }

            // Проверяем циклическую структуру (минимум один вопрос должен быть)
            char delimiter = headerLine.Contains(';') ? ';' : ',';
            var columns = headerLine.Split(delimiter);
            if (columns.Length < 5)
            {
                result.AddError($"Файл '{fileName}' содержит метаданные, но в нем нет колонок с ответами на вопросы.");
            }
        }
        catch (Exception ex)
        {
            result.AddError($"Не удалось прочитать файл ответов '{fileName}': {ex.Message}");
        }
    }

    private Encoding GetEncoding(Stream stream)
    {
        System.Text.Encoding.RegisterProvider(System.Text.CodePagesEncodingProvider.Instance);
        var cp1251 = System.Text.Encoding.GetEncoding(1251);

        byte[] buffer = new byte[1024];
        int bytesRead = stream.Read(buffer, 0, buffer.Length);
        if (stream.CanSeek) stream.Position = 0;

        string utf8String = Encoding.UTF8.GetString(buffer, 0, bytesRead);
        if (utf8String.Contains("\uFFFD"))
        {
            return cp1251;
        }

        string cp1251String = cp1251.GetString(buffer, 0, bytesRead);
        if (cp1251String.Contains("Пользователь") || cp1251String.Contains("Дата") || cp1251String.Contains("Статус") || cp1251String.Contains("Правильный ответ"))
        {
            return cp1251;
        }

        return Encoding.UTF8;
    }
}

// Легковесный хелпер для безопасного извлечения расширения
public static class StringExtensions
{
    public static string ToLowerSuffix(this string? value) => value?.ToLowerInvariant() ?? string.Empty;
}