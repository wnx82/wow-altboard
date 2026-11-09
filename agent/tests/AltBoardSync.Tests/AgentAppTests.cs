using System.Net;
using System.Text;
using System.Text.Json;
using AltBoardSync.Core.App;
using AltBoardSync.Core.IO;

namespace AltBoardSync.Tests;

public class AgentAppTests
{
    private const string Token = "wab_jeton-de-test-0123456789";

    /// <summary>Faux serveur : mémorise la requête et renvoie une réponse préparée.</summary>
    private sealed class FakeServer(HttpStatusCode status, string body) : HttpMessageHandler
    {
        public List<(HttpRequestMessage Request, string Body)> Calls { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls.Add((request, await request.Content!.ReadAsStringAsync(cancellationToken)));
            return new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        }
    }

    private sealed class Harness : IDisposable
    {
        public TempDirectory Temp { get; } = new();
        public StringWriter Out { get; } = new();
        public StringWriter Error { get; } = new();
        public string Flavor { get; }
        public string Home { get; }
        public string? TokenValue { get; set; } = Token;

        public Harness()
        {
            Flavor = Temp.Combine("wow", "_classic_beta_");
            Home = Temp.Combine("home");
            Directory.CreateDirectory(Path.Combine(Flavor, "WTF", "Account"));
        }

        public Task<int> Run(HttpMessageHandler? server, params string[] args)
        {
            var app = new AgentApp(new AgentEnvironment
            {
                HomeDirectory = Home,
                Out = Out,
                Error = Error,
                HttpHandler = server,
                Hostname = "PC-TEST",
                Now = () => new DateTimeOffset(2026, 10, 4, 12, 0, 0, TimeSpan.Zero),
                ReadOptions = new StableReadOptions { SettleDelay = TimeSpan.Zero, MaxAttempts = 2 },
                GetEnvironmentVariable = name => name == "ALTBOARDSYNC_TOKEN" ? TokenValue : null,
            });
            return app.RunAsync([.. args, "--wow-path", Flavor, "--server", "https://wow.example.test/api/sync"]);
        }

        public string Log => File.Exists(Path.Combine(Home, "logs", "altboardsync.log"))
            ? File.ReadAllText(Path.Combine(Home, "logs", "altboardsync.log"))
            : "";

        public void Dispose() => Temp.Dispose();
    }

    private const string SuccessBody = """
        {"runId":7,"status":"success","accountsReceived":2,"charactersReceived":6,"charactersCreated":2,
         "charactersUpdated":1,"charactersUnchanged":3,"charactersStale":0,"snapshotsCreated":3,"errors":[]}
        """;

    [Fact]
    public async Task Sync_sends_every_account_and_reports_the_result()
    {
        using var h = new Harness();
        h.Temp.AddAccount(h.Flavor, "111111111#1", "account-four-characters.lua");
        h.Temp.AddAccount(h.Flavor, "222222222#1", "account-two-characters.lua");
        var server = new FakeServer(HttpStatusCode.OK, SuccessBody);

        var exit = await h.Run(server, "sync");

        Assert.Equal(AgentApp.ExitOk, exit);
        var (request, body) = Assert.Single(server.Calls);
        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal($"Bearer {Token}", request.Headers.Authorization!.ToString());
        Assert.Equal("application/json", request.Content!.Headers.ContentType!.MediaType);

        using var json = JsonDocument.Parse(body);
        var root = json.RootElement;
        Assert.Equal(1, root.GetProperty("schemaVersion").GetInt32());
        Assert.Equal(AgentApp.Version, root.GetProperty("agentVersion").GetString());
        Assert.Equal("PC-TEST", root.GetProperty("machine").GetProperty("hostname").GetString());
        Assert.True(Guid.TryParse(root.GetProperty("machine").GetProperty("uuid").GetString(), out var uuid) && uuid != Guid.Empty);
        var accounts = root.GetProperty("accounts");
        Assert.Equal(2, accounts.GetArrayLength());
        Assert.Equal([4, 2], accounts.EnumerateArray().Select(a => a.GetProperty("characters").GetArrayLength()));
        Assert.Equal("_classic_beta_", accounts[0].GetProperty("flavor").GetString());
        Assert.Equal(2, accounts[0].GetProperty("addonSchema").GetInt32());
        Assert.Matches("^[0-9a-f]{64}$", accounts[0].GetProperty("file").GetProperty("hash").GetString()!);

        var output = h.Out.ToString();
        Assert.Contains("Machine : PC-TEST", output);
        Assert.Contains("2 comptes détectés", output);
        Assert.Contains("6 personnages détectés", output);
        Assert.Contains("Compte 1 (11…#1) : 4 personnages", output);
        Assert.Contains("Compte 2 (22…#1) : 2 personnages", output);
        Assert.Contains("6 personnages synchronisés.", output);
        Assert.Contains("3 nouveaux snapshots.", output);
        Assert.Contains("3 personnages inchangés.", output);
        Assert.Contains("Synchronisation terminée.", output);
        Assert.False(root.TryGetProperty("itemNames", out _));
    }

