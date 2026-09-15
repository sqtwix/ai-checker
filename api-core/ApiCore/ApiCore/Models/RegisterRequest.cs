using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace ApiCore.Models;

/*
Моедль для регистрации нового пользователя. 
Содержит обязательные поля "username", "password", "email".
Пароль должен быть не менее 6 символов.
*/

public class RegisterRequest
{
    [Required]
    [StringLength(100, MinimumLength = 2, ErrorMessage = "Имя должно содержать от 2 до 100 символов.")]
    [RegularExpression(@".*\S.*", ErrorMessage = "Имя не может состоять только из пробелов.")]
    [JsonPropertyName("username")]
    public string Username { get; set; } = string.Empty;

    [Required]
    [EmailAddress(ErrorMessage = "Невалидный формат почты")]
    [RegularExpression(@"^[^\s@]+@[^\s@]+\.[^\s@]+$", ErrorMessage = "Невалидный формат почты")]
    [MaxLength(254)]
    [JsonPropertyName("email")]
    public string Email { get; set; } = string.Empty;

    [Required]
    [MinLength(6, ErrorMessage = "Пароль должен быть не менее 6 символов.")]
    [JsonPropertyName("password")]
    public string Password { get; set; } = string.Empty;
}
