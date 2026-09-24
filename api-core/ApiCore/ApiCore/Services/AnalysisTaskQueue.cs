using ApiCore.Data;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace ApiCore.Services;

public sealed record AnalysisJobPayload(
    string BenchmarkPath,
    List<string> UserResponsePaths,
    string TempDirectory,
    string? CorrelationId = null);

/// <summary>
/// PostgreSQL-backed queue. Jobs survive API restarts and SKIP LOCKED makes
/// claiming safe when several API instances are used.
/// </summary>
public sealed class AnalysisWorker(
    IServiceScopeFactory scopeFactory,
    IConfiguration configuration,
    IHttpClientFactory httpClientFactory,
    ILogger<AnalysisWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            string? taskId = null;
            try
            {
                taskId = await ClaimNextJobAsync(stoppingToken);
                if (taskId == null)
                {
                    await Task.Delay(TimeSpan.FromSeconds(1), stoppingToken);
                    continue;
                }

                using var scope = scopeFactory.CreateScope();
                var service = scope.ServiceProvider.GetRequiredService<AnalysisService>();
                using var watchToken = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
                var cancellationWatch = WatchCancellationAsync(taskId, watchToken.Token);
                try { await service.ProcessQueuedAnalysisAsync(taskId, stoppingToken); }
                finally
                {
                    await watchToken.CancelAsync();
                    try { await cancellationWatch; }
                    catch (OperationCanceledException) when (watchToken.IsCancellationRequested) { }
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                logger.LogError(exception, "Unhandled queue failure for analysis {TaskId}", taskId);
                await Task.Delay(TimeSpan.FromSeconds(1), stoppingToken);
            }
        }
    }

    private async Task<string?> ClaimNextJobAsync(CancellationToken cancellationToken)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        var reports = await db.AnalysisReports.FromSqlRaw("""
            SELECT * FROM analysis_reports
            WHERE status IN ('Queued', 'Retrying', 'Cancelling', 'Cancelled')
              AND payload_json IS NOT NULL
              AND (next_retry_at IS NULL OR next_retry_at <= NOW())
            ORDER BY created_at
            FOR UPDATE SKIP LOCKED
            LIMIT 1
            """).ToListAsync(cancellationToken);
        var report = reports.SingleOrDefault();
        if (report == null)
        {
            await transaction.CommitAsync(cancellationToken);
            return null;
        }

        var maxAttempts = Math.Clamp(configuration.GetValue<int?>("AnalysisQueue:MaxAttempts") ?? 3, 1, 10);
        if (report.Status is "Cancelling" or "Cancelled")
        {
            TryDeleteJobFiles(report.PayloadJson, logger);
            report.Status = "Cancelled";
            report.Error = "Анализ остановлен пользователем.";
            report.PayloadJson = null;
            report.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return null;
        }
        if (report.AttemptCount >= maxAttempts)
        {
            TryDeleteJobFiles(report.PayloadJson, logger);
            report.Status = "Failed";
            report.Error = "Не удалось выполнить анализ после нескольких попыток. Проверьте провайдера и повторите запуск.";
            report.PayloadJson = null;
            report.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return null;
        }

        report.Status = "Processing";
        report.AttemptCount += 1;
        report.StartedAt = DateTime.UtcNow;
        report.UpdatedAt = DateTime.UtcNow;
        report.NextRetryAt = null;
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        logger.LogInformation("Analysis {TaskId} claimed from PostgreSQL queue, attempt {Attempt}", report.Id, report.AttemptCount);
        return report.Id;
    }

    private async Task WatchCancellationAsync(string taskId, CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            try
            {
                using var scope = scopeFactory.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var status = await db.AnalysisReports.Where(report => report.Id == taskId).Select(report => report.Status).FirstOrDefaultAsync(token);
                if (status == "Cancelling")
                {
                    using var client = httpClientFactory.CreateClient("ai-driver-health");
                    using var response = await client.PostAsync("agents/cancel/" + Uri.EscapeDataString(taskId), null, token);
                    if (response.IsSuccessStatusCode) return;
                }
            }
            catch (Exception error) when (!token.IsCancellationRequested)
            {
                logger.LogWarning(error, "Will retry cancellation check for {TaskId}", taskId);
            }
            await Task.Delay(TimeSpan.FromSeconds(1), token);
        }
    }

    private static void TryDeleteJobFiles(string? payloadJson, ILogger logger)
    {
        try
        {
            var payload = payloadJson == null ? null : JsonSerializer.Deserialize<AnalysisJobPayload>(payloadJson);
            if (payload != null && Directory.Exists(payload.TempDirectory))
                Directory.Delete(payload.TempDirectory, true);
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Unable to remove files for exhausted analysis job");
        }
    }
}
