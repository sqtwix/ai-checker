using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace ApiCore.Models;

public class LoginRequest
{
    [Required]
    [EmailAddress(ErrorMessage = "Невалидный формат почты")]
    [RegularExpression(@"^[^\s@]+@[^\s@]+\.[^\s@]+$", ErrorMessage = "Невалидный формат почты")]
    [MaxLength(254)]
    [JsonPropertyName("email")]
    public string Email { get; set; } = string.Empty;

    [Required]
    [MaxLength(1024)]
    [JsonPropertyName("password")]
    public string Password { get; set; } = string.Empty;
}
