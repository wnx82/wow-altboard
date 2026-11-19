using System.Text;
using System.Threading.Channels;
using AltBoardSync.Core.Config;
using AltBoardSync.Core.Discovery;
using AltBoardSync.Core.IO;
using AltBoardSync.Core.Sync;

namespace AltBoardSync.Core.App;

public sealed record WatchOptions
{
    /// <summary>Le jeu écrit en plusieurs fois : la lecture attend ce délai sans nouvelle modification.</summary>
    public TimeSpan Debounce { get; init; } = TimeSpan.FromSeconds(5);

    /// <summary>
    /// Relevé de la taille et de la date des fichiers suivis. Un relevé plutôt qu'une surveillance du
    /// système de fichiers : elle gardait le dossier WTF\Account ouvert, que Windows refusait alors de
    /// renommer ou de déplacer, et une surveillance morte n'était jamais recréée.
    /// </summary>
    public TimeSpan PollInterval { get; init; } = TimeSpan.FromSeconds(3);

    /// <summary>Filet de sécurité : relecture complète, même sans modification relevée.</summary>
    public TimeSpan CheckInterval { get; init; } = TimeSpan.FromMinutes(10);

    /// <summary>Attente avant le premier nouvel essai après un échec ; elle double à chaque échec suivant.</summary>
    public TimeSpan FirstRetryDelay { get; init; } = TimeSpan.FromMinutes(1);

    public TimeSpan MaxRetryDelay { get; init; } = TimeSpan.FromMinutes(30);

    /// <summary>Après un échec passager de la mise à jour automatique (réseau, site en déploiement).</summary>
    public TimeSpan UpdateRetryDelay { get; init; } = TimeSpan.FromHours(1);

    /// <summary>Attente de la prise de relève par la nouvelle version, avant de revenir à l'ancienne.</summary>
    public TimeSpan UpdateTakeoverTimeout { get; init; } = TimeSpan.FromSeconds(90);
}

/// <summary>Ce que « watch » signale à son hôte (zone de notification).</summary>
public abstract record WatchEvent
{
    private WatchEvent()
    {
    }

    /// <summary>Un document a été envoyé et accepté par le serveur.</summary>
    /// <param name="Changes">Ce qui a changé par personnage depuis l'envoi accepté précédent.</param>
    /// <param name="Complete">Faux si un compte illisible n'a pas pu partir : un échec suit.</param>
    public sealed record Synced(SyncResponse Response, string Summary, IReadOnlyList<CharacterChange> Changes, bool Complete = true) : WatchEvent;

    /// <summary>La lecture ou l'envoi a échoué ; un nouvel essai suivra.</summary>
    /// <param name="TokenRejected">Le serveur refuse le jeton : il faut en saisir un autre.</param>
    public sealed record Failed(string Error, TimeSpan RetryIn, bool TokenRejected = false) : WatchEvent;

    /// <summary>
    /// Le serveur sert une version de l'agent plus récente que celle-ci, à télécharger à la main (mise à
    /// jour automatique désactivée, impossible ou en échec) ; signalé une fois par version.
    /// </summary>
    public sealed record UpdateAvailable(string Version) : WatchEvent;

    /// <summary>La mise à jour automatique vers cette version commence.</summary>
    public sealed record Updating(string Version) : WatchEvent;

    /// <summary>La mise à jour automatique n'a pas abouti ; cette version reste en service.</summary>
    /// <param name="RetryLater">Vrai si elle sera retentée ; faux si elle est à installer à la main.</param>
    public sealed record UpdateFailed(string Version, string Error, bool RetryLater) : WatchEvent;

    /// <summary>Une synchronisation demandée n'a trouvé aucun compte à envoyer.</summary>
    public sealed record NothingToSend(string Reason) : WatchEvent;
}

/// <summary>Permet à l'hôte de demander une synchronisation immédiate à une surveillance en cours.</summary>
public sealed class WatchControl
{
    private Action? _request;

    /// <summary>Sans effet si aucune surveillance n'est en cours.</summary>
    public void RequestSync() => Volatile.Read(ref _request)?.Invoke();

