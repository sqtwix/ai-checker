using System.Text.Json.Serialization;

namespace ApiCore.Models;

public class CourseBatchAnalysisResult
{
    [JsonPropertyName("batch_id")]
    public string BatchId { get; set; } = string.Empty;

    [JsonPropertyName("global_course_summary")]
    public string GlobalCourseSummary { get; set; } = string.Empty;

    [JsonPropertyName("test_summaries")]
    public List<TestSummaryDto> TestSummaries { get; set; } = new();

    [JsonPropertyName("student_detailed_analyses")]
    public List<StudentDetailedAnalysisDto> StudentDetailedAnalyses { get; set; } = new();

    [JsonPropertyName("anomalies")]
    public List<AiAnomalyDto> Anomalies { get; set; } = new();

    [JsonPropertyName("course_recommendations")]
    public List<AiRecommendationDto> CourseRecommendations { get; set; } = new();
}

public class TestSummaryDto
{
    [JsonPropertyName("test_name")]
    public string TestName { get; set; } = string.Empty;

    [JsonPropertyName("critical_mass_errors")]
    public List<CriticalMassErrorDto> CriticalMassErrors { get; set; } = new();
}

public class CriticalMassErrorDto
{
    [JsonPropertyName("question_id")]
    public string QuestionId { get; set; } = string.Empty;

    [JsonPropertyName("fail_rate_percent")]
    public double FailRatePercent { get; set; }

    [JsonPropertyName("error_pattern_description")]
    public string ErrorPatternDescription { get; set; } = string.Empty;

    [JsonPropertyName("methodological_reason")]
    public string MethodologicalReason { get; set; } = string.Empty;
}

public class StudentDetailedAnalysisDto
{
    [JsonPropertyName("student_id")]
    public string StudentId { get; set; } = string.Empty;

    [JsonPropertyName("test_name")]
    public string TestName { get; set; } = string.Empty;

    [JsonPropertyName("question_id")]
    public string QuestionId { get; set; } = string.Empty;

    [JsonPropertyName("ai_score_percent")]
    public double AiScorePercent { get; set; } // Оценка совпадения с эталоном от ИИ (0-100)

    [JsonPropertyName("uniqueness_status")]
    public string UniquenessStatus { get; set; } = "Normal"; // Normal, SuspiciousMatch, UniqueError

    [JsonPropertyName("error_explanation")]
    public string ErrorExplanation { get; set; } = string.Empty; // Глубокий разбор конкретной ошибки студента
}

public class AiAnomalyDto
{
    [JsonPropertyName("student_id")]
    public string StudentId { get; set; } = string.Empty;

    [JsonPropertyName("anomaly_type")]
    public string AnomalyType { get; set; } = string.Empty; // SpeedCheating, ExtremeStruggling

    [JsonPropertyName("severity")]
    public string Severity { get; set; } = string.Empty; // High, Medium, Low

    [JsonPropertyName("description")]
    public string Description { get; set; } = string.Empty;
}

public class AiRecommendationDto
{
    [JsonPropertyName("target")]
    public string Target { get; set; } = string.Empty;

    [JsonPropertyName("action_item")]
    public string ActionItem { get; set; } = string.Empty;

    [JsonPropertyName("priority")]
    public string Priority { get; set; } = string.Empty; // High, Medium, Low
}