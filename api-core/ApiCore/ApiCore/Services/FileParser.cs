using ApiCore.Models;
using System.Text;
using ExcelDataReader;

namespace ApiCore.Services;

public class FileParser
{
    private const int MaxWorksheets = 100;
    private const int MaxRows = 200_000;
    private const int MaxColumns = 10_000;
    private const long MaxCells = 2_000_000;

    public sealed record ExcelWorksheet(string Name, List<List<string>> Rows);

    public static List<ExcelWorksheet> ReadExcelWorksheets(string filePath)
    {
        System.Text.Encoding.RegisterProvider(System.Text.CodePagesEncodingProvider.Instance);
        var worksheets = new List<ExcelWorksheet>();
        var totalRows = 0;
        long totalCells = 0;
        using var stream = File.Open(filePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        using var reader = ExcelReaderFactory.CreateReader(stream);

        do
        {
            var rows = new List<List<string>>();
            while (reader.Read())
            {
                totalRows++;
                if (totalRows > MaxRows || reader.FieldCount > MaxColumns)
                    throw new InvalidDataException("Excel-файл превышает безопасный лимит строк или столбцов.");
                totalCells += reader.FieldCount;
                if (totalCells > MaxCells)
                    throw new InvalidDataException("Excel-файл превышает безопасный лимит в 2 000 000 ячеек.");
                var row = new List<string>();
                for (int i = 0; i < reader.FieldCount; i++)
                {
                    var val = reader.GetValue(i);
                    row.Add(val?.ToString() ?? "");
                }
                rows.Add(row);
            }

            if (rows.Any(row => row.Any(value => !string.IsNullOrWhiteSpace(value))))
            {
                worksheets.Add(new ExcelWorksheet(reader.Name, rows));
                if (worksheets.Count > MaxWorksheets)
                    throw new InvalidDataException("Excel-файл содержит более 100 непустых листов.");
            }
        }
        while (reader.NextResult());

        return worksheets;
    }

    public static List<List<string>> ReadExcelRows(string filePath)
    {
        return ReadExcelWorksheets(filePath).FirstOrDefault()?.Rows ?? new List<List<string>>();
    }

    public CourseBatchAnalysisRequest ParseToBatchRequest(string benchmarkPath, List<string> userResponsePaths)
    {
        var batchRequest = new CourseBatchAnalysisRequest
        {
            BatchId = Guid.NewGuid().ToString(),
            // Вытаскиваем имя курса из названия файла эталона (например, "ЭК 001")
            CourseName = ExtractCourseName(Path.GetFileName(benchmarkPath))
        };

        // 1. Сначала парсим общий эталонный файл в плоский словарь: "Текст Вопроса" -> "Правильный Ответ"
        var benchmark = ParseBenchmarkFile(benchmarkPath);

        // 2. Поочередно парсим каждый файл с ответами студентов по темам
        foreach (var userPath in userResponsePaths)
        {
            batchRequest.Tests.AddRange(ParseUserResponseFile(userPath, benchmark));
        }

        batchRequest.InputWarnings = benchmark.Warnings.Distinct().ToList();
        if (benchmark.ExcludedEmptyAnswers > 0)
            batchRequest.DataNotes.Add($"Пустых позиций без оценки LMS исключено: {benchmark.ExcludedEmptyAnswers}.");
        if (benchmark.UngradedAnswers > 0)
            batchRequest.InputWarnings.Add($"Записей без распознаваемой оценки LMS исключено из процентов: {benchmark.UngradedAnswers}. Они не приравнены к ошибкам.");
        var emptyAttempts = batchRequest.Tests.SelectMany(test => test.StudentAttempts).Count(attempt => attempt.Answers.Count == 0);
        if (emptyAttempts > 0)
            batchRequest.DataNotes.Add($"Попыток без оценённых ответов: {emptyAttempts}. Они учтены в количестве попыток, но не в процентах ответов.");
        if (!batchRequest.Tests.SelectMany(test => test.StudentAttempts).Any(attempt => attempt.Answers.Count > 0))
            throw new InvalidDataException("В выгрузке нет ответов с распознаваемой оценкой LMS. Проверьте колонки «Результат».");

        var unmatched = batchRequest.Tests
            .SelectMany(test => test.Questions
                .Where(question => question.ReferenceAnswer == "Эталонный ответ не найден в мастер-файле")
                .Select(question => $"'{question.QuestionText}' ({test.TestName})"))
            .Take(10)
            .ToList();
        if (unmatched.Count > 0)
        {
            throw new InvalidDataException(
                "Для части вопросов не найдены эталонные ответы: " + string.Join("; ", unmatched) +
                ". Исправьте эталонный файл или выгрузку ответов.");
        }

        return batchRequest;
    }

    private sealed record BenchmarkQuestion(string QuestionText, string ReferenceAnswer);

    private sealed class BenchmarkCatalog
    {
        public Dictionary<string, List<BenchmarkQuestion>> Sheets { get; } = new(StringComparer.OrdinalIgnoreCase);
        public List<string> Warnings { get; } = new();
        public int ExcludedEmptyAnswers { get; set; }
        public int UngradedAnswers { get; set; }

        public string? Resolve(string? sheetName, string questionText, List<string> exportedReferences, string label)
        {
            IEnumerable<BenchmarkQuestion> candidates;
            if (!string.IsNullOrWhiteSpace(sheetName) && Sheets.TryGetValue(sheetName, out var sheet))
            {
                candidates = sheet;
            }
            else if (Sheets.Count == 1)
            {
                candidates = Sheets.Values.Single();
            }
            else
            {
                candidates = Sheets.Values.SelectMany(items => items);
            }

            var matches = candidates
                .Where(item => item.QuestionText.Equals(questionText, StringComparison.OrdinalIgnoreCase))
                .Select(item => item.ReferenceAnswer)
                .Where(answer => !string.IsNullOrWhiteSpace(answer))
                .Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            if (matches.Count == 0) return null;
            if (exportedReferences.Count > 0)
            {
                // Repeated prompts can have different answer options and order.
                // The reference in the same four-column block identifies its variant.
                if (exportedReferences.Any(answer => !matches.Contains(answer, StringComparer.OrdinalIgnoreCase)))
                    Warnings.Add($"{label}: эталон в выгрузке отличается от мастер-файла. Для пояснений использован эталон соответствующей записи LMS; проверьте оба источника.");
                if (exportedReferences.Count > 1)
                    Warnings.Add($"{label}: в выгрузке несколько вариантов эталона. Для каждого ответа сохранён его вариант; проверьте настройки задания.");
                return exportedReferences[0];
            }
            if (matches.Count == 1) return matches[0];
            throw new InvalidDataException($"{label}: одинаковому тексту вопроса соответствуют разные эталоны. Заполните «Правильный ответ» в выгрузке, чтобы определить вариант задания.");
        }
    }

    private BenchmarkCatalog ParseBenchmarkFile(string filePath)
    {
        var catalog = new BenchmarkCatalog();
        var ext = Path.GetExtension(filePath).ToLowerSuffix();

        if (ext == ".xlsx" || ext == ".xls")
        {
            foreach (var worksheet in ReadExcelWorksheets(filePath))
            {
                if (worksheet.Rows.Count < 3) continue;
                var questions = new List<BenchmarkQuestion>();
                var excelHeaders = worksheet.Rows[0];
                var excelValues = worksheet.Rows[2];

                for (int i = 0; i < excelHeaders.Count; i++)
                {
                    if (i < excelValues.Count && !string.IsNullOrWhiteSpace(excelHeaders[i]))
                    {
                        questions.Add(new BenchmarkQuestion(CleanText(excelHeaders[i]), CleanText(excelValues[i])));
                    }
                }

                catalog.Sheets[worksheet.Name] = questions;
            }
            return catalog;
        }

        using var stream = File.OpenRead(filePath);
        var encoding = GetEncoding(stream);
        using var reader = new StreamReader(stream, encoding);

        // Строка 1: Текст вопросов (Заголовки)
        string? headerLine = reader.ReadLine();
        // Строка 2: Субхидеры со словом "Правильный ответ" (пропускаем)
        string? subHeaderLine = reader.ReadLine();
        // Строка 3: Сами правильные ответы из эталона
        string? valuesLine = reader.ReadLine();

        if (headerLine == null || valuesLine == null) return catalog;

        char delimiter = headerLine.Contains(';') ? ';' : ',';
        var headers = ParseCsvLine(headerLine, delimiter);
        var values = ParseCsvLine(valuesLine, delimiter);
        if (headers.Count > MaxColumns || values.Count > MaxColumns)
            throw new InvalidDataException("CSV-файл эталона превышает безопасный лимит столбцов.");

        var csvQuestions = new List<BenchmarkQuestion>();
        for (int i = 0; i < headers.Count; i++)
        {
            if (i < values.Count && !string.IsNullOrWhiteSpace(headers[i]))
            {
                csvQuestions.Add(new BenchmarkQuestion(CleanText(headers[i]), CleanText(values[i])));
            }
        }
        catalog.Sheets[string.Empty] = csvQuestions;
        return catalog;
    }

    private List<AiTestPayloadDto> ParseUserResponseFile(string filePath, BenchmarkCatalog benchmark)
    {
        var ext = Path.GetExtension(filePath).ToLowerSuffix();
        if (ext == ".xlsx" || ext == ".xls")
        {
            var worksheets = ReadExcelWorksheets(filePath);
            var includeSheetName = worksheets.Count > 1;
            return worksheets
                .SelectMany(worksheet => ParseUserResponseWorksheet(
                    worksheet.Rows,
                    benchmark,
                    worksheet.Name,
                    includeSheetName
                        ? $"{ExtractTestName(Path.GetFileName(filePath))} — {worksheet.Name}"
                        : ExtractTestName(Path.GetFileName(filePath))))
                .ToList();
        }

        var rows = new List<List<string>>();
        long totalCells = 0;
        using (var stream = File.OpenRead(filePath))
        using (var reader = new StreamReader(stream, GetEncoding(stream)))
        {
            string? line;
            char delimiter = ',';
            bool isFirst = true;
            while ((line = reader.ReadLine()) != null)
            {
                if (string.IsNullOrWhiteSpace(line)) continue;
                if (isFirst)
                {
                    delimiter = line.Contains(';') ? ';' : ',';
                    isFirst = false;
                }
                var parsed = ParseCsvLine(line, delimiter);
                if (parsed.Count > MaxColumns)
                    throw new InvalidDataException("CSV-файл превышает безопасный лимит столбцов.");
                totalCells += parsed.Count;
                if (rows.Count >= MaxRows || totalCells > MaxCells)
                    throw new InvalidDataException("CSV-файл превышает безопасный лимит строк или ячеек.");
                rows.Add(parsed);
            }
        }

        return ParseUserResponseWorksheet(rows, benchmark, null, ExtractTestName(Path.GetFileName(filePath)));
    }

    private List<AiTestPayloadDto> ParseUserResponseWorksheet(
        List<List<string>> rows,
        BenchmarkCatalog benchmark,
        string? sheetName,
        string testName)
    {
        var headerIndices = rows
            .Select((row, index) => new { row, index })
            .Where(item => IsUserHeaderRow(item.row))
            .Select(item => item.index)
            .ToList();
        if (headerIndices.Count == 0 && rows.Count >= 2)
        {
            headerIndices.Add(0);
        }

        var payloads = new List<AiTestPayloadDto>();
        for (var sectionIndex = 0; sectionIndex < headerIndices.Count; sectionIndex++)
        {
            var start = headerIndices[sectionIndex];
            var end = sectionIndex + 1 < headerIndices.Count ? headerIndices[sectionIndex + 1] : rows.Count;
            var sectionRows = rows.GetRange(start, end - start);
            var sectionName = headerIndices.Count > 1 ? $"{testName} — блок {sectionIndex + 1}" : testName;
            var payload = ParseUserResponseSection(sectionRows, benchmark, sheetName, sectionName);
            if (payload != null)
            {
                payloads.Add(payload);
            }
        }
        return payloads;
    }

    private static bool IsUserHeaderRow(List<string> row)
    {
        if (row.Count < 4) return false;
        var first = row[0].Trim();
        if (!first.Equals("Пользователь", StringComparison.OrdinalIgnoreCase) &&
            !first.Equals("Код", StringComparison.OrdinalIgnoreCase)) return false;
        return row[1].Contains("Дата", StringComparison.OrdinalIgnoreCase)
            && row[2].Contains("Статус", StringComparison.OrdinalIgnoreCase)
            && (row[3].Contains("Балл", StringComparison.OrdinalIgnoreCase)
                || row[3].Contains("Оцен", StringComparison.OrdinalIgnoreCase));
    }

    private AiTestPayloadDto? ParseUserResponseSection(
        List<List<string>> rows,
        BenchmarkCatalog benchmark,
        string? sheetName,
        string testName)
    {
        if (rows.Count < 3) return null;

        var headers = rows[0];
        var subHeaders = rows[1];

        var testPayload = new AiTestPayloadDto
        {
            TestName = testName
        };

        // Шаг A. Картируем структуру колонок вопросов.
        // Первые 4 колонки (0,1,2,3) — это Пользователь, Дата, Статус, Баллы. 
        // Начиная с 4-й идут блоки вопросов с шагом в 4 колонки.
        var questionColumnsIndices = new List<(string QuestionId, string QuestionText, int StartIdx)>();
        int questionCounter = 1;

        for (int i = 4; i < headers.Count; i += 4)
        {
            string rawQuestionText = headers[i];
            if (string.IsNullOrWhiteSpace(rawQuestionText)) continue;

            string questionText = CleanText(rawQuestionText);

            // Генерируем уникальный ID вопроса для ИИ-драйвера
            string questionId = $"q_{testPayload.TestName.Replace(" ", "_")}_{questionCounter++}";

            // Ищем правильный ответ в словаре эталона. Если его там нет, подстрахуемся дефолтным
            var exportedReferences = rows.Skip(2)
                .Where(row => row.Count > i + 3 && !string.IsNullOrWhiteSpace(row[0]))
                .Select(row => CleanText(row[i + 3]))
                .Where(answer => !string.IsNullOrWhiteSpace(answer))
                .Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            string refAnswer = benchmark.Resolve(sheetName, questionText, exportedReferences, $"{testName}, вопрос {questionCounter - 1}")
                ?? "Эталонный ответ не найден в мастер-файле";

            testPayload.Questions.Add(new AiQuestionDto
            {
                QuestionId = questionId,
                QuestionText = questionText,
                QuestionType = "единственный выбор", // Будет обновлено динамически из строк студентов
                ReferenceAnswer = refAnswer
            });

            questionColumnsIndices.Add((questionId, questionText, i));
        }

        // Шаг Б. Читаем строки с ответами студентов
        for (int r = 2; r < rows.Count; r++)
        {
            var fields = rows[r];
            if (fields.Count < 4) continue;

            // Пропускаем технические или пустые строки, если ID пользователя не числовой
            string studentId = fields[0];
            if (string.IsNullOrWhiteSpace(studentId) || IsUserHeaderRow(fields)) continue;

            var attempt = new StudentAttemptDto
            {
                StudentId = studentId.Trim(),
                AttemptId = $"attempt_{r - 1}",
                CompletionDate = fields[1],
                Status = fields[2],
                TotalScoreText = fields[3]
            };

            // Разбираем ответы студента по нашему маппингу индексов колонок
            foreach (var qMap in questionColumnsIndices)
            {
                int baseIdx = qMap.StartIdx;
                if (baseIdx < fields.Count)
                {
                    var resultCode = baseIdx + 1 < fields.Count ? fields[baseIdx + 1].Trim() : "";
                    var userAnswer = baseIdx + 2 < fields.Count ? CleanText(fields[baseIdx + 2]) : "";
                    var isCorrectByLms = resultCode.Equals("lcnwu5wcgk", StringComparison.OrdinalIgnoreCase);
                    var isIncorrectByLms = resultCode.Equals("r1s987zw3e", StringComparison.OrdinalIgnoreCase);
                    var exportedReference = baseIdx + 3 < fields.Count ? CleanText(fields[baseIdx + 3]) : "";
                    if (!isCorrectByLms && !isIncorrectByLms)
                    {
                        // Missing assignment/result is not an incorrect answer.
                        // An explicitly graded blank answer is retained below.
                        if (string.IsNullOrWhiteSpace(resultCode) && string.IsNullOrWhiteSpace(fields[baseIdx])
                            && string.IsNullOrWhiteSpace(userAnswer) && string.IsNullOrWhiteSpace(exportedReference))
                            benchmark.ExcludedEmptyAnswers++;
                        else
                            benchmark.UngradedAnswers++;
                        continue;
                    }
                    // Динамически обновляем тип вопроса в блоке Questions (например: "текстовый ввод")
                    var linkedQuestion = testPayload.Questions.FirstOrDefault(q => q.QuestionId == qMap.QuestionId);
                    if (linkedQuestion != null && !string.IsNullOrWhiteSpace(fields[baseIdx]) && fields[baseIdx] != "Тип")
                    {
                        linkedQuestion.QuestionType = fields[baseIdx];
                    }

                    // If this row lacks a reference, only an unambiguous master
                    // answer is safe; another student's variant is not a substitute.
                    var answerReference = string.IsNullOrWhiteSpace(exportedReference)
                        ? benchmark.Resolve(sheetName, qMap.QuestionText, [], $"{testName}, {qMap.QuestionId}") ?? ""
                        : exportedReference;

                    // Код lcnwu5wcgk означает верный ответ, r1s987zw3e — неверный
                    attempt.Answers.Add(new AiUserAnswerDto
                    {
                        QuestionId = qMap.QuestionId,
                        UserAnswer = userAnswer,
                        ReferenceAnswer = answerReference,
                        IsCorrectByLms = isCorrectByLms,
                        // Выгрузка LMS не содержит время по вопросу. Отсутствующие
                        // данные нельзя подменять синтетикой: это создает ложные аномалии.
                        TimeSpentSeconds = null
                    });
                }
                else
                {
                    benchmark.ExcludedEmptyAnswers++;
                }
            }

            testPayload.StudentAttempts.Add(attempt);
        }

        return testPayload;
    }

    private static List<string> ParseCsvLine(string line, char delimiter = ',')
    {
        var result = new List<string>();
        var currentField = new StringBuilder();
        bool inQuotes = false;

        for (int i = 0; i < line.Length; i++)
        {
            char c = line[i];
            if (c == '"')
            {
                if (inQuotes && i + 1 < line.Length && line[i + 1] == '"')
                {
                    currentField.Append('"'); // Читаем экранированную кавычку ""
                    i++;
                }
                else
                {
                    inQuotes = !inQuotes; // Переключаем режим кавычек
                }
            }
            else if (c == delimiter && !inQuotes)
            {
                result.Add(currentField.ToString().Trim());
                currentField.Clear();
            }
            else
            {
                currentField.Append(c);
            }
        }
        result.Add(currentField.ToString().Trim());
        return result;
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

    public static string ExtractCourseName(string fileName)
    {
        int dashIdx = fileName.IndexOf(" - ");
        if (dashIdx != -1) return fileName.Substring(0, dashIdx).Replace("Эталон ответов ", "").Trim();
        return "Электронный курс";
    }

    public static string ExtractTestName(string fileName)
    {
        int dashIdx = fileName.IndexOf(" - ");
        if (dashIdx != -1)
        {
            int dotIdx = fileName.LastIndexOf('.');
            return fileName.Substring(dashIdx + 3, dotIdx - (dashIdx + 3)).Trim();
        }
        return Path.GetFileNameWithoutExtension(fileName);
    }

    private string CleanText(string text)
    {
        if (string.IsNullOrEmpty(text)) return text;
        // Убираем лишние кавычки по краям, которые могли остаться после парсинга CSV
        if (text.StartsWith("\"") && text.EndsWith("\"") && text.Length > 1)
        {
            text = text.Substring(1, text.Length - 2);
        }
        return text.Trim().Replace("\"\"", "\"");
    }
}
