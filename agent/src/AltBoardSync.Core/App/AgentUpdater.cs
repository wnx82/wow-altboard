using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;

namespace AltBoardSync.Core.App;

/// <summary>Résultat de <c>selfcheck</c> lancé sur un exécutable téléchargé.</summary>
public sealed record SelfCheckResult(int ExitCode, string Output);

/// <summary>Un exécutable lancé pour prendre la place de la surveillance en cours.</summary>
public interface IStartedAgent : IDisposable
{
    /// <summary>Terminée quand le processus a quitté.</summary>
    Task Exited { get; }

    void Kill();
}

/// <summary>Ce que la mise à jour automatique demande au système. Propre à Windows : fourni par l'exécutable.</summary>
public interface IUpdateHost
{
    /// <summary>L'exécutable en service, celui que la mise à jour remplace.</summary>
    string ExecutablePath { get; }

    /// <summary>Lance <c>selfcheck</c> sur <paramref name="executable"/>, avec le même dossier de l'agent.</summary>
    Task<SelfCheckResult> SelfCheckAsync(string executable, CancellationToken cancellationToken);

    /// <summary>
    /// Lance <paramref name="executable"/> en surveillance, chargé d'arrêter celle-ci et de prendre sa
    /// place (<c>watch --takeover</c>). La réussite se voit à l'arrêt de ce processus : l'annulation.
    /// </summary>
    IStartedAgent StartTakeover(string executable);
}

/// <summary>Issue d'une mise à jour qui n'a pas abouti ; une réussite arrête ce processus.</summary>
/// <param name="Message">Ce qui a échoué, pour le journal et la bulle.</param>
/// <param name="RetryLater">Vrai pour une cause passagère (réseau, serveur en cours de déploiement) ;
/// faux quand cette version ne s'installera pas mieux plus tard.</param>
public sealed record UpdateFailure(string Message, bool RetryLater);

/// <summary>
/// Mise à jour automatique de l'agent (0.9.0 et suivants). L'exécutable vient du site, celui que la
/// page Machines propose, avec le jeton d'agent ; son empreinte SHA-256 est celle que /api/sync a
/// rendue avec la version. Puis : <c>selfcheck</c> sur le fichier téléchargé, qui doit dire la version
/// attendue ; l'exécutable en service est renommé (Windows le permet pendant qu'il tourne) et le nouveau
/// prend son nom ; lancé, il arrête celui-ci et prend sa place. S'il ne la prend pas, l'ancien revient.
/// </summary>
public sealed class AgentUpdater(string homeDirectory, IUpdateHost host, HttpMessageHandler? handler, FileLog log)
{
    /// <summary>Taille maximale acceptée : l'exécutable publié fait environ 12 Mo.</summary>
    public const long MaxBytes = 64L * 1024 * 1024;

    public const string OldSuffix = ".old";
    public const string FailedSuffix = ".failed";

    public TimeSpan DownloadTimeout { get; init; } = TimeSpan.FromMinutes(5);

    /// <summary>Attente de la prise de relève par le nouvel exécutable, avant de revenir à l'ancien.</summary>
    public TimeSpan TakeoverTimeout { get; init; } = TimeSpan.FromSeconds(90);

    public string UpdatesDirectory => Path.Combine(homeDirectory, "updates");

    /// <summary>Adresse de l'exécutable : <c>/api/sync/agent</c> à côté de l'adresse de synchronisation.</summary>
    public static Uri DownloadUri(Uri syncEndpoint) => new(syncEndpoint.GetLeftPart(UriPartial.Path).TrimEnd('/') + "/agent");

