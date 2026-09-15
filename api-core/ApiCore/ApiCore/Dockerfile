FROM mcr.microsoft.com/dotnet/aspnet:9.0@sha256:b1201ee0ccf9a22c06844982296c1be40d5ff9c7685dc002729f204e63fb1730 AS base
WORKDIR /app
EXPOSE 5000
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

FROM mcr.microsoft.com/dotnet/sdk:9.0@sha256:f190d2dd9eef2899c91ac323caa0bd2b39334a5400ba93013e5199da39dad940 AS build
WORKDIR /src

COPY ["*.csproj", "."]
RUN dotnet restore

COPY . .
RUN dotnet build -c Release -o /app/build

FROM build AS publish
RUN dotnet publish -c Release -o /app/publish /p:UseAppHost=false

FROM base AS final
WORKDIR /app
COPY --from=publish /app/publish .

RUN mkdir -p /var/lib/ai-checker/jobs && chown -R app:app /var/lib/ai-checker
USER app

ENV ASPNETCORE_URLS=http://+:5000

ENTRYPOINT ["dotnet", "ApiCore.dll"]
