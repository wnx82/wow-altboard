using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;

namespace AltBoardSync.Core.Sync;

public sealed record SyncOutcome(HttpStatusCode? Status, SyncResponse? Response, string? Error)
{
    public bool Succeeded => Status is >= HttpStatusCode.OK and < HttpStatusCode.MultipleChoices && Response is not null;

    /// <summary>
    /// Jeton absent, invalide, révoqué ou lié à un autre PC : un nouvel essai n'y changera rien, il faut
    /// en saisir un autre.
    /// </summary>
    public bool TokenRejected => IsTokenRejection(Status, Response);

    internal static bool IsTokenRejection(HttpStatusCode? status, SyncResponse? response) =>
        status == HttpStatusCode.Unauthorized || (status == HttpStatusCode.Forbidden && response?.Code == "token_machine_mismatch");

    /// <summary>Attente demandée par le serveur (en-tête Retry-After d'un 429 ou d'un 503).</summary>
    public TimeSpan? RetryAfter { get; init; }
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

            var error = response.IsSuccessStatusCode ? null : Describe(response.StatusCode, response.ReasonPhrase, parsed);
            return new SyncOutcome(response.StatusCode, parsed, error) { RetryAfter = RetryDelay(response.Headers.RetryAfter) };
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

    private const int MaxIssuesShown = 3;

    /// <summary>
    /// Le message du serveur, complété de ce qui aide à agir : champs en cause d'un document refusé,
    /// marche à suivre pour un jeton refusé.
    /// </summary>
    internal static string Describe(HttpStatusCode status, string? reason, SyncResponse? response)
    {
        var message = response?.Error ?? $"HTTP {(int)status} {reason}".TrimEnd();
        if (SyncOutcome.IsTokenRejection(status, response)) return $"{message.TrimEnd('.')}. Saisissez un nouveau jeton, créé dans la page Machines.";
        if (status is not (HttpStatusCode.UnprocessableContent or HttpStatusCode.RequestEntityTooLarge)) return message;

        var issues = response?.Issues ?? [];
        var fields = issues.Count == 0
            ? ""
            : $" Champs en cause : {string.Join(", ", issues.Take(MaxIssuesShown).Select(issue => $"{issue.Path} ({issue.Code})"))}"
              + (issues.Count > MaxIssuesShown ? $" et {issues.Count - MaxIssuesShown} autres." : ".");
        // Une date en avance se corrige sur le PC ; le reste vient d'un agent plus ancien que le site.
        var hint = response?.Code == "future_timestamp" ? "" : " Mettez l'agent à jour si le refus persiste.";
        return $"{message.TrimEnd('.')}.{fields}{hint}";
    }

    /// <summary>Délai d'un en-tête Retry-After, en secondes ou en date ; borné à une heure.</summary>
    internal static TimeSpan? RetryDelay(RetryConditionHeaderValue? header)
    {
        var delay = header?.Delta ?? (header?.Date is { } date ? date - DateTimeOffset.UtcNow : null);
        if (delay is not { } value || value <= TimeSpan.Zero) return null;
        return value > TimeSpan.FromHours(1) ? TimeSpan.FromHours(1) : value;
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
