using System.Text;
using ApiCore.Data;
using ApiCore.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer; // Добавить этот using
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Any;
using Microsoft.OpenApi.Models;

var builder = WebApplication.CreateBuilder(args);

// 1. Подключение PostgreSQL
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("DefaultConnection")));

builder.Services.AddControllers();

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontend", policy =>
    {
        policy.WithOrigins("http://localhost:5173", "http://127.0.0.1:5173")
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});

// 2. НАСТРОЙКА JWT ВАЛИДАЦИИ (Этого блока не хватало)
var jwtSettings = builder.Configuration.GetSection("JwtSettings");
var secretKey = jwtSettings["Secret"] ?? throw new InvalidOperationException("JWT Secret is missing.");

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
                Description = "Эталонный файл с ответами курса (.csv / .json)"
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
                Description = "Модель ИИ (deepseek или gigachat)"
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
builder.Services.AddHttpClient<AnalysisService>(client =>
{
    var aiDriverUrl = builder.Configuration["AiDriver:Url"] ?? "http://localhost:8000";
    client.BaseAddress = new Uri(aiDriverUrl.EndsWith("/") ? aiDriverUrl : aiDriverUrl + "/");
    client.Timeout = TimeSpan.FromMinutes(5); // Увеличиваем таймаут для медленных CPU запусков локальных моделей
});

var app = builder.Build();

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
            dbContext.Database.EnsureCreated();

            // Гарантируем создание таблицы для существующих баз данных (EnsureCreated не создает новые таблицы в существующей БД)
            dbContext.Database.ExecuteSqlRaw(@"
                CREATE TABLE IF NOT EXISTS analysis_reports (
                    id VARCHAR(255) PRIMARY KEY,
                    user_id UUID NOT NULL,
                    course_name VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
                    status VARCHAR(50) NOT NULL,
                    result_json JSONB,
                    error TEXT,
                    CONSTRAINT fk_analysis_reports_users FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS ix_analysis_reports_user_id ON analysis_reports (user_id);
            ");

            // Также гарантируем наличие колонки settings_json в таблице users
            dbContext.Database.ExecuteSqlRaw(@"
                ALTER TABLE users ADD COLUMN IF NOT EXISTS settings_json JSONB;
            ");
        }
        Console.WriteLine(">>>> [УСПЕХ] Успешное подключение к PostgreSQL.");
        break;
    }
    catch
    {
        if (retry == 4) throw;
        Console.WriteLine($">>>> [ОЖИДАНИЕ] База данных еще создается (Попытка {retry + 1}/5)...");
        Thread.Sleep(2000);
    }
}

// 6. MIDDLEWARE (Порядок строго критичен!)
app.UseCors("AllowFrontend");
app.UseAuthentication(); // СНАЧАЛА: Расшифровываем токен и узнаем кто это
app.UseAuthorization();  // ЗАТЕМ: Проверяем права доступа к методам

// Глобальная защита эндпоинтов
app.MapControllers().RequireAuthorization();

app.Run();