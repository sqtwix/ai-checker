namespace ApiCore.Models;

public class AnalysisReportDto
{
    public string Id { get; set; } = string.Empty;
    public string CourseName { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public string Status { get; set; } = string.Empty;
    public CourseBatchAnalysisResult? Result { get; set; }
    public string? Error { get; set; }
    public bool IsArchived { get; set; }
}
