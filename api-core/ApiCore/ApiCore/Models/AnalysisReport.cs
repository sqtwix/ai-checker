using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ApiCore.Models;

[Table("analysis_reports")]
public class AnalysisReport
{
    [Key]
    [Column("id")]
    public string Id { get; set; } = string.Empty;

    [Required]
    [Column("user_id")]
    public Guid UserId { get; set; }

    [Required]
    [Column("course_name")]
    public string CourseName { get; set; } = string.Empty;

    [Required]
    [Column("created_at")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    [Required]
    [Column("status")]
    public string Status { get; set; } = string.Empty; // Processing, Completed, Failed

    [Column("result_json", TypeName = "jsonb")]
    public string? ResultJson { get; set; }

    [Column("error")]
    public string? Error { get; set; }

    [Column("is_archived")]
    public bool IsArchived { get; set; } = false;
}