    /// <summary>
    /// Télécharge, vérifie et installe <paramref name="version"/>. Ne rend la main qu'en cas d'échec :
    /// réussie, la mise à jour se termine par l'annulation de <paramref name="cancellationToken"/>, quand
    /// le nouvel exécutable arrête la surveillance de celui-ci.
    /// </summary>
    public async Task<UpdateFailure> InstallAsync(Uri syncEndpoint, string token, string version, string sha256, CancellationToken cancellationToken)
    {
        string downloaded;
        try
        {
            downloaded = await DownloadAsync(DownloadUri(syncEndpoint), token, version, sha256, cancellationToken).ConfigureAwait(false);
        }
        catch (UpdateException e)
        {
            return e.Failure;
        }
        catch (Exception e) when (e is HttpRequestException or IOException or UnauthorizedAccessException
                                     || (e is OperationCanceledException && !cancellationToken.IsCancellationRequested))
        {
            return new UpdateFailure($"téléchargement impossible : {e.Message}", RetryLater: true);
        }

        // L'exécutable téléchargé doit démarrer, lire la configuration et l'état de cet agent, et dire sa
        // version : un agent qui plante au démarrage (0.7.0) ne remplace jamais celui qui marche.
        SelfCheckResult check;
        try
        {
            check = await host.SelfCheckAsync(downloaded, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or InvalidOperationException or System.ComponentModel.Win32Exception)
        {
            return new UpdateFailure($"la version {version} n'a pas pu être lancée pour vérification : {e.Message}", RetryLater: false);
        }

        var lines = check.Output.ReplaceLineEndings("\n").Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var reported = lines.FirstOrDefault() ?? "";
        if (check.ExitCode != 0 || reported != version)
        {
            // Le journal complet va au fichier de log ; le message, lu dans une bulle, garde l'essentiel.
            log.Error($"selfcheck de la version {version} : code {check.ExitCode}, sortie « {Shorten(string.Join(" | ", lines), 1000)} »");
            var detail = check.ExitCode != 0
                ? $"code {check.ExitCode}{(lines.Length > 0 ? $", « {Shorten(lines[^1], 160)} »" : "")}"
                : $"elle se présente comme la version « {Shorten(reported, 40)} »";
            return new UpdateFailure($"la version {version} téléchargée ne passe pas sa vérification ({detail})", RetryLater: false);
        }

        var current = host.ExecutablePath;
        var old = current + OldSuffix;
        try
        {
            TryDelete(old);
            // Renommer un exécutable en cours d'exécution est permis ; le supprimer ne l'est pas.
            File.Move(current, old);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            return new UpdateFailure($"l'exécutable en service ne peut pas être remplacé ({Path.GetDirectoryName(current)}) : {e.Message}", RetryLater: false);
        }

        try
        {
            File.Copy(downloaded, current);
            TryHide(old);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            Restore(current, old);
            return new UpdateFailure($"la nouvelle version n'a pas pu être copiée : {e.Message}", RetryLater: true);
        }

        log.Info($"mise à jour automatique : version {version} installée, lancement");
        IStartedAgent started;
        try
        {
            started = host.StartTakeover(current);
        }
        catch (Exception e) when (e is InvalidOperationException or System.ComponentModel.Win32Exception or IOException or UnauthorizedAccessException)
        {
            // Bloquée au lancement (antivirus, stratégie de groupe) : l'exécutable précédent reprend sa place.
            Restore(current, old);
            return new UpdateFailure($"la version {version} n'a pas pu être lancée : {e.Message}", RetryLater: false);
        }

        using var _ = started;
        using var waiting = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var timeout = Task.Delay(TakeoverTimeout, waiting.Token);
        var finished = await Task.WhenAny(started.Exited, timeout).ConfigureAwait(false);
        // Arrêtée par la nouvelle version : la mise à jour a réussi, ce processus se termine.
        cancellationToken.ThrowIfCancellationRequested();
        await waiting.CancelAsync().ConfigureAwait(false);

        var cause = finished == started.Exited ? "elle s'est arrêtée au démarrage" : $"elle n'a pas pris la relève en {TakeoverTimeout.TotalSeconds:0} s";
        try
        {
            started.Kill();
            await started.Exited.WaitAsync(TimeSpan.FromSeconds(10), CancellationToken.None).ConfigureAwait(false);
        }
        catch (Exception e) when (e is TimeoutException or InvalidOperationException or System.ComponentModel.Win32Exception)
        {
            // Déjà arrêtée, ou impossible à arrêter : le retour à l'ancienne version est tenté quand même.
        }

        Restore(current, old);
        return new UpdateFailure($"la version {version} a été retirée : {cause}", RetryLater: false);
    }

    /// <returns>Le chemin de l'exécutable téléchargé, d'empreinte vérifiée.</returns>
    private async Task<string> DownloadAsync(Uri uri, string token, string version, string sha256, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(UpdatesDirectory);
        var target = Path.Combine(UpdatesDirectory, $"AltBoardSync-{version}.exe");
        var partial = target + ".part";

        using var http = handler is null ? new HttpClient() : new HttpClient(handler, disposeHandler: false);
        http.Timeout = Timeout.InfiniteTimeSpan;
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(DownloadTimeout);
        using var request = new HttpRequestMessage(HttpMethod.Get, uri);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, deadline.Token).ConfigureAwait(false);
        if (response.StatusCode != HttpStatusCode.OK)
        {
            // 404 : le site n'a pas d'exécutable, ou pas encore celui de la nouvelle version.
            throw new UpdateException(new UpdateFailure($"le serveur répond {(int)response.StatusCode} au téléchargement", RetryLater: true));
        }

        var served = response.Headers.TryGetValues("X-Agent-Version", out var values) ? values.FirstOrDefault() : null;
        if (served is not null && served != version)
            throw new UpdateException(new UpdateFailure($"le serveur sert la version {served} et non {version}", RetryLater: true));
        if (response.Content.Headers.ContentLength > MaxBytes)
            throw new UpdateException(new UpdateFailure("exécutable servi trop volumineux", RetryLater: false));

        using (var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256))
        {
            await using (var output = new FileStream(partial, FileMode.Create, FileAccess.Write, FileShare.None))
            await using (var input = await response.Content.ReadAsStreamAsync(deadline.Token).ConfigureAwait(false))
            {
                var buffer = new byte[81920];
                long total = 0;
                int read;
                while ((read = await input.ReadAsync(buffer, deadline.Token).ConfigureAwait(false)) > 0)
                {
                    total += read;
                    if (total > MaxBytes) throw new UpdateException(new UpdateFailure("exécutable servi trop volumineux", RetryLater: false));
                    hash.AppendData(buffer, 0, read);
                    await output.WriteAsync(buffer.AsMemory(0, read), deadline.Token).ConfigureAwait(false);
                }
            }

            var actual = Convert.ToHexStringLower(hash.GetHashAndReset());
            if (!actual.Equals(sha256.Trim(), StringComparison.OrdinalIgnoreCase))
            {
                TryDelete(partial);
                // Le site a pu être redéployé entre la synchronisation et le téléchargement.
                throw new UpdateException(new UpdateFailure("empreinte SHA-256 de l'exécutable téléchargé différente de celle annoncée", RetryLater: true));
            }
        }

