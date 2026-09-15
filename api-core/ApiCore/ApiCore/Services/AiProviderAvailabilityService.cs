using System.Text.Json;

namespace ApiCore.Services;

public sealed class AiProviderAvailabilityService(HttpClient httpClient, ILogger<AiProviderAvailabilityService> logger)
{
    public async Task<bool> IsAvailableAsync(string provider, CancellationToken cancellationToken)
    {
        try
        {
            using var response = await httpClient.GetAsync("models/availability", cancellationToken);
            if (!response.IsSuccessStatusCode) return false;
            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
            return document.RootElement.TryGetProperty(provider, out var item)
                && item.TryGetProperty("available", out var available)
                && available.GetBoolean();
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException or JsonException)
        {
            logger.LogWarning(exception, "Unable to check availability of AI provider {Provider}", provider);
            return false;
        }
    }
}
