using ApiCore.Services;
using System.Text.Json;

var jsonMode = args.Length == 3 && args[0] == "--json";
var paths = jsonMode ? args.Skip(1).ToArray() : args;
if (paths.Length != 2)
{
    Console.Error.WriteLine("Usage: ParserSmoke [--json] <benchmark> <student-responses>");
    return 2;
}

var payload = new FileParser().ParseToBatchRequest(paths[0], [paths[1]]);
if (payload.Tests.Count == 0)
    throw new InvalidDataException("No tests were parsed.");

if (payload.Tests.Any(test => test.Questions.Count == 0 || test.StudentAttempts.Count == 0))
    throw new InvalidDataException("Questions or student attempts were not parsed.");

var unmatched = payload.Tests
    .SelectMany(test => test.Questions
        .Where(question => question.ReferenceAnswer == "Эталонный ответ не найден в мастер-файле")
        .Select(question => $"{test.TestName}: {question.QuestionText}"))
    .ToList();
if (unmatched.Count > 0)
    throw new InvalidDataException($"Benchmark answers were not matched:\n{string.Join("\n", unmatched)}");

if (payload.Tests.SelectMany(test => test.StudentAttempts)
    .SelectMany(attempt => attempt.Answers)
    .Any(answer => answer.TimeSpentSeconds is not null))
    throw new InvalidDataException("Missing LMS timings must remain null.");

var questionCount = payload.Tests.Sum(test => test.Questions.Count);
var attemptCount = payload.Tests.Sum(test => test.StudentAttempts.Count);
var answerCount = payload.Tests.SelectMany(test => test.StudentAttempts).Sum(attempt => attempt.Answers.Count);
if (jsonMode)
{
    var criticalRates = payload.Tests.SelectMany(test => test.Questions.Select(question =>
    {
        var answers = test.StudentAttempts.SelectMany(attempt => attempt.Answers)
            .Where(answer => answer.QuestionId == question.QuestionId).ToList();
        if (answers.Count == 0) return (double?)null;
        var failed = answers.Count(answer => !answer.IsCorrectByLms);
        var rate = Math.Round(failed * 100.0 / answers.Count, 1);
        return rate >= 40.0 ? rate : null;
    })).Where(rate => rate.HasValue).Select(rate => rate!.Value).ToList();
    Console.WriteLine(JsonSerializer.Serialize(new
    {
        tests = payload.Tests.Select(test => test.TestName).ToList(),
        questions = questionCount,
        attempts = attemptCount,
        answers = answerCount,
        correct_answers = payload.Tests.SelectMany(test => test.StudentAttempts)
            .SelectMany(attempt => attempt.Answers).Count(answer => answer.IsCorrectByLms),
        students = payload.Tests.SelectMany(test => test.StudentAttempts)
            .Select(attempt => attempt.StudentId).Distinct().ToList(),
        critical_rates = criticalRates,
    }));
    return 0;
}
Console.WriteLine($"OK: {payload.Tests.Count} tests, {questionCount} questions, {attemptCount} attempts, {answerCount} answers parsed.");
return 0;
