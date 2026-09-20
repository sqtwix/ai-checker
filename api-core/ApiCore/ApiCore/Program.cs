using System.Text;
using ApiCore.Data;
using ApiCore.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer; // Добавить этот using
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Any;
using Microsoft.OpenApi.Models;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using System.Threading.RateLimiting;

var builder = WebApplication.CreateBuilder(args);

// 1. Подключение PostgreSQL
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("DefaultConnection")));

builder.Services.AddControllers();

var maxUploadSizeMb = builder.Configuration.GetValue<long?>("Uploads:MaxRequestSizeMb") ?? 100;
builder.WebHost.ConfigureKestrel(options =>
{
    options.Limits.MaxRequestBodySize = maxUploadSizeMb * 1024 * 1024;
});
builder.Services.Configure<FormOptions>(options =>
{
    options.MultipartBodyLengthLimit = maxUploadSizeMb * 1024 * 1024;
});

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontend", policy =>
    {
        var configuredOrigins = builder.Configuration
            .GetSection("Cors:AllowedOrigins")
            .Get<string[]>() ?? ["http://localhost:5173", "http://127.0.0.1:5173"];

        policy.WithOrigins(configuredOrigins)
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});

// 2. НАСТРОЙКА JWT ВАЛИДАЦИИ (Этого блока не хватало)
var jwtSettings = builder.Configuration.GetSection("JwtSettings");
var secretKey = jwtSettings["Secret"] ?? throw new InvalidOperationException("JWT Secret is missing.");
if (secretKey.Length < 32)
{
    throw new InvalidOperationException("JWT Secret must contain at least 32 characters.");
}

builder.Services.AddAuthentication(options =>
{
    options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
    options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
})
.AddJwtBearer(options =>
{
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = true,
        ValidateAudience = true,
        ValidateLifetime = true,
        ValidateIssuerSigningKey = true,
        ValidIssuer = jwtSettings["Issuer"],
        ValidAudience = jwtSettings["Audience"],
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secretKey)),
        ClockSkew = TimeSpan.Zero
    };
});

builder.Services.AddAuthorization();
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("auth", context => RateLimitPartition.GetFixedWindowLimiter(
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 20,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0
        }));
    options.AddPolicy("uploads", context => RateLimitPartition.GetFixedWindowLimiter(
        context.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
            ?? context.Connection.RemoteIpAddress?.ToString()
            ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 10,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0
        }));
});

// 3. НАСТРОЙКА OPENAPI / SWAGGER
builder.Services.AddOpenApi(options =>
{
    // ТРАНСФОРМЕР ОПЕРАЦИЙ: Логика для конкретных ручек (файлы + вешаем замочки)
    options.AddOperationTransformer((operation, context, cancellationToken) =>
    {
        // Кастомная схема для multipart/form-data (ручка загрузки файлов)
        if (context.Description.RelativePath != null &&
            context.Description.RelativePath.Contains("api/v1/analysis/upload", StringComparison.OrdinalIgnoreCase))
        {
            operation.RequestBody ??= new OpenApiRequestBody();
            operation.RequestBody.Content.Clear();

            var formSchema = new OpenApiSchema
            {
                Type = "object",
                Required = new HashSet<string> { "benchmarkFile", "userResponseFiles" }
            };

            formSchema.Properties.Add("benchmarkFile", new OpenApiSchema
            {
                Type = "string",
                Format = "binary",
                Description = "Эталонный файл с ответами курса (.csv / .xls / .xlsx)"
            });

            formSchema.Properties.Add("userResponseFiles", new OpenApiSchema
            {
                Type = "array",
                Items = new OpenApiSchema { Type = "string", Format = "binary" },
                Description = "Массив файлов с реальными ответами студентов"
            });

            formSchema.Properties.Add("modelType", new OpenApiSchema
            {
                Type = "string",
                Default = new OpenApiString("deepseek"),
                Description = "Модель ИИ (deepseek, gigachat или local_llm)"
            });

            operation.RequestBody.Content.Add("multipart/form-data", new OpenApiMediaType
            {
                Schema = formSchema
            });
        }

        // АВТО-ПРИВЯЗКА ЗАМОЧКА: Если ручка закрыта авторизацией, добавляем требование JWT
        var isAuthAction = context.Description.RelativePath?.Contains("api/v1/auth", StringComparison.OrdinalIgnoreCase) ?? false;
        if (!isAuthAction)
        {
            operation.Security ??= new List<OpenApiSecurityRequirement>();
            var securityScheme = new OpenApiSecurityScheme
            {
                Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "Bearer" }
            };
            operation.Security.Add(new OpenApiSecurityRequirement { [securityScheme] = Array.Empty<string>() });
        }

        return Task.CompletedTask;
    });

    // ТРАНСФОРМЕР ДОКУМЕНТА: Глобальные настройки (Сервер + Кнопка Authorize)
    options.AddDocumentTransformer((document, context, cancellationToken) =>
    {
        // Фикс адреса сервера для Docker
        document.Servers.Clear();
        document.Servers.Add(new OpenApiServer
        {
            Url = "http://localhost:5000",
            Description = "Локальный Docker контейнер"
        });

        // Регистрируем саму схему авторизации "Bearer" в компонентах OpenAPI
        document.Components ??= new OpenApiComponents();
        document.Components.SecuritySchemes.Add("Bearer", new OpenApiSecurityScheme
        {
            Name = "Authorization",
            Type = SecuritySchemeType.Http,
            Scheme = "bearer",
            BearerFormat = "JWT",
            In = ParameterLocation.Header,
            Description = "Введите ваш JWT токен. Слово 'Bearer' подставится автоматически."
        });

        return Task.CompletedTask;
    });
});

