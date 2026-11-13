using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using AltBoardSync.Core.App;
using AltBoardSync.Core.Config;
using AltBoardSync.Core.IO;

namespace AltBoardSync.Tests;

public class WatchTests
{
    private const string Token = "wab_jeton-de-test-0123456789";

    private const string SuccessBody = """
        {"runId":7,"status":"success","accountsReceived":1,"charactersReceived":2,"charactersCreated":0,
         "charactersUpdated":1,"charactersUnchanged":1,"charactersStale":0,"snapshotsCreated":1,"errors":[]}
        """;

    /// <summary>Faux serveur : une réponse par appel, la dernière étant répétée.</summary>
    private sealed class FakeServer(params HttpStatusCode[] statuses) : HttpMessageHandler
    {
        private int _calls;

        public int Calls => Volatile.Read(ref _calls);

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var status = statuses[Math.Min(Interlocked.Increment(ref _calls), statuses.Length) - 1];
            var body = status == HttpStatusCode.OK ? SuccessBody : """{"error":"serveur indisponible"}""";
            return Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") });
        }
    }

    /// <summary>Une surveillance lancée en tâche de fond sur un faux dossier de jeu, aux délais raccourcis.</summary>
    private sealed class Harness : IDisposable
    {
        private readonly StringWriter _out = new();
        private CancellationTokenSource _cancellation = new();
        private Task<int>? _running;

        public TempDirectory Temp { get; } = new();
        public string Flavor { get; }
        public string Home { get; }
        public WatchControl Control { get; } = new();
        public ConcurrentQueue<WatchEvent> Events { get; } = new();

        public Harness()
        {
            Flavor = Temp.Combine("wow", "_classic_beta_");
            Home = Temp.Combine("home");
            Directory.CreateDirectory(Path.Combine(Flavor, "WTF", "Account"));
        }

        public string Output
        {
            get
            {
                lock (_out) return _out.ToString();
            }
        }

        // L'agent peut être en train d'ajouter une ligne : la lecture partage l'écriture, comme celle
        // du journal des synchronisations, sans quoi elle échoue par intermittence (fichier occupé).
        public string Log
        {
            get
            {
                using var stream = new FileStream(
                    Path.Combine(Home, "logs", "altboardsync.log"), FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                using var reader = new StreamReader(stream);
                return reader.ReadToEnd();
            }
        }

        /// <summary>Du plus ancien au plus récent.</summary>
        public IReadOnlyList<JournalEntry> Journal => [.. new SyncJournal(Home, () => DateTimeOffset.UtcNow).ReadLatest().Reverse()];

        public void Start(HttpMessageHandler server, string? token = Token)
        {
            var app = new AgentApp(new AgentEnvironment
            {
                HomeDirectory = Home,
                Out = TextWriter.Synchronized(_out),
                Error = TextWriter.Synchronized(_out),
                HttpHandler = server,
                Hostname = "PC-TEST",
                ReadOptions = new StableReadOptions { SettleDelay = TimeSpan.FromMilliseconds(10) },
                GetEnvironmentVariable = name => name == "ALTBOARDSYNC_TOKEN" ? token : null,
                // Seuls un événement de fichier, une demande ou un échec relancent un cycle.
                WatchOptions = new WatchOptions
                {
                    Debounce = TimeSpan.FromMilliseconds(100),
                    CheckInterval = TimeSpan.FromHours(1),
                    FirstRetryDelay = TimeSpan.FromMilliseconds(100),
                    MaxRetryDelay = TimeSpan.FromMilliseconds(200),
                },
                WatchControl = Control,
                OnWatchEvent = Events.Enqueue,
            });
            var stop = _cancellation.Token;
            _running = Task.Run(() => app.RunAsync(["watch", "--wow-path", Flavor, "--server", "https://wow.example.test/api/sync"], stop));
        }

        /// <summary>Arrête la surveillance ; <see cref="Start"/> peut ensuite la relancer sur le même dossier.</summary>
        public async Task<int> StopAsync()
        {
            await _cancellation.CancelAsync();
            var exit = await _running!;
            _cancellation = new CancellationTokenSource();
            return exit;
        }

        public void Dispose()
        {
            _cancellation.Cancel();
            try
            {
                _running?.Wait(TimeSpan.FromSeconds(5));
            }
            catch (AggregateException)
            {
                // Le test a déjà échoué sur autre chose.
            }

            Temp.Dispose();
        }
    }

    private static async Task Eventually(Func<bool> condition, string expectation)
    {
        var elapsed = Stopwatch.StartNew();
        while (!condition())
        {
            if (elapsed.Elapsed > TimeSpan.FromSeconds(15)) Assert.Fail($"Jamais observé : {expectation}");
            await Task.Delay(20);
        }
    }

    /// <summary>Plusieurs fois l'anti-rebond : ce qui devait partir serait parti.</summary>
    private static Task Quiet() => Task.Delay(500);

    [Fact]
    public async Task Sends_at_startup_then_again_only_when_a_file_changes()
    {
        using var h = new Harness();
        var file = h.Temp.AddAccount(h.Flavor, "111111111#1", "account-two-characters-previous.lua");
        var server = new FakeServer(HttpStatusCode.OK);

        h.Start(server);
        await Eventually(() => server.Calls == 1, "l'envoi du démarrage");
        await Quiet();
        Assert.Equal(1, server.Calls);

        File.Copy(Fixture.PathOf("account-two-characters.lua"), file, overwrite: true);
        await Eventually(() => server.Calls == 2, "l'envoi après la modification du fichier");
        await Quiet();
        Assert.Equal(2, server.Calls);

        Assert.Equal(AgentApp.ExitOk, await h.StopAsync());
        Assert.All(h.Events, e => Assert.IsType<WatchEvent.Synced>(e));
        Assert.Equal(2, h.Events.Count);
        Assert.Contains("2 personnages synchronisés, 1 mis à jour.", h.Output);
        Assert.Contains("Synchronisation automatique arrêtée.", h.Output);
        Assert.Contains("synchronisation automatique success (run 7)", h.Log);

        // Le journal : le démarrage, puis chaque envoi ; le second dit ce qui a changé.
        Assert.Equal([JournalEntry.Info, JournalEntry.Synced, JournalEntry.Synced], h.Journal.Select(e => e.Kind));
        Assert.Empty(h.Journal[1].Changes);
        var changes = Assert.IsType<WatchEvent.Synced>(h.Events.Last()).Changes;
        Assert.NotEmpty(changes);
        Assert.Equal(changes.Select(c => c.Name), h.Journal[2].Changes.Select(c => c.Name));
        Assert.Contains($"  {changes[0].Name} ({changes[0].Realm}) : ", h.Output);
    }

    [Fact]
    public async Task Does_not_resend_after_a_restart_what_the_server_already_has()
    {
        using var h = new Harness();
        h.Temp.AddAccount(h.Flavor, "111111111#1", "account-two-characters.lua");
        var first = new FakeServer(HttpStatusCode.OK);
        h.Start(first);
        await Eventually(() => first.Calls == 1, "l'envoi du démarrage");
        await h.StopAsync();

        var second = new FakeServer(HttpStatusCode.OK);
        h.Start(second);
        await Quiet();

        Assert.Equal(0, second.Calls);
        var state = File.ReadAllText(Path.Combine(h.Home, "state.json"));
        Assert.Contains("_classic_beta_/", state);
        Assert.DoesNotContain("111111111", state);
    }

    [Fact]
    public async Task Retries_after_a_failure_and_reports_both_outcomes()
    {
        using var h = new Harness();
        h.Temp.AddAccount(h.Flavor, "111111111#1", "account-two-characters.lua");
        var server = new FakeServer(HttpStatusCode.ServiceUnavailable, HttpStatusCode.OK);

        h.Start(server);
        await Eventually(() => h.Events.Count == 2, "un échec puis une réussite");

        var failed = Assert.IsType<WatchEvent.Failed>(h.Events.First());
        Assert.Equal("serveur indisponible", failed.Error);
        Assert.Equal(TimeSpan.FromMilliseconds(100), failed.RetryIn);
        Assert.IsType<WatchEvent.Synced>(h.Events.Last());
        Assert.Equal(2, server.Calls);
        Assert.Contains("Échec : serveur indisponible. Nouvel essai dans", h.Output);
        Assert.Contains("synchronisation automatique en échec : serveur indisponible", h.Log);
        Assert.Equal([JournalEntry.Info, JournalEntry.Failed, JournalEntry.Synced], h.Journal.Select(e => e.Kind));
        Assert.Equal("serveur indisponible", h.Journal[1].Message);
    }

    [Fact]
    public async Task A_lasting_failure_is_written_once_to_the_journal()
    {
        using var h = new Harness();
        h.Temp.AddAccount(h.Flavor, "111111111#1", "account-two-characters.lua");
        var server = new FakeServer(HttpStatusCode.ServiceUnavailable);

        h.Start(server);
        await Eventually(() => h.Events.Count >= 3, "trois essais en échec");
        await h.StopAsync();

        Assert.Equal([JournalEntry.Info, JournalEntry.Failed], h.Journal.Select(e => e.Kind));
    }

    [Fact]
    public async Task A_requested_sync_that_finds_no_account_says_so()
    {
        using var h = new Harness();
        var server = new FakeServer(HttpStatusCode.OK);
        h.Start(server);
        // Une demande n'a d'effet qu'une fois la surveillance en place.
        await Eventually(() => h.Output.Contains("Ctrl+C"), "le démarrage de la surveillance");
        await Quiet();
        Assert.Empty(h.Events);

        h.Control.RequestSync();

        await Eventually(() => !h.Events.IsEmpty, "la réponse à la demande");
        Assert.Contains("Aucun compte AltBoard", Assert.IsType<WatchEvent.NothingToSend>(h.Events.First()).Reason);
        Assert.Equal(0, server.Calls);
        Assert.Equal(JournalEntry.Info, h.Journal[^1].Kind);
        Assert.Contains("Aucun compte AltBoard", h.Journal[^1].Message);
    }

    [Fact]
    public async Task Reports_a_missing_token_without_calling_the_server()
    {
        using var h = new Harness();
        h.Temp.AddAccount(h.Flavor, "111111111#1", "account-two-characters.lua");
        var server = new FakeServer(HttpStatusCode.OK);

        h.Start(server, token: null);
        await Eventually(() => !h.Events.IsEmpty, "le signalement du jeton absent");

        Assert.Contains("Aucun jeton d'agent", Assert.IsType<WatchEvent.Failed>(h.Events.First()).Error);
        Assert.Equal(0, server.Calls);
        Assert.Equal(AgentApp.ExitOk, await h.StopAsync());
    }

    [Fact]
    public async Task An_unreadable_token_is_reported_and_the_watch_keeps_running()
    {
        using var h = new Harness();
        h.Temp.AddAccount(h.Flavor, "111111111#1", "account-two-characters.lua");
        // Jeton chiffré pour un autre utilisateur ou un autre PC : DPAPI refuse de le lire.
        Directory.CreateDirectory(h.Home);
        await File.WriteAllBytesAsync(Path.Combine(h.Home, "token.dat"), [1, 2, 3, 4]);
        var server = new FakeServer(HttpStatusCode.OK);

        h.Start(server, token: null);
        await Eventually(() => h.Events.Count >= 2, "deux échecs successifs : la surveillance réessaie");

        Assert.All(h.Events, e => Assert.Contains("Jeton illisible", Assert.IsType<WatchEvent.Failed>(e).Error));
        Assert.Equal(0, server.Calls);
        Assert.Equal(AgentApp.ExitOk, await h.StopAsync());
    }

    /// <summary>Faux serveur dont le premier appel lève une exception imprévue, puis répond 200.</summary>
    private sealed class ThrowsOnce : HttpMessageHandler
    {
        private int _calls;

        public int Calls => Volatile.Read(ref _calls);

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (Interlocked.Increment(ref _calls) == 1) throw new InvalidOperationException("panne imprévue");
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(SuccessBody, Encoding.UTF8, "application/json") });
        }
    }

    [Fact]
    public async Task An_unexpected_error_is_logged_and_retried_instead_of_stopping_the_watch()
    {
        using var h = new Harness();
        h.Temp.AddAccount(h.Flavor, "111111111#1", "account-two-characters.lua");
        var server = new ThrowsOnce();

        h.Start(server);
        await Eventually(() => h.Events.OfType<WatchEvent.Synced>().Any(), "l'envoi réussi après l'erreur imprévue");

        var failure = Assert.IsType<WatchEvent.Failed>(h.Events.First());
        Assert.Contains("erreur inattendue (InvalidOperationException)", failure.Error);
        Assert.Equal(2, server.Calls);
        Assert.Contains("panne imprévue", h.Log);
        Assert.Equal(AgentApp.ExitOk, await h.StopAsync());
    }

    [Fact]
    public async Task Sends_on_request_even_when_nothing_changed()
    {
        using var h = new Harness();
        h.Temp.AddAccount(h.Flavor, "111111111#1", "account-two-characters.lua");
        var server = new FakeServer(HttpStatusCode.OK);
        h.Start(server);
        await Eventually(() => server.Calls == 1, "l'envoi du démarrage");

        h.Control.RequestSync();

        await Eventually(() => server.Calls == 2, "l'envoi demandé");
    }

    /// <summary>Faux serveur qui garde le corps de chaque requête et répond 200.</summary>
    private sealed class RecordingServer : HttpMessageHandler
    {
        public ConcurrentQueue<string> Bodies { get; } = new();

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Bodies.Enqueue(await request.Content!.ReadAsStringAsync(cancellationToken));
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(SuccessBody, Encoding.UTF8, "application/json") };
        }
    }

    [Fact]
    public async Task Item_names_of_the_game_cache_are_sent_again_only_when_the_cache_changes()
    {
        using var h = new Harness();
        h.Temp.AddAccount(h.Flavor, "111111111#1", "account-two-characters.lua");
        var cache = DbCacheFile.Write(h.Flavor, DbCacheFile.Build(70862, DbCacheFile.Name(720, "Masque de bandit")));
        var server = new RecordingServer();
        h.Start(server);
        await Eventually(() => server.Bodies.Count == 1, "l'envoi du démarrage");

        h.Control.RequestSync();
        await Eventually(() => server.Bodies.Count == 2, "l'envoi demandé");

        // Un cache modifié seul ne déclenche rien : il part avec la synchronisation suivante.
        File.WriteAllBytes(cache, DbCacheFile.Build(70862, DbCacheFile.Name(720, "Masque de bandit"), DbCacheFile.Name(721, "Lame de bandit")));
        await Quiet();
        Assert.Equal(2, server.Bodies.Count);
        h.Control.RequestSync();
        await Eventually(() => server.Bodies.Count == 3, "l'envoi demandé après la modification du cache");

        var bodies = server.Bodies.Select(body => JsonDocument.Parse(body).RootElement).ToArray();
        var first = Assert.Single(bodies[0].GetProperty("itemNames").EnumerateArray());
        Assert.Equal("_classic_beta_", first.GetProperty("flavor").GetString());
        Assert.Equal("frFR", first.GetProperty("locale").GetString());
        Assert.Equal(70862, first.GetProperty("build").GetInt32());
        Assert.Equal("""[{"id":720,"name":"Masque de bandit"}]""", first.GetProperty("names").GetRawText());
        Assert.False(bodies[1].TryGetProperty("itemNames", out _));
        Assert.Equal(2, bodies[2].GetProperty("itemNames")[0].GetProperty("names").GetArrayLength());

        Assert.Contains("noms des objets du cache du jeu (_classic_beta_, frFR, build 70862) : 1 envoyés", h.Log);
        Assert.Contains("\"itemNameHashes\"", File.ReadAllText(Path.Combine(h.Home, "state.json")));
    }

    [Fact]
    public async Task A_state_file_written_before_agent_0_7_0_still_lets_the_watch_send()
    {
        using var h = new Harness();
        h.Temp.AddAccount(h.Flavor, "111111111#1", "account-two-characters.lua");
        DbCacheFile.Write(h.Flavor, DbCacheFile.Build(70862, DbCacheFile.Name(720, "Masque de bandit")));
        // État laissé par l'agent 0.6.0 : aucune empreinte de cache de noms.
        Directory.CreateDirectory(h.Home);
        File.WriteAllText(Path.Combine(h.Home, "state.json"), """{"fingerprints":{"_classic_beta_/autre":"0000"}}""");
        var server = new RecordingServer();

        h.Start(server);
        await Eventually(() => !h.Events.IsEmpty, "le premier cycle");

        Assert.IsType<WatchEvent.Synced>(h.Events.First());
        Assert.Single(server.Bodies);
        Assert.Contains("\"itemNameHashes\"", File.ReadAllText(Path.Combine(h.Home, "state.json")));
    }

    [Fact]
    public void Missing_or_null_maps_of_an_older_state_file_are_read_as_empty()
    {
        using var temp = new TempDirectory();
        var store = new WatchStateStore(temp.Path);

        File.WriteAllText(store.StatePath, """{"fingerprints":{"_retail_/a":"1234"}}""");
        var older = store.Load();
        Assert.Equal("1234", older.Fingerprints["_retail_/a"]);
        Assert.Empty(older.ItemNameHashes);

        File.WriteAllText(store.StatePath, """{"fingerprints":null,"itemNameHashes":null}""");
        var nulls = store.Load();
        Assert.Empty(nulls.Fingerprints);
        Assert.Empty(nulls.ItemNameHashes);
    }

    [Fact]
    public async Task Sends_again_when_only_the_ledger_file_changes()
    {
        using var h = new Harness();
        var file = h.Temp.AddAccount(h.Flavor, "111111111#1", "account-two-characters.lua");
        var ledger = Path.Combine(Path.GetDirectoryName(file)!, "AllemanoLedger.lua");
        File.Copy(Fixture.PathOf("ledger-two-characters.lua"), ledger);
        var server = new FakeServer(HttpStatusCode.OK);
        h.Start(server);
        await Eventually(() => server.Calls == 1, "l'envoi du démarrage");

        File.AppendAllText(ledger, "\r\n-- réécrit par le jeu\r\n");

        await Eventually(() => server.Calls == 2, "l'envoi après la modification d'Allemano Ledger");
    }

    [Theory]
    [InlineData("Auctionator.lua", "auctionator-small.lua")]
    [InlineData("NaowhForever.lua", "naowh-recipes.lua")]
    public async Task Sends_again_when_only_an_economy_file_changes(string fileName, string fixture)
    {
        using var h = new Harness();
        var file = h.Temp.AddAccount(h.Flavor, "111111111#1", "account-two-characters.lua");
        var economy = Path.Combine(Path.GetDirectoryName(file)!, fileName);
        File.Copy(Fixture.PathOf(fixture), economy);
        var server = new FakeServer(HttpStatusCode.OK);
        h.Start(server);
        await Eventually(() => server.Calls == 1, "l'envoi du démarrage");

        File.AppendAllText(economy, "\r\n-- réécrit par le jeu\r\n");

        await Eventually(() => server.Calls == 2, $"l'envoi après la modification de {fileName}");
    }

    [Fact]
    public async Task Sends_nothing_while_no_account_exists_then_picks_up_a_new_one()
    {
        using var h = new Harness();
        var server = new FakeServer(HttpStatusCode.OK);
        h.Start(server);
        await Quiet();
        Assert.Equal(0, server.Calls);

        h.Temp.AddAccount(h.Flavor, "111111111#1", "account-two-characters.lua");

        await Eventually(() => server.Calls == 1, "l'envoi du compte apparu");
    }

    /// <summary>Faux serveur à réponses écrites (statut, corps, Retry-After en secondes), la dernière répétée.</summary>
    private sealed class ScriptedServer(params (HttpStatusCode Status, string Body, int? RetryAfterSeconds)[] replies) : HttpMessageHandler
    {
        private int _calls;

        public int Calls => Volatile.Read(ref _calls);

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var (status, body, retryAfter) = replies[Math.Min(Interlocked.Increment(ref _calls), replies.Length) - 1];
            var response = new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
            if (retryAfter is { } seconds) response.Headers.RetryAfter = new RetryConditionHeaderValue(TimeSpan.FromSeconds(seconds));
            return Task.FromResult(response);
        }
    }

    private static string Serving(string version) => SuccessBody.Replace("\"errors\":[]", $"\"errors\":[],\"latestAgentVersion\":\"{version}\"");

    /// <summary>Demande un envoi jusqu'à ce que le serveur l'ait reçu : la demande est sans effet avant le démarrage de la surveillance.</summary>
    private static async Task RequestUntil(Harness h, Func<bool> condition, string expectation)
    {
        var elapsed = Stopwatch.StartNew();
        while (!condition())
        {
            if (elapsed.Elapsed > TimeSpan.FromSeconds(15)) Assert.Fail($"Jamais observé : {expectation}");
            h.Control.RequestSync();
            await Task.Delay(200);
        }
    }

    [Fact]
    public async Task A_newer_agent_served_by_the_site_is_announced_once_even_after_a_restart()
    {
        using var h = new Harness();
        h.Temp.AddAccount(h.Flavor, "111111111#1", "account-two-characters.lua");
        var server = new ScriptedServer((HttpStatusCode.OK, Serving("99.0.0"), null));

        h.Start(server);
        await Eventually(() => h.Events.OfType<WatchEvent.Synced>().Any(), "un envoi accepté");
        await RequestUntil(h, () => h.Events.OfType<WatchEvent.Synced>().Count() >= 2, "un second envoi accepté");
        await h.StopAsync();
        h.Start(server);
        var calls = server.Calls;
        await RequestUntil(h, () => server.Calls > calls && h.Events.OfType<WatchEvent.Synced>().Count() >= 3, "un envoi après le redémarrage");
        await h.StopAsync();

        var update = Assert.Single(h.Events.OfType<WatchEvent.UpdateAvailable>());
        Assert.Equal("99.0.0", update.Version);
        var state = new WatchStateStore(h.Home).Load();
        Assert.Equal(("99.0.0", "99.0.0"), (state.LatestAgentVersion, state.NotifiedAgentVersion));
        Assert.Single(h.Journal, entry => entry.Kind == JournalEntry.Info && entry.Message.Contains("AltBoard Sync 99.0.0 est disponible"));
        Assert.Contains("Mise à jour disponible : AltBoard Sync 99.0.0.", h.Output);
    }

    [Fact]
    public async Task The_same_or_an_older_version_from_the_site_is_not_announced()
    {
        using var h = new Harness();
        h.Temp.AddAccount(h.Flavor, "111111111#1", "account-two-characters.lua");
        var server = new ScriptedServer((HttpStatusCode.OK, Serving("0.0.1"), null));

        h.Start(server);
        await Eventually(() => h.Events.OfType<WatchEvent.Synced>().Any(), "un envoi accepté");
        await h.StopAsync();

        Assert.Empty(h.Events.OfType<WatchEvent.UpdateAvailable>());
        Assert.Equal("0.0.1", new WatchStateStore(h.Home).Load().LatestAgentVersion);
    }

    [Fact]
    public async Task A_rejected_token_is_reported_as_such()
    {
        using var h = new Harness();
        h.Temp.AddAccount(h.Flavor, "111111111#1", "account-two-characters.lua");
        var server = new ScriptedServer((HttpStatusCode.Unauthorized, """{"error":"Jeton d'agent absent, invalide ou révoqué.","code":"unauthorized"}""", null));

        h.Start(server);
        await Eventually(() => !h.Events.IsEmpty, "un échec");

        var failed = Assert.IsType<WatchEvent.Failed>(h.Events.First());
        Assert.True(failed.TokenRejected);
        Assert.Equal("Jeton d'agent absent, invalide ou révoqué. Saisissez un nouveau jeton, créé dans la page Machines.", failed.Error);
    }

    [Fact]
    public async Task A_busy_server_is_retried_no_sooner_than_it_asks()
    {
        using var h = new Harness();
        h.Temp.AddAccount(h.Flavor, "111111111#1", "account-two-characters.lua");
        var server = new ScriptedServer(
            (HttpStatusCode.ServiceUnavailable, """{"error":"Une autre synchronisation est en cours, nouvel essai dans un instant.","code":"sync_busy"}""", 2),
            (HttpStatusCode.OK, SuccessBody, null));
        var elapsed = Stopwatch.StartNew();

        h.Start(server);
        await Eventually(() => h.Events.OfType<WatchEvent.Synced>().Any(), "l'envoi accepté après l'attente");

        var failed = Assert.IsType<WatchEvent.Failed>(h.Events.First());
        Assert.False(failed.TokenRejected);
        // Le harnais plafonne l'attente à 200 ms : seul le serveur peut l'avoir portée à 2 s.
        Assert.Equal(TimeSpan.FromSeconds(2), failed.RetryIn);
        Assert.True(elapsed.Elapsed >= TimeSpan.FromSeconds(1.9), $"renvoyé après {elapsed.Elapsed}");
        Assert.Equal(2, server.Calls);
    }

    [Fact]
    public async Task A_refused_document_names_the_fields_in_cause_and_announces_the_update()
    {
        using var h = new Harness();
        h.Temp.AddAccount(h.Flavor, "111111111#1", "account-two-characters.lua");
        var server = new ScriptedServer((HttpStatusCode.UnprocessableContent,
            """{"error":"Document de synchronisation invalide.","code":"invalid_payload","issues":[{"path":"accounts.0.baganator.mail","code":"unrecognized_keys"}],"latestAgentVersion":"99.0.0"}""",
            null));

        h.Start(server);
        await Eventually(() => h.Events.OfType<WatchEvent.Failed>().Any(), "un refus");
        await h.StopAsync();

        var failed = h.Events.OfType<WatchEvent.Failed>().First();
        Assert.Equal(
            "Document de synchronisation invalide. Champs en cause : accounts.0.baganator.mail (unrecognized_keys). Mettez l'agent à jour si le refus persiste.",
            failed.Error);
        Assert.Equal("99.0.0", Assert.Single(h.Events.OfType<WatchEvent.UpdateAvailable>()).Version);
    }
}
