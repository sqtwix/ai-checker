using ApiCore.Models;
using ApiCore.Services;
using System.Text;

internal static class ParserRegression
{
    private const string Header = "Пользователь;Дата;Статус;Баллы;Вопрос;;;";
    private const string Subheader = ";;;;Тип;Результат;Ответ;Правильный ответ";
    private const string Benchmark = "Вопрос\nПравильный ответ\nА";

    private static CourseBatchAnalysisRequest Parse(string benchmark, params string[] rows)
    {
        var directory = Path.Combine(Path.GetTempPath(), "parser-regression-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var masterPath = Path.Combine(directory, "master.csv");
        var responsePath = Path.Combine(directory, "responses.csv");
        try
        {
            File.WriteAllText(masterPath, benchmark, new UTF8Encoding(true));
            File.WriteAllText(responsePath, string.Join("\n", rows), new UTF8Encoding(true));
            return new FileParser().ParseToBatchRequest(masterPath, [responsePath]);
        }
        finally
        {
            File.Delete(masterPath);
            File.Delete(responsePath);
            Directory.Delete(directory);
        }
    }

    private static void Check(bool condition, string message)
    {
        if (!condition) throw new Exception(message);
    }

    public static int Run()
    {
        var parsed = Parse(Benchmark, Header, Subheader,
            "u1;date;done;100;single;lcnwu5wcgk;А;А",
            "u2;date;done;0;;;;",
            "u3;date;done;0;text;r1s987zw3e;;А",
            ";;;;;;;",
            "u4;date;done;0;text;unknown;Б;А",
            "u5;date;done;0;text;r1s987zw3e");
        var attempts = parsed.Tests.Single().StudentAttempts;
        Check(attempts.Count == 5, "Blank row created an attempt");
        Check(attempts.SelectMany(a => a.Answers).Count() == 3, "Missing or unknown grades counted as errors");
        Check(attempts.SelectMany(a => a.Answers).Count(a => a.IsCorrectByLms) == 1, "Correct count changed");
        Check(attempts[2].Answers.Single().UserAnswer == "", "Explicitly graded empty answer was lost");
        Check(attempts[4].Answers.Single().UserAnswer == "", "Short CSV row lost an explicit wrong grade");
        Check(parsed.InputWarnings.Any(w => w.Contains("оценки LMS")), "Unknown grade was silently discarded");

        var reversed = Parse("Вопрос;Вопрос\nПравильный ответ;Правильный ответ\nА;Б",
            Header + ";Вопрос;;;", Subheader + ";Тип;Результат;Ответ;Правильный ответ",
            "u1;date;done;100;single;lcnwu5wcgk;Б;Б;single;lcnwu5wcgk;А;А");
        Check(reversed.Tests[0].Questions.Select(q => q.ReferenceAnswer).SequenceEqual(new[] { "Б", "А" }), "Repeated prompts matched by ordinal instead of LMS reference");

        var variants = Parse(Benchmark, Header, Subheader,
            "u1;date;done;100;single;lcnwu5wcgk;А;А",
            "u1;date;done;0;single;r1s987zw3e;В;Б");
        Check(variants.Tests[0].StudentAttempts.Select(a => a.AttemptId).Distinct().Count() == 2, "Repeated attempts collapsed");
        Check(variants.Tests[0].StudentAttempts[1].Answers[0].ReferenceAnswer == "Б", "Per-answer reference was lost");
        Check(variants.InputWarnings.Count == 2, "Conflicting references were not disclosed");

        foreach (var invalid in new[] {
            ("Другой вопрос\nПравильный ответ\nА", "u1;date;done;100;single;lcnwu5wcgk;А;А"),
            ("Вопрос;Вопрос\nПравильный ответ;Правильный ответ\nА;Б", "u1;date;done;0;text;r1s987zw3e;В;"),
            (Benchmark, "u1;date;done;0;;;;")
        })
        {
            var rejected = false;
            try { Parse(invalid.Item1, Header, Subheader, invalid.Item2); }
            catch (InvalidDataException) { rejected = true; }
            Check(rejected, "Invalid or ungraded source was silently accepted");
        }
        Console.WriteLine("OK: blank rows, missing grades, explicit empty answers, short CSV, repeated attempts, reference variants and invalid sources.");
        return 0;
    }
}
