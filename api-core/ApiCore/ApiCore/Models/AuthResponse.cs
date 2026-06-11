using System.Text.Json.Serialization;

namespace ApiCore.Models;

public class AuthResponse
{
    [JsonPropertyName("token")]
    public string Token { get; set; } = string.Empty;


    [JsonPropertyName("username")]
    public string Username { get; set; } = string.Empty;
}