    [Fact]
    public async Task Sync_sends_the_item_names_of_the_game_cache_and_warns_when_it_is_unreadable()
    {
        using var h = new Harness();
        h.Temp.AddAccount(h.Flavor, "111111111#1", "account-two-characters.lua");
        var cache = DbCacheFile.Write(h.Flavor, DbCacheFile.Build(70862, DbCacheFile.Name(720, "Masque de bandit")));
        var server = new FakeServer(HttpStatusCode.OK, SuccessBody);

        Assert.Equal(AgentApp.ExitOk, await h.Run(server, "sync"));

        using (var json = JsonDocument.Parse(server.Calls[0].Body))
        {
            var names = Assert.Single(json.RootElement.GetProperty("itemNames").EnumerateArray());
            Assert.Equal("frFR", names.GetProperty("locale").GetString());
            Assert.Equal("""[{"id":720,"name":"Masque de bandit"}]""", names.GetProperty("names").GetRawText());
        }

        Assert.Contains("Noms des objets du cache du jeu (_classic_beta_) : 1 objet", h.Out.ToString());

        // Cache illisible : avertissement, la synchronisation part quand même, sans les noms.
        File.WriteAllText(cache, "pas un cache");
        Assert.Equal(AgentApp.ExitOk, await h.Run(server, "sync"));
        Assert.False(JsonDocument.Parse(server.Calls[1].Body).RootElement.TryGetProperty("itemNames", out _));
        Assert.Contains("avertissement : cache du jeu illisible, noms des objets non transmis", h.Out.ToString());
    }

    [Fact]
    public async Task Token_never_leaks_and_folder_name_only_goes_to_the_server_field()
    {
        using var h = new Harness();
        h.Temp.AddAccount(h.Flavor, "111111111#1", "account-two-characters.lua");
        var server = new FakeServer(HttpStatusCode.OK, SuccessBody);

        await h.Run(server, "sync");

        var body = Assert.Single(server.Calls).Body;
        var account = JsonDocument.Parse(body).RootElement.GetProperty("accounts")[0];
        Assert.Equal("111111111#1", account.GetProperty("folderName").GetString());
        Assert.Single(body.Split("111111111").Skip(1));
        Assert.DoesNotContain(Token, body);
        foreach (var text in new[] { h.Out.ToString(), h.Error.ToString(), h.Log })
        {
            Assert.DoesNotContain(Token, text);
            Assert.DoesNotContain("111111111", text);
        }

        Assert.Contains("synchronisation success", h.Log);
    }

    [Fact]
    public async Task Machine_identity_is_the_same_on_every_run()
    {
        using var h = new Harness();
        h.Temp.AddAccount(h.Flavor, "111111111#1", "account-two-characters.lua");
        var server = new FakeServer(HttpStatusCode.OK, SuccessBody);

        await h.Run(server, "sync");
        await h.Run(server, "sync");

        var uuids = server.Calls.Select(c => JsonDocument.Parse(c.Body).RootElement.GetProperty("machine").GetProperty("uuid").GetString()).ToList();
        Assert.Equal(2, uuids.Count);
        Assert.Equal(uuids[0], uuids[1]);
    }

    [Fact]
    public async Task Sync_tells_what_changed_since_the_previous_one_and_keeps_a_journal()
    {
        using var h = new Harness();
        var file = h.Temp.AddAccount(h.Flavor, "111111111#1", "account-four-characters-previous.lua");
        var server = new FakeServer(HttpStatusCode.OK, SuccessBody);

        await h.Run(server, "sync");
        Assert.DoesNotContain("Depuis la synchronisation précédente", h.Out.ToString());

        File.Copy(Fixture.PathOf("account-four-characters.lua"), file, overwrite: true);
        await h.Run(server, "sync");

        Assert.Contains("Depuis la synchronisation précédente :", h.Out.ToString());
        Assert.Contains("Ægir Çélèste (ClassicBetaPvE2) : données mises à jour", h.Out.ToString());
        var journal = new SyncJournal(h.Home, () => DateTimeOffset.UtcNow).ReadLatest();
        Assert.Equal(2, journal.Count);
        Assert.All(journal, entry => Assert.Equal(JournalEntry.Synced, entry.Kind));
        Assert.Equal("6 personnages synchronisés, 3 mis à jour.", journal[0].Message);
        Assert.Equal(4, journal[0].Characters);
        Assert.Equal("Ægir Çélèste", Assert.Single(journal[0].Changes).Name);
        Assert.Empty(journal[1].Changes);
        // Les fichiers du journal ne nomment pas plus le dossier de compte que le reste.
        Assert.DoesNotContain("111111111", File.ReadAllText(Path.Combine(h.Home, "journal.jsonl")));
        Assert.DoesNotContain("111111111", File.ReadAllText(Path.Combine(h.Home, "characters.json")));
    }

