using System.Threading.Channels;
using AltBoardSync.Core.Config;
using AltBoardSync.Core.Discovery;
using AltBoardSync.Core.IO;
using AltBoardSync.Core.Sync;

namespace AltBoardSync.Core.App;

public sealed record WatchOptions
{
    /// <summary>Le jeu écrit en plusieurs fois : la lecture attend ce délai sans nouvel événement.</summary>
    public TimeSpan Debounce { get; init; } = TimeSpan.FromSeconds(5);

    /// <summary>Filet de sécurité : la surveillance du système de fichiers peut manquer des événements.</summary>
    public TimeSpan CheckInterval { get; init; } = TimeSpan.FromMinutes(10);

    /// <summary>Attente avant le premier nouvel essai après un échec ; elle double à chaque échec suivant.</summary>
    public TimeSpan FirstRetryDelay { get; init; } = TimeSpan.FromMinutes(1);

    public TimeSpan MaxRetryDelay { get; init; } = TimeSpan.FromMinutes(30);
}

/// <summary>Ce que « watch » signale à son hôte (zone de notification).</summary>
public abstract record WatchEvent
{
    private WatchEvent()
    {
    }

    /// <summary>Un document a été envoyé et accepté par le serveur.</summary>
    /// <param name="Changes">Ce qui a changé par personnage depuis l'envoi accepté précédent.</param>
    public sealed record Synced(SyncResponse Response, string Summary, IReadOnlyList<CharacterChange> Changes) : WatchEvent;

    /// <summary>La lecture ou l'envoi a échoué ; un nouvel essai suivra.</summary>
    public sealed record Failed(string Error, TimeSpan RetryIn) : WatchEvent;

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
/// contenu a changé depuis le dernier envoi accepté. Elle n'observe que le dossier <c>WTF\Account</c> :
/// jamais le processus du jeu.
/// </summary>
internal sealed class WatchLoop(
    AgentEnvironment env, AgentConfig config, string wowPath, Uri endpoint, TokenStore tokenStore, FileLog log, SyncJournal journal, string version)
{
    private enum Signal
    {
        FileChanged,
        Requested,
    }

    private readonly WatchOptions _options = env.WatchOptions ?? new WatchOptions();
    private readonly Channel<Signal> _signals = Channel.CreateUnbounded<Signal>();
    private readonly WatchStateStore _stateStore = new(env.HomeDirectory);
    private readonly Dictionary<string, FileSystemWatcher> _watchers = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, string> _readErrors = new();

    /// <summary>Ne rend la main que par annulation.</summary>
    public async Task RunAsync(CancellationToken cancellationToken)
    {
        using var http = env.HttpHandler is null ? new HttpClient() : new HttpClient(env.HttpHandler, disposeHandler: false);
        http.Timeout = TimeSpan.FromSeconds(60);
        var client = new SyncClient(http, version);
        var state = _stateStore.Load();
        env.WatchControl?.Attach(() => _signals.Writer.TryWrite(Signal.Requested));
        try
        {
            var force = false;
            var retry = TimeSpan.Zero;
            string? journaledError = null;
            while (true)
            {
                // Un seul cycle à la fois : ce qui arrive pendant un envoi attend dans la file.
                string? error;
                try
                {
                    error = await CycleAsync(client, state, force, cancellationToken).ConfigureAwait(false);
                }
                catch (Exception e) when (e is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
                {
                    // Filet de dernier recours : une erreur imprévue (fichier verrouillé un instant par un
                    // antivirus…) est un échec comme un autre. La surveillance ne s'arrête que sur demande.
                    log.Error($"cycle de synchronisation interrompu : {e}");
                    error = $"erreur inattendue ({e.GetType().Name}) : {e.Message}";
                }
                if (error is null)
                {
                    retry = TimeSpan.Zero;
                    journaledError = null;
                }
                else
                {
                    retry = retry == TimeSpan.Zero ? _options.FirstRetryDelay : TimeSpan.FromTicks(Math.Min(retry.Ticks * 2, _options.MaxRetryDelay.Ticks));
                    log.Error($"synchronisation automatique en échec : {error}");
                    // Une entrée par panne, pas une à chaque nouvel essai.
                    if (error != journaledError) journal.Failed(error);
                    journaledError = error;
                    Say($"Échec : {error.TrimEnd('.')}. Nouvel essai dans {Describe(retry)}.");
                    env.OnWatchEvent?.Invoke(new WatchEvent.Failed(error, retry));
                }

                var signal = await NextSignalAsync(error is null ? _options.CheckInterval : retry, cancellationToken).ConfigureAwait(false);
                force = signal == Signal.Requested
                    || (signal == Signal.FileChanged && await SettleAsync(cancellationToken).ConfigureAwait(false));
            }
        }
        finally
        {
            env.WatchControl?.Attach(null);
            foreach (var watcher in _watchers.Values) watcher.Dispose();
        }
    }

    /// <returns>L'erreur rencontrée, ou null : rien à envoyer, ou envoi accepté.</returns>
    private async Task<string?> CycleAsync(SyncClient client, WatchState state, bool force, CancellationToken cancellationToken)
    {
        IReadOnlyList<AccountSource> sources;
        try
        {
            // Rejoué à chaque cycle : un compte ou un client apparu entre-temps est pris en charge.
            WatchAccountRoots();
            sources = AccountScanner.Scan(wowPath);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            return e.Message;
        }

        var builder = new PayloadBuilder(new StableFileReader(env.ReadOptions));
        var readable = new List<AccountReadResult>();
        foreach (var source in sources)
        {
            var result = await builder.ReadAccountAsync(source, cancellationToken).ConfigureAwait(false);
            NoteReadError(result);
            if (result.Succeeded) readable.Add(result);
        }

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

            return null;
        }

        if (!force && readable.All(r => state.Fingerprints.GetValueOrDefault(StateKey(r)) == r.Fingerprint)) return null;

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
            new MachinePayload(config.MachineUuid, env.Hostname, config.MachineName),
            readable.Select(r => r.Payload!),
            version,
            env.Now(),
            itemNames.Where(read => read.Payload is not null).Select(read => read.Payload!).ToList());
        var outcome = await client.SendAsync(endpoint, token, document, cancellationToken).ConfigureAwait(false);
        if (!outcome.Succeeded) return outcome.Error ?? "réponse inattendue du serveur";

        foreach (var result in readable) state.Fingerprints[StateKey(result)] = result.Fingerprint!;
        foreach (var read in itemNames.Where(read => read.FileHash is not null)) state.ItemNameHashes[read.Flavor] = read.FileHash!;
        foreach (var names in document.ItemNames ?? []) log.Info($"noms des objets du cache du jeu ({names.Flavor}, {names.Locale}, build {names.Build}) : {names.Names.Count} envoyés");
        try
        {
            _stateStore.Save(state);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            log.Warn($"état de la surveillance non enregistré : {e.Message}");
        }

        var response = outcome.Response!;
        var summary = Summarize(response);
        log.Info($"synchronisation automatique {response.Status} (run {response.RunId}) : {response.CharactersReceived} personnages, " +
                 $"{response.CharactersCreated} créés, {response.CharactersUpdated} mis à jour, {response.CharactersUnchanged} inchangés, " +
                 $"{response.SnapshotsCreated} snapshots, {response.Errors.Count} erreurs");
        var changes = journal.Synced(document, summary);
        Say(summary);
        foreach (var change in changes) Say($"  {DescribeChange(change)}");
        env.OnWatchEvent?.Invoke(new WatchEvent.Synced(response, summary, changes));
        return null;
    }

