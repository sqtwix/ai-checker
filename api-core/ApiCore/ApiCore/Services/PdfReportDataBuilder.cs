using ApiCore.Models;
using System.Text.Json;

namespace ApiCore.Services;

// Export-only source facts. Does not change LMS grades or the analysis result.
public static class PdfReportDataBuilder
{
    public static JsonElement Build(CourseBatchAnalysisRequest source)
    {
        var tests = source.Tests.Select(test =>
        {
            var answers = test.StudentAttempts.SelectMany(attempt => attempt.Answers).ToList();
            return new
            {
                name = test.TestName,
                attempts = test.StudentAttempts.Count,
                answers = answers.Count,
                correct = answers.Count(answer => answer.IsCorrectByLms),
                wrong_blank = answers.Count(answer => !answer.IsCorrectByLms && string.IsNullOrWhiteSpace(answer.UserAnswer)),
                questions = test.Questions.Select((question, index) =>
                {
                    var rows = test.StudentAttempts.SelectMany(attempt => attempt.Answers
                        .Where(answer => answer.QuestionId == question.QuestionId)
                        .Select(answer => new { answer, attempt.StudentId })).ToList();
                    var wrong = rows.Where(row => !row.answer.IsCorrectByLms).ToList();
                    var patterns = wrong.GroupBy(row => row.answer.UserAnswer.Trim().ToLowerInvariant())
                        .Select(group => new
                        {
                            text = group.First().answer.UserAnswer.Trim(), count = group.Count(),
                            students = group.Select(row => row.StudentId).Distinct().Count()
                        }).OrderByDescending(pattern => pattern.count).ToList();
                    return new
                    {
                        id = question.QuestionId, number = index + 1, text = question.QuestionText,
                        references = rows.Select(row => row.answer.ReferenceAnswer)
                            .Where(value => !string.IsNullOrWhiteSpace(value)).DefaultIfEmpty(question.ReferenceAnswer).Distinct().ToList(),
                        answers = rows.Count, correct = rows.Count - wrong.Count,
                        wrong = wrong.Count,
                        fail_rate = rows.Count == 0 ? (double?)null : wrong.Count * 100.0 / rows.Count,
                        wrong_patterns = patterns,
                        repeated_groups = patterns.Count(pattern => pattern.students >= 2 && !string.IsNullOrWhiteSpace(pattern.text)
                            && !new[] { "неверный ответ", "неправильный ответ", "ошибка", "incorrect" }.Contains(pattern.text.ToLowerInvariant()))
                    };
                }).ToList()
            };
        }).ToList();
        return JsonSerializer.SerializeToElement(new { version = 1, tests });
    }
}
