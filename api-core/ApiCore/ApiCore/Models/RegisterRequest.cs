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
    [JsonPropertyName("username")]
    public string Username { get; set; } = string.Empty;

    [Required]
    [EmailAddress(ErrorMessage = "Невалидный формат почты")]
    [JsonPropertyName("email")]
    public string Email { get; set; }

    [Required]
    [MinLength(6, ErrorMessage = "Пароль должен быть не менее 6 символов.")]
    [JsonPropertyName("password")]
    public string Password { get; set; } = string.Empty;
}