using ApiCore.Models;
using ApiCore.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace ApiCore.Controllers;

[ApiController]
[Route("api/v1/auth")]
public class AuthController : ControllerBase
{
    private readonly AuthService _authService;

    public AuthController(AuthService authService)
    {
        _authService = authService;
    }

    [HttpPost("register")]
    [AllowAnonymous]
    [EnableRateLimiting("auth")]
    [RequestSizeLimit(16_384)]
    public async Task<IActionResult> Register([FromBody] RegisterRequest request)
    {
        if (request.Username.Trim().Length < 2)
        {
            return BadRequest(new { error = "Имя должно содержать не менее 2 символов без учёта пробелов." });
        }

        var result = await _authService.RegisterAsync(request);
        if (result == null)
        {
            return BadRequest(new { error = "Пользователь с такой почтой уже зарегистрирован." });
        }

        return Ok(result);
    }

    [HttpPost("login")]
    [AllowAnonymous]
    [EnableRateLimiting("auth")]
    [RequestSizeLimit(16_384)]
    public async Task<IActionResult> Login([FromBody] LoginRequest request)
    {
        var result = await _authService.LoginAsync(request);
        if (result == null)
        {
            return Unauthorized(new { error = "Неверное имя пользователя или пароль." });
        }

        return Ok(result);
    }
}
