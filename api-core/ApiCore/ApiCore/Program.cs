using ApiCore.Services;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.

builder.Services.AddControllers();
// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();

// Adding services for DI realization
builder.Services.AddSingleton<ValidationService>();
builder.Services.AddScoped<AnalysisService>();
builder.Services.AddScoped<FileParser>();

var app = builder.Build();


// Настройка конвейера HTTP-запросов
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi(); // Отдает JSON

    // Подключаем визуальный интерфейс SwaggerUI к JSON-файлу от .NET 9
    app.UseSwaggerUI(options =>
    {
        options.SwaggerEndpoint("/openapi/v1.json", "OpenAPI v1");
        options.RoutePrefix = "swagger"; // Страница будет доступна по адресу /swagger
    });
}

// Закомментируем для Docker, чтобы избежать бесконечного редиректа на нерабочий HTTPS-порт
// app.UseHttpsRedirection();

app.UseAuthorization();

app.MapControllers();

app.Run();