    [Fact]
    public async Task A_refused_sync_is_written_to_the_journal()
    {
        using var h = new Harness();
        h.Temp.AddAccount(h.Flavor, "111111111#1", "account-two-characters.lua");
        var server = new FakeServer(HttpStatusCode.ServiceUnavailable, """{"error":"serveur indisponible"}""");

        Assert.Equal(AgentApp.ExitFailed, await h.Run(server, "sync"));

        var entry = Assert.Single(new SyncJournal(h.Home, () => DateTimeOffset.UtcNow).ReadLatest());
        Assert.Equal(JournalEntry.Failed, entry.Kind);
        Assert.Equal("serveur indisponible", entry.Message);
    }

    [Fact]
    public async Task Scan_reads_everything_but_sends_nothing()
    {
        using var h = new Harness();
        h.Temp.AddAccount(h.Flavor, "111111111#1", "account-four-characters.lua");
        var server = new FakeServer(HttpStatusCode.OK, SuccessBody);
        var outFile = h.Temp.Combine("document.json");

        var exit = await h.Run(server, "scan", "--out", outFile);

        Assert.Equal(AgentApp.ExitOk, exit);
        Assert.Empty(server.Calls);
        Assert.Contains("Simulation : rien n'a été envoyé.", h.Out.ToString());
        using var json = JsonDocument.Parse(File.ReadAllText(outFile));
        Assert.Equal(4, json.RootElement.GetProperty("accounts")[0].GetProperty("characters").GetArrayLength());
    }

    [Fact]
    public async Task Unreadable_account_does_not_prevent_the_others()
    {
        using var h = new Harness();
        h.Temp.AddAccount(h.Flavor, "111111111#1", "account-two-characters.lua");
        var broken = h.Temp.AddAccount(h.Flavor, "222222222#1", fixture: null);
        File.WriteAllBytes(broken, Fixture.Bytes("account-four-characters.lua").AsSpan(0, 5000).ToArray());
        var empty = h.Temp.AddAccount(h.Flavor, "333333333#1", "empty.lua");
        var server = new FakeServer(HttpStatusCode.OK, SuccessBody);

        var exit = await h.Run(server, "sync");

        Assert.Equal(AgentApp.ExitFailed, exit);
        using var json = JsonDocument.Parse(Assert.Single(server.Calls).Body);
        Assert.Equal(1, json.RootElement.GetProperty("accounts").GetArrayLength());
        var output = h.Out.ToString();
        Assert.Contains("3 comptes détectés", output);
        Assert.Contains("Compte 2 (22…#1) : ERREUR", output);
        Assert.Contains("Compte 3 (33…#1) : ERREUR — AltBoardDB est absente du fichier", output);
        Assert.Contains("Synchronisation terminée avec des erreurs.", output);
        Assert.True(File.Exists(empty));
    }

    [Fact]
    public async Task No_account_is_not_an_error()
    {
        using var h = new Harness();
        var server = new FakeServer(HttpStatusCode.OK, SuccessBody);

        var exit = await h.Run(server, "sync");

        Assert.Equal(AgentApp.ExitOk, exit);
        Assert.Empty(server.Calls);
        Assert.Contains("0 compte détecté", h.Out.ToString());
        Assert.Contains("Aucune donnée à envoyer.", h.Out.ToString());
    }

