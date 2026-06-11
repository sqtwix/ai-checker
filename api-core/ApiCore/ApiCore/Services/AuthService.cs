using ApiCore.Data;
using ApiCore.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using System;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;

namespace ApiCore.Services;

public class AuthService
{
    private readonly IConfiguration _configuration;
    private readonly AppDbContext _context;
    private readonly PasswordHasher<string> _passwordHasher = new();

    public AuthService(IConfiguration configuration, AppDbContext context)
    {
        _configuration = configuration;
        _context = context;
    }

    public async Task<AuthResponse?> RegisterAsync(RegisterRequest request)
    {
        // Проверяем асинхронно, занято ли имя пользователя ИЛИ почта
        var userExists = await _context.Users
            .AnyAsync(u => u.Username.ToLower() == request.Username.ToLower()
                        || u.Email.ToLower() == request.Email.ToLower());

        if (userExists)
        {
            return null; 
        }

        var newUser = new User
        {
            Id = Guid.NewGuid(),
            Username = request.Username,
            Email = request.Email,
            PasswordHash = _passwordHasher.HashPassword(request.Username, request.Password)
        };

        await _context.Users.AddAsync(newUser);
        await _context.SaveChangesAsync();

        var token = GenerateJwtToken(newUser);
        return new AuthResponse { Token = token, Username = newUser.Username };
    }

    public async Task<AuthResponse?> LoginAsync(LoginRequest request)
    {
        // Ищем пользователя в БД по имени
        var user = await _context.Users
            .FirstOrDefaultAsync(u => u.Username.ToLower() == request.Username.ToLower());

        if (user == null) return null;

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

        // Полезная нагрузка токена (Claims)
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Name, user.Username),
            new Claim(ClaimTypes.Email, user.Email), // Добавили Claim с почтой внутрь токена!
            new Claim(ClaimTypes.Role, "Methodist")
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