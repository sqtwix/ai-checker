using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using ApiCore.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.IdentityModel.Tokens;

namespace ApiCore.Services;

public class AuthService
{
    private readonly IConfiguration _configuration;
    private readonly PasswordHasher<string> _passwordHasher = new();

    // Временная in-memory база данных пользователей для тестов MVP. 
    // Как только подключишь Postgres, этот список заменится на DbContext.
    private static readonly List<User> _usersDb = new();

    public AuthService(IConfiguration configuration)
    {
        _configuration = configuration;
    }

    public async Task<AuthResponse?> RegisterAsync(RegisterRequest request)
    {
        // Проверяем, не занято ли имя пользователя
        if (_usersDb.Any(u => u.Username.Equals(request.Username, StringComparison.OrdinalIgnoreCase)))
        {
            return null; // Или выбросить кастомное исключение
        }

        var newUser = new User
        {
            Id = Guid.NewGuid(),
            Username = request.Username,
            // Хэшируем пароль перед сохранением (Критически важно для безопасности!)
            PasswordHash = _passwordHasher.HashPassword(request.Username, request.Password)
        };

        _usersDb.Add(newUser);

        // После регистрации автоматически генерируем токен, чтобы пользователю не нужно было логиниться
        var token = GenerateJwtToken(newUser);

        return new AuthResponse { Token = token, Username = newUser.Username };
    }

    public async Task<AuthResponse?> LoginAsync(LoginRequest request)
    {
        // Ищем пользователя в базе
        var user = _usersDb.FirstOrDefault(u => u.Username.Equals(request.Username, StringComparison.OrdinalIgnoreCase));
        if (user == null) return null;

        // Проверяем соответствие сырого пароля сохраненному хэшу
        var verificationResult = _passwordHasher.VerifyHashedPassword(user.Username, user.PasswordHash, request.Password);
        if (verificationResult == PasswordVerificationResult.Failed)
        {
            return null;
        }

        var token = GenerateJwtToken(user);
        return new AuthResponse { Token = token, Username = user.Username };
    }

    private string GenerateJwtToken(User user)
    {
        var jwtSettings = _configuration.GetSection("JwtSettings");
        var secretKey = jwtSettings["Secret"] ?? throw new InvalidOperationException("JWT Secret is missing.");
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secretKey));

        // Полезная нагрузка токена (Claims) — данные, которые зашиты внутри токена
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Name, user.Username),
            new Claim(ClaimTypes.Role, "Methodist") // Роль по умолчанию для твоего ТЗ
        };

        var signingCredentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var tokenDescriptor = new SecurityTokenDescriptor
        {
            Subject = new ClaimsIdentity(claims),
            Issuer = jwtSettings["Issuer"],
            Audience = jwtSettings["Audience"],
            Expires = DateTime.UtcNow.AddMinutes(double.Parse(jwtSettings["ExpiryMinutes"] ?? "60")),
            SigningCredentials = signingCredentials
        };

        var tokenHandler = new JwtSecurityTokenHandler();
        var securityToken = tokenHandler.CreateToken(tokenDescriptor);

        return tokenHandler.WriteToken(securityToken);
    }
}