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
    public string Status { get; set; } = string.Empty; // Queued, Processing, Retrying, Completed, Failed

    [Column("result_json", TypeName = "jsonb")]
    public string? ResultJson { get; set; }

    [Column("error")]
    public string? Error { get; set; }

    [Column("is_archived")]
    public bool IsArchived { get; set; } = false;

    [Column("payload_json", TypeName = "jsonb")]
    public string? PayloadJson { get; set; }

    [Column("model_type")]
    [MaxLength(30)]
    public string? ModelType { get; set; }

    [Column("attempt_count")]
    public int AttemptCount { get; set; }

    [Column("next_retry_at")]
    public DateTime? NextRetryAt { get; set; }

    [Column("started_at")]
    public DateTime? StartedAt { get; set; }

    [Column("updated_at")]
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
