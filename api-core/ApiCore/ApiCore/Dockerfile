    # Стейдж 1: Среда выполнения (Runtime) .NET 9
    FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS base
    WORKDIR /app
    EXPOSE 5000

    # Стейдж 2: Среда сборки (SDK) .NET 9
    FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
    WORKDIR /src

    # Копируем файл проекта и восстанавливаем зависимости
    COPY ["*.csproj", "."]
    RUN dotnet restore

    # Копируем весь остальной код бэкенда и собираем в режиме Release
    COPY . .
    RUN dotnet build -c Release -o /app/build

    # Стейдж 3: Публикация приложения
    FROM build AS publish
    RUN dotnet publish -c Release -o /app/publish /p:UseAppHost=false

    # Стейдж 4: Финальный легковесный образ
    FROM base AS final
    WORKDIR /app
    COPY --from=publish /app/publish .

    # Указываем переменные среды, чтобы .NET слушал именно порт 5000 внутри контейнера
    ENV ASPNETCORE_URLS=http://+:5000

    # Запуск приложения (если сборка называется иначе, замени ApiCore.dll на имя своей сборки)
    ENTRYPOINT ["dotnet", "ApiCore.dll"]