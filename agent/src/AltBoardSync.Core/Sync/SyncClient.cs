using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;

namespace AltBoardSync.Core.Sync;

public sealed record SyncOutcome(HttpStatusCode? Status, SyncResponse? Response, string? Error)
{
    public bool Succeeded => Status is >= HttpStatusCode.OK and < HttpStatusCode.MultipleChoices && Response is not null;
}

/// <summary>
/// Envoi du document de synchronisation. Le jeton ne quitte la machine que vers un serveur HTTPS.
/// Le délai de <see cref="HttpClient.Timeout"/> couvre tout l'échange, lecture de la réponse comprise.
/// </summary>
public sealed class SyncClient(HttpClient http, string agentVersion)
{
    private const int MaxResponseBytes = 1024 * 1024;
    private static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(60);

    /// <summary>HTTPS obligatoire, sauf vers la machine locale (développement).</summary>
    public static Uri ValidateEndpoint(string serverUrl)
    {
        if (!Uri.TryCreate(serverUrl, UriKind.Absolute, out var uri) || (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp))
            throw new ArgumentException($"URL de serveur invalide : {serverUrl}");
        if (uri.Scheme == Uri.UriSchemeHttp && !uri.IsLoopback)
            throw new ArgumentException("Le serveur doit être joint en HTTPS (HTTP n'est accepté que vers localhost).");
        return uri;
    }

    public async Task<SyncOutcome> SendAsync(Uri endpoint, string token, SyncPayload payload, CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, endpoint);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        request.Headers.UserAgent.Add(new ProductInfoHeaderValue("AltBoardSync", agentVersion));
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        request.Content = new ByteArrayContent(JsonSerializer.SerializeToUtf8Bytes(payload, SyncJsonContext.Default.SyncPayload));
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json") { CharSet = "utf-8" };

        // HttpClient.Timeout s'arrête aux en-têtes (ResponseHeadersRead) : sans ce délai, un serveur
        // muet après les en-têtes bloquerait l'envoi, et la surveillance avec lui, sans fin.
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(http.Timeout == Timeout.InfiniteTimeSpan ? DefaultTimeout : http.Timeout);
        try
        {
            using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, deadline.Token).ConfigureAwait(false);
            var body = await ReadLimitedAsync(response.Content, deadline.Token).ConfigureAwait(false);
            SyncResponse? parsed = null;
            try
            {
                if (body.Length > 0) parsed = JsonSerializer.Deserialize(body, SyncJsonContext.Default.SyncResponse);
            }
            catch (JsonException)
            {
                // Réponse non JSON (page d'erreur d'un proxy) : seul le code HTTP est exploitable.
            }

            var error = response.IsSuccessStatusCode ? null : parsed?.Error ?? $"HTTP {(int)response.StatusCode} {response.ReasonPhrase}";
            return new SyncOutcome(response.StatusCode, parsed, error);
        }
        catch (HttpRequestException e)
        {
            return new SyncOutcome(null, null, $"Serveur injoignable : {e.Message}");
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return new SyncOutcome(null, null, "Délai d'attente du serveur dépassé");
        }
        catch (IOException e)
        {
            // Connexion coupée pendant la lecture de la réponse : le serveur a peut-être tout enregistré,
            // l'envoi suivant le dira (un document déjà reçu ne crée aucun doublon).
            return new SyncOutcome(null, null, $"Connexion coupée pendant la réponse du serveur : {e.Message}");
        }
    }

    private static async Task<byte[]> ReadLimitedAsync(HttpContent content, CancellationToken cancellationToken)
    {
        await using var stream = await content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
        using var buffer = new MemoryStream();
        var chunk = new byte[16 * 1024];
        int read;
        while ((read = await stream.ReadAsync(chunk, cancellationToken).ConfigureAwait(false)) > 0)
        {
            if (buffer.Length + read > MaxResponseBytes) break;
            buffer.Write(chunk, 0, read);
        }

        return buffer.ToArray();
    }
}