// 4. Регистрация сервисов в DI
builder.Services.AddSingleton<ValidationService>();
builder.Services.AddScoped<FileParser>();
builder.Services.AddScoped<AuthService>();
builder.Services.AddScoped<ReportsService>();
builder.Services.AddHostedService<AnalysisWorker>();
builder.Services.AddHttpClient<AnalysisService>(client =>
{
    var aiDriverUrl = builder.Configuration["AiDriver:Url"] ?? "http://localhost:8000";
    client.BaseAddress = new Uri(aiDriverUrl.EndsWith("/") ? aiDriverUrl : aiDriverUrl + "/");
    var timeoutSeconds = Math.Clamp(
        builder.Configuration.GetValue<int?>("AnalysisQueue:PipelineTimeoutSeconds") ?? 1200,
        60,
        3600);
    client.Timeout = TimeSpan.FromSeconds(timeoutSeconds);
});
builder.Services.AddHttpClient<AiProviderAvailabilityService>(client =>
{
    var aiDriverUrl = builder.Configuration["AiDriver:Url"] ?? "http://localhost:8000";
    client.BaseAddress = new Uri(aiDriverUrl.EndsWith("/") ? aiDriverUrl : aiDriverUrl + "/");
    client.Timeout = TimeSpan.FromSeconds(5);
});
builder.Services.AddHttpClient("ai-driver-health", client =>
{
    var aiDriverUrl = builder.Configuration["AiDriver:Url"] ?? "http://localhost:8000";
    client.BaseAddress = new Uri(aiDriverUrl.EndsWith("/") ? aiDriverUrl : aiDriverUrl + "/");
    client.Timeout = TimeSpan.FromSeconds(3);
});

var app = builder.Build();

var forwardedHeadersOptions = new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
    ForwardLimit = 1
};
// Production API is reachable only from the internal Compose network. Trust the
// single frontend proxy hop so per-client rate limits do not collapse to the
// nginx container address. Development publishes the API on loopback only.
forwardedHeadersOptions.KnownNetworks.Clear();
forwardedHeadersOptions.KnownProxies.Clear();
app.UseForwardedHeaders(forwardedHeadersOptions);

app.Use(async (context, next) =>
{
    var incoming = context.Request.Headers["X-Correlation-ID"].FirstOrDefault();
    var correlationId = !string.IsNullOrWhiteSpace(incoming)
        && incoming.Length <= 64
        && incoming.All(character => char.IsLetterOrDigit(character) || character is '-' or '_' or '.')
            ? incoming
            : Guid.NewGuid().ToString("N");
    context.Response.Headers["X-Correlation-ID"] = correlationId;
    var started = System.Diagnostics.Stopwatch.StartNew();
    using (app.Logger.BeginScope(new Dictionary<string, object> { ["CorrelationId"] = correlationId }))
    {
        try
        {
            await next();
        }
        finally
        {
            app.Logger.LogInformation(
                "HTTP {Method} {Path} returned {StatusCode} in {ElapsedMs} ms",
                context.Request.Method,
                context.Request.Path,
                context.Response.StatusCode,
                started.Elapsed.TotalMilliseconds);
        }
    }
});

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.UseSwaggerUI(options =>
    {
        options.SwaggerEndpoint("/openapi/v1.json", "OpenAPI v1");
        options.RoutePrefix = "swagger";
    });
}