        File.Move(partial, target, overwrite: true);
        return target;
    }

    /// <summary>Remet l'exécutable d'origine à sa place après un échec.</summary>
    private void Restore(string current, string old)
    {
        try
        {
            if (File.Exists(current)) File.Move(current, current + FailedSuffix, overwrite: true);
            File.Move(old, current);
            File.SetAttributes(current, File.GetAttributes(current) & ~FileAttributes.Hidden);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            // Rare : l'ancienne version reste sous son nom .old, que ce journal désigne.
            log.Error($"mise à jour automatique : retour à la version précédente impossible ({old} → {current}) : {e.Message}");
        }
    }

    /// <summary>
    /// Ménage d'une mise à jour terminée, au démarrage de la nouvelle version : l'ancien exécutable, celui
    /// d'un essai retiré et les fichiers téléchargés. Réessayé quelques secondes : l'ancien processus
    /// peut ne pas avoir tout à fait quitté.
    /// </summary>
    public static async Task CleanUpAsync(string executablePath, string homeDirectory, CancellationToken cancellationToken = default)
    {
        string[] leftovers = [executablePath + OldSuffix, executablePath + FailedSuffix];
        for (var attempt = 0; attempt < 15; attempt++)
        {
            foreach (var file in leftovers) TryDelete(file);
            if (!leftovers.Any(File.Exists)) break;
            await Task.Delay(TimeSpan.FromSeconds(1), cancellationToken).ConfigureAwait(false);
        }

        var updates = Path.Combine(homeDirectory, "updates");
        if (!Directory.Exists(updates)) return;
        foreach (var file in Directory.EnumerateFiles(updates)) TryDelete(file);
    }

    private static void TryDelete(string path)
    {
        try
        {
            if (!File.Exists(path)) return;
            File.SetAttributes(path, FileAttributes.Normal);
            File.Delete(path);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            // Encore utilisé : un prochain ménage s'en chargera.
        }
    }

    /// <summary>L'ancien exécutable, à côté du nouveau le temps de la relève, n'encombre pas le Bureau.</summary>
    private static void TryHide(string path)
    {
        try
        {
            File.SetAttributes(path, File.GetAttributes(path) | FileAttributes.Hidden);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            // Visible : sans conséquence.
        }
    }

    private static string Shorten(string text, int max) => text.Length <= max ? text : text[..(max - 1)] + "…";

    private sealed class UpdateException(UpdateFailure failure) : Exception(failure.Message)
    {
        public UpdateFailure Failure { get; } = failure;
    }
}
