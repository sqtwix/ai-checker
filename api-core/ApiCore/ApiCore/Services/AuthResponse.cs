using System.Text.Json.Serialization;

namespace ApiCore.Services;

public class AuthResponse
{
    [JsonPropertyName("token")]
    public string Token { get; set; } = string.Empty;


    [JsonPropertyName("username")]
    public string Username { get; set; } = string.Empty;
}