    [Fact]
    public async Task Missing_token_stops_before_any_network_call()
    {
        using var h = new Harness { TokenValue = null };
        h.Temp.AddAccount(h.Flavor, "111111111#1", "account-two-characters.lua");
        var server = new FakeServer(HttpStatusCode.OK, SuccessBody);

        var exit = await h.Run(server, "sync");

        Assert.Equal(AgentApp.ExitUsage, exit);
        Assert.Empty(server.Calls);
        Assert.Contains("Aucun jeton d'agent", h.Error.ToString());
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized, """{"error":"jeton invalide"}""", "jeton invalide")]
    [InlineData(HttpStatusCode.BadGateway, "<html>proxy</html>", "HTTP 502")]
    public async Task Server_refusal_is_reported(HttpStatusCode status, string body, string expected)
    {
        using var h = new Harness();
        h.Temp.AddAccount(h.Flavor, "111111111#1", "account-two-characters.lua");

        var exit = await h.Run(new FakeServer(status, body), "sync");

        Assert.Equal(AgentApp.ExitFailed, exit);
        Assert.Contains(expected, h.Error.ToString());
        Assert.DoesNotContain("Synchronisation terminée", h.Out.ToString());
    }

    [Fact]
    public async Task Plain_http_to_a_remote_server_is_refused()
    {
        using var h = new Harness();
        h.Temp.AddAccount(h.Flavor, "111111111#1", "account-two-characters.lua");
        var server = new FakeServer(HttpStatusCode.OK, SuccessBody);
        var app = new AgentApp(new AgentEnvironment
        {
            HomeDirectory = h.Home, Out = h.Out, Error = h.Error, HttpHandler = server,
            ReadOptions = new StableReadOptions { SettleDelay = TimeSpan.Zero },
            GetEnvironmentVariable = _ => Token,
        });

        var exit = await app.RunAsync(["sync", "--wow-path", h.Flavor, "--server", "http://wow.example.test/api/sync"]);

        Assert.Equal(AgentApp.ExitUsage, exit);
        Assert.Empty(server.Calls);
        Assert.Contains("HTTPS", h.Error.ToString());
    }

    [Fact]
    public async Task Missing_wow_folder_is_reported()
    {
        using var h = new Harness();
        var app = new AgentApp(new AgentEnvironment { HomeDirectory = h.Home, Out = h.Out, Error = h.Error });

        var exit = await app.RunAsync(["scan", "--wow-path", h.Temp.Combine("absent")]);

        Assert.Equal(AgentApp.ExitUsage, exit);
        Assert.Contains("introuvable", h.Error.ToString());
    }

    private sealed class FakeAutostart : IAutostart
    {
        public bool IsEnabled { get; private set; }

        public void Enable() => IsEnabled = true;

        public void Disable() => IsEnabled = false;
    }

    [Fact]
    public async Task Autostart_can_be_displayed_enabled_and_disabled()
    {
        using var h = new Harness();
        var autostart = new FakeAutostart();
        var app = new AgentApp(new AgentEnvironment { HomeDirectory = h.Home, Out = h.Out, Error = h.Error, Autostart = autostart });

        Assert.Equal(AgentApp.ExitOk, await app.RunAsync(["autostart"]));
        Assert.Contains("Démarrage automatique : désactivé.", h.Out.ToString());

        Assert.Equal(AgentApp.ExitOk, await app.RunAsync(["autostart", "on"]));
        Assert.True(autostart.IsEnabled);
        Assert.Equal(AgentApp.ExitOk, await app.RunAsync(["autostart"]));
        Assert.Contains("Démarrage automatique : activé.", h.Out.ToString());

        Assert.Equal(AgentApp.ExitOk, await app.RunAsync(["autostart", "off"]));
        Assert.False(autostart.IsEnabled);

        Assert.Equal(AgentApp.ExitUsage, await app.RunAsync(["autostart", "peut-être"]));
        Assert.False(autostart.IsEnabled);
    }

    [Fact]
    public async Task Autostart_is_refused_where_the_system_has_none()
    {
        using var h = new Harness();
        var app = new AgentApp(new AgentEnvironment { HomeDirectory = h.Home, Out = h.Out, Error = h.Error });

        Assert.Equal(AgentApp.ExitUsage, await app.RunAsync(["autostart", "on"]));
        Assert.Contains("n'est pas disponible", h.Error.ToString());
    }

    [Fact]
    public async Task Watch_refuses_an_unknown_option()
    {
        using var h = new Harness();
        var app = new AgentApp(new AgentEnvironment { HomeDirectory = h.Home, Out = h.Out, Error = h.Error });

        Assert.Equal(AgentApp.ExitUsage, await app.RunAsync(["watch", "--dry-run"]));
        Assert.Contains("Option inconnue", h.Error.ToString());
    }

    [Fact]
    public async Task Configuration_can_be_displayed_and_changed()
    {
        using var h = new Harness();
        var app = new AgentApp(new AgentEnvironment { HomeDirectory = h.Home, Out = h.Out, Error = h.Error, Hostname = "PC-TEST", GetEnvironmentVariable = _ => null });

        Assert.Equal(AgentApp.ExitOk, await app.RunAsync(["config", "set", "machineName", "PC-Gaming"]));
        Assert.Equal(AgentApp.ExitUsage, await app.RunAsync(["config", "set", "serverUrl", "http://exemple.test/api/sync"]));
        Assert.Equal(AgentApp.ExitOk, await app.RunAsync(["config"]));

        var output = h.Out.ToString();
        Assert.Contains("machineName : PC-Gaming", output);
        Assert.Contains("serverUrl   : https://wow.ekreativ.be/api/sync", output);
        Assert.Contains("jeton       : absent", output);
    }
}