    private void WatchAccountRoots()
    {
        foreach (var root in AccountScanner.AccountRoots(wowPath))
        {
            if (_watchers.ContainsKey(root)) continue;
            var watcher = new FileSystemWatcher(root)
            {
                IncludeSubdirectories = true,
                NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite | NotifyFilters.Size,
                // À la déconnexion le jeu réécrit les fichiers de tous les addons : le tampon par défaut déborde.
                InternalBufferSize = 64 * 1024,
            };
            watcher.Changed += OnFileEvent;
            watcher.Created += OnFileEvent;
            watcher.Renamed += OnFileEvent;
            // Tampon saturé malgré tout : des événements sont perdus, autant tout vérifier.
            watcher.Error += (_, _) => _signals.Writer.TryWrite(Signal.FileChanged);
            watcher.EnableRaisingEvents = true;
            _watchers.Add(root, watcher);
        }
    }

    private void OnFileEvent(object sender, FileSystemEventArgs e)
    {
        var name = Path.GetFileName(e.Name);
        if (string.Equals(name, AccountScanner.SavedVariablesFile, StringComparison.OrdinalIgnoreCase)
            || string.Equals(name, AccountScanner.LedgerFile, StringComparison.OrdinalIgnoreCase)
            || string.Equals(name, AccountScanner.AuctionatorFile, StringComparison.OrdinalIgnoreCase)
            || string.Equals(name, AccountScanner.RecipesFile, StringComparison.OrdinalIgnoreCase)
            || string.Equals(name, AccountScanner.SyndicatorFile, StringComparison.OrdinalIgnoreCase))
        {
            _signals.Writer.TryWrite(Signal.FileChanged);
        }
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

    /// <summary>Anti-rebond : repart pour un délai complet à chaque nouvel événement.</summary>
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

    /// <summary>Un compte illisible n'est signalé qu'une fois par erreur, pas à chaque vérification.</summary>
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
        var hint = AccountKey.Hint(result.Source.AccountFolder);
        log.Error($"compte {hint} illisible : {result.Error}");
        journal.Failed($"Compte {hint} illisible : {result.Error}");
        Say($"Compte {hint} illisible : {result.Error}");
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
