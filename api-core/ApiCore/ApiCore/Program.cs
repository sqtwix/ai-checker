using ApiCore.Data;
using ApiCore.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.OpenApi.Any;
using Microsoft.OpenApi.Models; // Добавить этот using

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("DefaultConnection")));

builder.Services.AddControllers();

// Настраиваем генератор OpenAPI .NET 9 через OperationTransformer
builder.Services.AddOpenApi(options =>
{
    options.AddOperationTransformer((operation, context, cancellationToken) =>
    {
        // Находим нашу ручку загрузки файлов по её относительному пути
        if (context.Description.RelativePath != null &&
            context.Description.RelativePath.Contains("api/v1/analysis/upload", StringComparison.OrdinalIgnoreCase))
        {
            // Инициализируем RequestBody и полностью очищаем дефолтно сгенерированный мусор
            operation.RequestBody ??= new OpenApiRequestBody();
            operation.RequestBody.Content.Clear();

            // Создаем чистую, правильную схему для формы multipart/form-data
            var formSchema = new OpenApiSchema
            {
                Type = "object",
                Required = new HashSet<string> { "benchmarkFile", "userResponseFiles" }
            };

            // 1. Поле для одиночного эталонного файла (мапим в тип string с форматом binary)
            formSchema.Properties.Add("benchmarkFile", new OpenApiSchema
            {
                Type = "string",
                Format = "binary",
                Description = "Эталонный файл с ответами курса (.csv / .json)"
            });

            // 2. Поле для массива файлов с ответами студентов (массив строк с форматом binary)
            formSchema.Properties.Add("userResponseFiles", new OpenApiSchema
            {
                Type = "array",
                Items = new OpenApiSchema
                {
                    Type = "string",
                    Format = "binary"
                },
                Description = "Массив файлов с реальными ответами студентов"
            });

            // 3. Поле для выбора модели нейросети с дефолтным значением
            formSchema.Properties.Add("modelType", new OpenApiSchema
            {
                Type = "string",
                Default = new OpenApiString("deepseek"),
                Description = "Модель ИИ (deepseek или gigachat)"
            });

            // Записываем собранный multipart/form-data в контракт операции
            operation.RequestBody.Content.Add("multipart/form-data", new OpenApiMediaType
            {
                Schema = formSchema
            });
        }

        return Task.CompletedTask;
    });
});

// Регистрация сервисов в DI
builder.Services.AddSingleton<ValidationService>();
builder.Services.AddScoped<FileParser>();
builder.Services.AddHttpClient<AnalysisService>();

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

using (var scope = app.Services.CreateScope())
{
    var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    dbContext.Database.EnsureCreated();
}

app.UseAuthorization();
app.MapControllers();
app.Run();