    internal void Attach(Action? request) => Volatile.Write(ref _request, request);
}

/// <summary>
/// Synchronisation automatique : envoie quand le jeu a réécrit ses fichiers, et seulement si leur
/// contenu a changé depuis le dernier envoi accepté. Elle n'observe que les fichiers des addons sous
/// <c>WTF\Account</c> : jamais le processus du jeu. La configuration est relue à chaque cycle : un
/// dossier du jeu ou un réglage changé dans la fenêtre vaut dès la synchronisation suivante.
/// </summary>
internal sealed class WatchLoop(
    AgentEnvironment env, AgentConfigStore configStore, AgentConfig initialConfig, string? wowPathOverride, Uri endpoint, TokenStore tokenStore,
    FileLog log, SyncJournal journal, string version)
{
    private enum Signal
    {
        FileChanged,
        Requested,
    }

    /// <summary>Fichiers dont une modification déclenche une lecture.</summary>
    private static readonly string[] WatchedFiles =
    [
        AccountScanner.SavedVariablesFile, AccountScanner.LedgerFile, AccountScanner.AuctionatorFile, AccountScanner.RecipesFile,
        AccountScanner.SyndicatorFile, AccountScanner.EzAuctioneerFile,
    ];

    private readonly WatchOptions _options = env.WatchOptions ?? new WatchOptions();
    private readonly Channel<Signal> _signals = Channel.CreateUnbounded<Signal>();
    private readonly WatchStateStore _stateStore = new(env.HomeDirectory);
    private readonly Dictionary<string, string> _readErrors = new();
    private AgentConfig _config = initialConfig;
    private string _wowPath = wowPathOverride ?? initialConfig.WowPath;
    // Dernière version proposée par le serveur, avec l'empreinte de son exécutable.
    private (string Version, string? Sha256)? _offer;
    private DateTimeOffset _nextUpdateAttempt = DateTimeOffset.MinValue;
    // Dernier échec de mise à jour inscrit au journal.
    private (string Version, string Message)? _journaledUpdate;

    /// <summary>Échec d'un cycle : le message, l'attente demandée par le serveur, un jeton refusé.</summary>
    private sealed record Failure(string Message, TimeSpan? RetryAfter = null, bool TokenRejected = false)
    {
        public static implicit operator Failure(string message) => new(message);
    }

    /// <summary>Ne rend la main que par annulation.</summary>
    public async Task RunAsync(CancellationToken cancellationToken)
    {
        using var http = env.HttpHandler is null ? new HttpClient() : new HttpClient(env.HttpHandler, disposeHandler: false);
        http.Timeout = TimeSpan.FromSeconds(60);
        var client = new SyncClient(http, version);
        var state = _stateStore.Load();
        env.WatchControl?.Attach(() => _signals.Writer.TryWrite(Signal.Requested));
        using var polling = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var poller = Task.Run(() => PollAsync(polling.Token), CancellationToken.None);
        try
        {
            var force = false;
            var retry = TimeSpan.Zero;
            string? journaledError = null;
            while (true)
            {
                // Un seul cycle à la fois : ce qui arrive pendant un envoi attend dans la file.
                Failure? failure;
                try
                {
                    failure = await CycleAsync(client, state, force, cancellationToken).ConfigureAwait(false);
                }
                catch (Exception e) when (e is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
                {
                    // Filet de dernier recours : une erreur imprévue (fichier verrouillé un instant par un
                    // antivirus…) est un échec comme un autre. La surveillance ne s'arrête que sur demande.
                    log.Error($"cycle de synchronisation interrompu : {e}");
                    failure = $"erreur inattendue ({e.GetType().Name}) : {e.Message}";
                }
                if (failure is null)
                {
                    retry = TimeSpan.Zero;
                    journaledError = null;
                }
                else
                {
                    var error = failure.Message;
                    retry = retry == TimeSpan.Zero ? _options.FirstRetryDelay : TimeSpan.FromTicks(Math.Min(retry.Ticks * 2, _options.MaxRetryDelay.Ticks));
                    // Le serveur occupé ou limité dit quand revenir : pas avant.
                    if (failure.RetryAfter is { } asked && asked > retry) retry = asked;
                    log.Error($"synchronisation automatique en échec : {error}");
                    // Une entrée par panne, pas une à chaque nouvel essai.
                    if (error != journaledError) journal.Failed(error);
                    journaledError = error;
                    Say($"Échec : {error.TrimEnd('.')}. Nouvel essai dans {Describe(retry)}.");
                    env.OnWatchEvent?.Invoke(new WatchEvent.Failed(error, retry, failure.TokenRejected));
                }

                // Réussie, la mise à jour arrête ce processus : la nouvelle version prend la suite.
                try
                {
                    await UpdateAsync(state, cancellationToken).ConfigureAwait(false);
                }
                catch (Exception e) when (e is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
                {
                    // Une mise à jour ratée ne doit jamais arrêter la synchronisation.
                    log.Error($"mise à jour automatique interrompue : {e}");
                    _nextUpdateAttempt = env.Now() + _options.UpdateRetryDelay;
                }

                var signal = await NextSignalAsync(failure is null ? _options.CheckInterval : retry, cancellationToken).ConfigureAwait(false);
                force = signal == Signal.Requested
                    || (signal == Signal.FileChanged && await SettleAsync(cancellationToken).ConfigureAwait(false));
            }
        }
        finally
        {
            env.WatchControl?.Attach(null);
            await polling.CancelAsync().ConfigureAwait(false);
            try
            {
                await poller.ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                // Arrêt du relevé.
            }
        }
    }

    /// <returns>L'échec rencontré, ou null : rien à envoyer, ou envoi accepté.</returns>
    private async Task<Failure?> CycleAsync(SyncClient client, WatchState state, bool force, CancellationToken cancellationToken)
    {
        ReloadConfig();
        IReadOnlyList<AccountSource> sources;
        try
        {
            sources = AccountScanner.Scan(_wowPath);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            return e.Message;
        }

        var builder = new PayloadBuilder(new StableFileReader(env.ReadOptions));
        var readable = new List<AccountReadResult>();
        var unreadable = new List<AccountReadResult>();
        foreach (var source in sources)
        {
            var result = await builder.ReadAccountAsync(source, cancellationToken).ConfigureAwait(false);
            NoteReadError(result);
            (result.Succeeded ? readable : unreadable).Add(result);
        }

        // Un compte illisible (AltBoard.lua tronqué, verrouillé…) n'empêche pas les autres de partir, mais
        // la synchronisation n'est pas complète : c'est un échec, et un nouvel essai suivra.
        Failure? unreadableFailure = unreadable.Count == 0 ? null : DescribeUnreadable(unreadable);

        if (readable.Count == 0)
        {
            // Sans cette réponse, une synchronisation demandée à la main resterait sans effet visible.
            if (force && sources.Count == 0)
            {
                const string reason = "Aucun compte AltBoard trouvé : rien à envoyer.";
                journal.Info(reason);
                Say(reason);
                env.OnWatchEvent?.Invoke(new WatchEvent.NothingToSend(reason));
            }

            return unreadableFailure;
        }

        if (!force && readable.All(r => state.Fingerprints.GetValueOrDefault(StateKey(r)) == r.Fingerprint)) return unreadableFailure;

        string? token;
        try
        {
            token = tokenStore.Read();
        }
        catch (Exception e) when (e is InvalidDataException or IOException or UnauthorizedAccessException)
        {
            // Jeton enregistré par un autre utilisateur ou un autre PC, ou fichier verrouillé : la fenêtre
            // affiche le message et propose la saisie, comme pour un jeton absent.
            return e.Message;
        }

        if (token is null) return TokenStore.MissingMessage;

        // Noms d'objets du cache du jeu : joints à l'envoi seulement quand le cache a changé. Un cache
        // modifié seul ne déclenche pas d'envoi : il part avec la synchronisation suivante.
        var itemNames = new List<ItemNamesReadResult>();
        foreach (var (flavor, flavorPath) in PayloadBuilder.Flavors(sources))
        {
            var read = await builder.ReadItemNamesAsync(flavor, flavorPath, state.ItemNameHashes.GetValueOrDefault(flavor), cancellationToken).ConfigureAwait(false);
            if (read is null) continue;
            if (read.Error is not null) log.Warn(read.Error);
            itemNames.Add(read);
        }

        var document = PayloadBuilder.Build(
            new MachinePayload(_config.MachineUuid, env.Hostname, _config.MachineName),
            readable.Select(r => r.Payload!),
            version,
            env.Now(),
            itemNames.Where(read => read.Payload is not null).Select(read => read.Payload!).ToList());
        var outcome = await client.SendAsync(endpoint, token, document, cancellationToken).ConfigureAwait(false);
        // Un document refusé dit aussi la version servie : c'est souvent la mise à jour qui manque.
        NoteLatestVersion(state, outcome.Response);
        if (!outcome.Succeeded) return new Failure(outcome.Error ?? "réponse inattendue du serveur", outcome.RetryAfter, outcome.TokenRejected);

        foreach (var result in readable) state.Fingerprints[StateKey(result)] = result.Fingerprint!;
        foreach (var read in itemNames.Where(read => read.FileHash is not null)) state.ItemNameHashes[read.Flavor] = read.FileHash!;
        foreach (var names in document.ItemNames ?? []) log.Info($"noms des objets du cache du jeu ({names.Flavor}, {names.Locale}, build {names.Build}) : {names.Names.Count} envoyés");
        SaveState(state);

        var response = outcome.Response!;
        var summary = Summarize(response);
        log.Info($"synchronisation automatique {response.Status} (run {response.RunId}) : {response.CharactersReceived} personnages, " +
                 $"{response.CharactersCreated} créés, {response.CharactersUpdated} mis à jour, {response.CharactersUnchanged} inchangés, " +
                 $"{response.SnapshotsCreated} snapshots, {response.Errors.Count} erreurs");
        var changes = journal.Synced(document, summary);
        Say(summary);
        foreach (var change in changes) Say($"  {DescribeChange(change)}");
        env.OnWatchEvent?.Invoke(new WatchEvent.Synced(response, summary, changes, Complete: unreadableFailure is null));
        return unreadableFailure;
    }

    /// <summary>« compte 12…#1 illisible : … », et le nombre des autres comptes illisibles.</summary>
    private static Failure DescribeUnreadable(IReadOnlyList<AccountReadResult> unreadable)
    {
        var first = unreadable[0];
        var message = $"compte {AccountKey.Hint(first.Source.AccountFolder)} illisible : {first.Error?.TrimEnd('.')}";
        return unreadable.Count == 1 ? message : $"{message} (et {AgentApp.Plural(unreadable.Count - 1, "autre compte", "autres comptes")})";
    }

    /// <summary>Relit la configuration ; illisible, la précédente reste en service.</summary>
    private void ReloadConfig()
    {
        try
        {
            _config = configStore.LoadOrCreate();
        }
        catch (Exception e) when (e is InvalidDataException or IOException or UnauthorizedAccessException)
        {
            log.Warn($"configuration illisible, la précédente reste en service : {e.Message}");
        }

        var wowPath = wowPathOverride ?? _config.WowPath;
        if (wowPath == Volatile.Read(ref _wowPath)) return;
        log.Info("dossier du jeu changé");
        Volatile.Write(ref _wowPath, wowPath);
    }

    /// <summary>
    /// Retient la version annoncée par le serveur. Elle n'est signalée (une fois) que si elle doit être
    /// installée à la main ; sinon la mise à jour automatique s'en charge après ce cycle.
    /// </summary>
    private void NoteLatestVersion(WatchState state, SyncResponse? response)
    {
        if (response?.LatestAgentVersion is not { } latest) return;
        _offer = (latest, response.LatestAgentSha256);
        if (latest != state.LatestAgentVersion)
        {
            state.LatestAgentVersion = latest;
            SaveState(state);
        }

        if (!CanUpdateAutomatically(state)) Announce(state, latest);
    }

    /// <summary>Signale une fois par version la mise à jour à télécharger soi-même.</summary>
    private void Announce(WatchState state, string latest)
    {
        if (!AgentVersions.IsNewer(latest, version) || state.NotifiedAgentVersion == latest) return;
        state.NotifiedAgentVersion = latest;
        SaveState(state);
        log.Info($"version {latest} de l'agent disponible (celle-ci : {version})");
        journal.Info($"AltBoard Sync {latest} est disponible : téléchargez-le depuis la page Machines du tableau de bord, puis lancez-le.");
        Say($"Mise à jour disponible : AltBoard Sync {latest}.");
        env.OnWatchEvent?.Invoke(new WatchEvent.UpdateAvailable(latest));
    }

    private bool CanUpdateAutomatically(WatchState state) =>
        env.UpdateHost is not null
        && _config.UpdatesAutomatically
        && _offer is { Sha256.Length: > 0 } offer
        && AgentVersions.IsNewer(offer.Version, version)
        && state.FailedAgentUpdate != offer.Version;

    /// <summary>Installe la version proposée par le serveur, si elle peut l'être maintenant.</summary>
    private async Task UpdateAsync(WatchState state, CancellationToken cancellationToken)
    {
        if (!CanUpdateAutomatically(state) || env.Now() < _nextUpdateAttempt) return;
        var (latest, sha256) = _offer!.Value;
        string? token;
        try
        {
            token = tokenStore.Read();
        }
        catch (Exception e) when (e is InvalidDataException or IOException or UnauthorizedAccessException)
        {
            token = null;
        }

        if (token is null) return;

        log.Info($"mise à jour automatique vers la version {latest} (celle-ci : {version})");
        // Au journal, une fois par version et par cause : un échec passager est réessayé chaque heure,
        // et le journal ne garde que ses 200 dernières entrées.
        if (_journaledUpdate?.Version != latest) journal.Info($"Mise à jour vers AltBoard Sync {latest}…");
        Say($"Mise à jour vers AltBoard Sync {latest}…");
        env.OnWatchEvent?.Invoke(new WatchEvent.Updating(latest));

        var updater = new AgentUpdater(env.HomeDirectory, env.UpdateHost!, env.HttpHandler, log) { TakeoverTimeout = _options.UpdateTakeoverTimeout };
        var failure = await updater.InstallAsync(endpoint, token, latest, sha256!, cancellationToken).ConfigureAwait(false);

        log.Error($"mise à jour automatique vers la version {latest} en échec : {failure.Message}");
        if (_journaledUpdate != (latest, failure.Message))
            journal.UpdateFailed($"Mise à jour vers AltBoard Sync {latest} impossible : {failure.Message}. La version {version} reste en service.");
        _journaledUpdate = (latest, failure.Message);
        Say($"Mise à jour vers {latest} impossible : {failure.Message}.");
        env.OnWatchEvent?.Invoke(new WatchEvent.UpdateFailed(latest, failure.Message, failure.RetryLater));
        if (failure.RetryLater)
        {
            _nextUpdateAttempt = env.Now() + _options.UpdateRetryDelay;
            return;
        }

        // Cette version ne s'installera pas mieux plus tard : elle est proposée au téléchargement.
        state.FailedAgentUpdate = latest;
        SaveState(state);
        Announce(state, latest);
    }

    private void SaveState(WatchState state)
    {
        try
        {
            _stateStore.Save(state);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            log.Warn($"état de la surveillance non enregistré : {e.Message}");
        }
    }

    /// <summary>Relève la taille et la date des fichiers suivis ; un changement déclenche une lecture.</summary>
    private async Task PollAsync(CancellationToken cancellationToken)
    {
        var previous = Snapshot(Volatile.Read(ref _wowPath));
        while (true)
        {
            await Task.Delay(_options.PollInterval, cancellationToken).ConfigureAwait(false);
            var current = Snapshot(Volatile.Read(ref _wowPath));
            if (current == previous) continue;
            previous = current;
            _signals.Writer.TryWrite(Signal.FileChanged);
        }
    }

    /// <summary>
    /// Taille et date de chaque fichier suivi, compte par compte. Chaque dossier n'est ouvert que le temps
    /// de le lister : rien ne reste ouvert entre deux relevés.
    /// </summary>
    private static string Snapshot(string wowPath)
    {
        var text = new StringBuilder(wowPath).Append('\n');
        try
        {
            foreach (var root in AccountScanner.AccountRoots(wowPath))
            {
                if (!Directory.Exists(root)) continue;
                foreach (var account in Directory.EnumerateDirectories(root).Order(StringComparer.OrdinalIgnoreCase))
                {
                    var savedVariables = Path.Combine(account, "SavedVariables");
                    foreach (var name in WatchedFiles)
                    {
                        var file = new FileInfo(Path.Combine(savedVariables, name));
                        if (!file.Exists) continue;
                        text.Append(file.FullName).Append('|').Append(file.Length).Append('|').Append(file.LastWriteTimeUtc.Ticks).Append('\n');
                    }
                }
            }
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            // Dossier absent ou inaccessible : le cycle suivant le dira ; son retour se verra au relevé suivant.
            text.Append("indisponible : ").Append(e.GetType().Name);
        }

        return text.ToString();
    }

    /// <summary>Null à l'échéance.</summary>
    private async Task<Signal?> NextSignalAsync(TimeSpan timeout, CancellationToken cancellationToken)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(timeout);
        try
        {
            return await _signals.Reader.ReadAsync(deadline.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return null;
        }
    }

    /// <summary>Anti-rebond : repart pour un délai complet à chaque nouvelle modification relevée.</summary>
    /// <returns>Vrai si une synchronisation a été demandée entre-temps : elle n'attend pas davantage.</returns>
    private async Task<bool> SettleAsync(CancellationToken cancellationToken)
    {
        while (true)
        {
            switch (await NextSignalAsync(_options.Debounce, cancellationToken).ConfigureAwait(false))
            {
                case null: return false;
                case Signal.Requested: return true;
            }
        }
    }

    /// <summary>Un compte illisible n'est écrit au journal du fichier qu'une fois par erreur, pas à chaque vérification.</summary>
    private void NoteReadError(AccountReadResult result)
    {
        var file = result.Source.FilePath;
        if (result.Error is null)
        {
            _readErrors.Remove(file);
            return;
        }

        if (_readErrors.TryGetValue(file, out var known) && known == result.Error) return;
        _readErrors[file] = result.Error;
        log.Error($"compte {AccountKey.Hint(result.Source.AccountFolder)} illisible : {result.Error}");
    }

    private static string StateKey(AccountReadResult result) => $"{result.Source.Flavor}/{AccountKey.Compute(result.Source.AccountFolder)}";

    internal static string DescribeChange(CharacterChange change) => $"{change.Name} ({change.Realm}) : {string.Join(" · ", change.Details)}";

    internal static string Summarize(SyncResponse response)
    {
        var changed = response.CharactersCreated + response.CharactersUpdated;
        var summary = $"{AgentApp.Plural(response.CharactersReceived, "personnage synchronisé", "personnages synchronisés")}, " +
                      $"{(changed == 0 ? "aucun changement" : AgentApp.Plural(changed, "mis à jour", "mis à jour"))}.";
        return response.Errors.Count == 0
            ? summary
            : $"{summary} {AgentApp.Plural(response.Errors.Count, "erreur signalée", "erreurs signalées")} par le serveur.";
    }

    private static string Describe(TimeSpan delay) => delay.TotalMinutes >= 1 ? $"{delay.TotalMinutes:0} min" : $"{delay.TotalSeconds:0} s";

    private void Say(string message) => env.Out.WriteLine($"[{env.Now().ToLocalTime():HH:mm:ss}] {message}");
}