// 5. Инициализация СУБД с ретраями
for (int retry = 0; retry < 5; retry++)
{
    try
    {
        using (var scope = app.Services.CreateScope())
        {
            var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await dbContext.Database.MigrateAsync();
        }
        Console.WriteLine(">>>> [УСПЕХ] Успешное подключение к PostgreSQL.");

        // Jobs with a persisted payload are recoverable after an API restart.
        // Legacy jobs have no payload and therefore fail explicitly.
        using (var recoveryScope = app.Services.CreateScope())
        {
            var recoveryDb = recoveryScope.ServiceProvider.GetRequiredService<AppDbContext>();
            await recoveryDb.AnalysisReports
                .Where(report => report.Status == "Processing" && report.PayloadJson != null)
                .ExecuteUpdateAsync(update => update
                    .SetProperty(report => report.Status, "Retrying")
                    .SetProperty(report => report.NextRetryAt, DateTime.UtcNow)
                    .SetProperty(report => report.Error, "Обработка автоматически продолжена после перезапуска сервиса.")
                    .SetProperty(report => report.UpdatedAt, DateTime.UtcNow));
            var unrecoverableIds = await recoveryDb.AnalysisReports
                .Where(report =>
                    (report.Status == "Queued" || report.Status == "Retrying" || report.Status == "Processing")
                    && report.PayloadJson == null)
                .Select(report => report.Id)
                .ToListAsync();
            if (unrecoverableIds.Count > 0)
            {
                await recoveryDb.AnalysisReports
                    .Where(report => unrecoverableIds.Contains(report.Id))
                    .ExecuteUpdateAsync(update => update
                    .SetProperty(report => report.Status, "Failed")
                    .SetProperty(report => report.NextRetryAt, (DateTime?)null)
                    .SetProperty(report => report.Error, "Задачу нельзя восстановить после перезапуска сервиса. Запустите анализ повторно.")
                    .SetProperty(report => report.UpdatedAt, DateTime.UtcNow));

                var jobsRoot = Path.GetFullPath(builder.Configuration["AnalysisQueue:JobsDirectory"]
                    ?? Path.Combine(Directory.GetCurrentDirectory(), "analysis_jobs"));
                foreach (var id in unrecoverableIds.Where(id => Guid.TryParse(id, out _)))
                {
                    var abandonedDirectory = Path.Combine(jobsRoot, id);
                    if (Directory.Exists(abandonedDirectory))
                    {
                        Directory.Delete(abandonedDirectory, true);
                        app.Logger.LogWarning("Removed unrecoverable job directory for analysis {TaskId}", id);
                    }
                }
            }
        }
        break;
    }
    catch
    {
        if (retry == 4) throw;
        Console.WriteLine($">>>> [ОЖИДАНИЕ] База данных еще создается (Попытка {retry + 1}/5)...");
        await Task.Delay(2000);
    }
}

// 6. MIDDLEWARE (Порядок строго критичен!)
app.UseCors("AllowFrontend");
app.UseAuthentication(); // СНАЧАЛА: Расшифровываем токен и узнаем кто это
app.UseRateLimiter();
app.UseAuthorization();  // ЗАТЕМ: Проверяем права доступа к методам

app.MapGet("/health/live", () => Results.Ok(new { status = "ok" }))
    .AllowAnonymous();

app.MapGet("/health/ready", async (AppDbContext dbContext, IHttpClientFactory httpClientFactory) =>
{
    var databaseReady = await dbContext.Database.CanConnectAsync();
    var aiDriverReady = false;
    try
    {
        using var response = await httpClientFactory.CreateClient("ai-driver-health").GetAsync("health");
        aiDriverReady = response.IsSuccessStatusCode;
    }
    catch (HttpRequestException) { }
    catch (TaskCanceledException) { }

    var payload = new { status = databaseReady && aiDriverReady ? "ready" : "unready", database = databaseReady, ai_driver = aiDriverReady };
    return databaseReady && aiDriverReady
        ? Results.Ok(payload)
        : Results.Json(payload, statusCode: StatusCodes.Status503ServiceUnavailable);
})
    .AllowAnonymous();

// Глобальная защита эндпоинтов
app.MapControllers().RequireAuthorization();

app.Run();
