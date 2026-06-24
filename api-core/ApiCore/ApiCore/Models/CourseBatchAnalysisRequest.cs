using System.Text.Json.Serialization;

namespace ApiCore.Models;
/*
 Набор классов, которые представляют JSON файл, 
 который отправляется в AI driver
 */

public class CourseBatchAnalysisRequest
{
    [JsonPropertyName("batch_id")]
    public string BatchId { get; set; } = string.Empty;

    [JsonPropertyName("course_name")]
    public string CourseName { get; set; } = string.Empty;

    [JsonPropertyName("tests")]
    public List<AiTestPayloadDto> Tests { get; set; } = new();
}

public class AiTestPayloadDto
{
    [JsonPropertyName("test_name")]
    public string TestName { get; set; } = string.Empty; // Промежуточный тест 1, Итоговый тест

    [JsonPropertyName("questions")]
    public List<AiQuestionDto> Questions { get; set; } = new();

    [JsonPropertyName("student_attempts")]
    public List<StudentAttemptDto> StudentAttempts { get; set; } = new();
}

public class AiQuestionDto
{
    [JsonPropertyName("question_id")]
    public string QuestionId { get; set; } = string.Empty;

    [JsonPropertyName("question_text")]
    public string QuestionText { get; set; } = string.Empty;

    [JsonPropertyName("question_type")]
    public string QuestionType { get; set; } = string.Empty;

    [JsonPropertyName("reference_answer")]
    public string ReferenceAnswer { get; set; } = string.Empty;
}

public class StudentAttemptDto
{
    [JsonPropertyName("student_id")]
    public string StudentId { get; set; } = string.Empty;

    [JsonPropertyName("completion_date")]
    public string CompletionDate { get; set; } = string.Empty;

    [JsonPropertyName("status")]
    public string Status { get; set; } = string.Empty;

    [JsonPropertyName("total_score_text")]
    public string TotalScoreText { get; set; } = string.Empty;

    [JsonPropertyName("answers")]
    public List<AiUserAnswerDto> Answers { get; set; } = new();
}

public class AiUserAnswerDto
{
    [JsonPropertyName("question_id")]
    public string QuestionId { get; set; } = string.Empty;

    [JsonPropertyName("user_answer")]
    public string UserAnswer { get; set; } = string.Empty;

    [JsonPropertyName("is_correct_by_lms")]
    public bool IsCorrectByLms { get; set; }

    [JsonPropertyName("time_spent_seconds")]
    public int TimeSpentSeconds { get; set; }
}