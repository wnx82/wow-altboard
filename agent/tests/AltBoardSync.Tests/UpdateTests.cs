using System.Net;
using System.Security.Cryptography;
using AltBoardSync.Core.App;

namespace AltBoardSync.Tests;

/// <summary>Faux système pour la mise à jour : vérification et relève de la nouvelle version écrites par le test.</summary>
internal sealed class FakeUpdateHost(string executable) : IUpdateHost
{
    public string ExecutablePath => executable;

    public List<string> Checked { get; } = [];

    public List<string> Started { get; } = [];

    public Func<string, SelfCheckResult> SelfCheck { get; set; } = _ => new SelfCheckResult(0, "99.0.0\nétat : 0 comptes déjà envoyés");

    /// <summary>Par défaut : la nouvelle version ne prend jamais la relève.</summary>
    public Func<string, FakeStartedAgent> OnStart { get; set; } = _ => new FakeStartedAgent();

    public Task<SelfCheckResult> SelfCheckAsync(string candidate, CancellationToken cancellationToken)
    {
        Checked.Add(candidate);
        return Task.FromResult(SelfCheck(candidate));
    }

    public IStartedAgent StartTakeover(string candidate)
    {
        Started.Add(candidate);
        return OnStart(candidate);
    }
}

internal sealed class FakeStartedAgent : IStartedAgent
{
    private readonly TaskCompletionSource _exited = new(TaskCreationOptions.RunContinuationsAsynchronously);

    public Task Exited => _exited.Task;

    public bool Killed { get; private set; }

    public void Exit() => _exited.TrySetResult();

    public void Kill()
    {
        Killed = true;
        _exited.TrySetResult();
    }

    public void Dispose()
    {
    }
}

/// <summary>Le site : l'exécutable de la nouvelle version à /api/sync/agent.</summary>
internal sealed class AgentDownloadServer(byte[] executable, string version = "99.0.0", HttpStatusCode status = HttpStatusCode.OK) : HttpMessageHandler
{
    public List<HttpRequestMessage> Requests { get; } = [];

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        Requests.Add(request);
        var response = new HttpResponseMessage(status) { Content = new ByteArrayContent(status == HttpStatusCode.OK ? executable : []) };
        if (status == HttpStatusCode.OK) response.Headers.Add("X-Agent-Version", version);
        return Task.FromResult(response);
    }
}

public class UpdateTests
{
    private const string Token = "wab_jeton-de-test-0123456789";
    private static readonly Uri Endpoint = new("https://wow.example.test/api/sync");
    private static readonly byte[] OldExe = "ancienne version"u8.ToArray();
    private static readonly byte[] NewExe = "nouvelle version"u8.ToArray();

    internal static string Sha256Of(byte[] content) => Convert.ToHexStringLower(SHA256.HashData(content));

    private sealed class Setup : IDisposable
    {
        public TempDirectory Temp { get; } = new();
        public string Home { get; }
        public string Executable { get; }
        public FakeUpdateHost Host { get; }

        public Setup()
        {
            Home = Temp.Combine("home");
            Directory.CreateDirectory(Temp.Combine("Bureau"));
            Executable = Temp.Combine("Bureau", "AltBoardSync.exe");
            File.WriteAllBytes(Executable, OldExe);
            Host = new FakeUpdateHost(Executable);
        }

        public AgentUpdater Updater(HttpMessageHandler server) =>
            new(Home, Host, server, new FileLog(Home, () => DateTimeOffset.UtcNow)) { TakeoverTimeout = TimeSpan.FromMilliseconds(300) };

        public void Dispose() => Temp.Dispose();
    }

    [Fact]
    public async Task Downloads_checks_and_hands_over_to_the_new_version()
    {
        using var s = new Setup();
        var server = new AgentDownloadServer(NewExe);
        using var stop = new CancellationTokenSource();
        // La nouvelle version prend la relève : elle arrête la surveillance de celle-ci.
        s.Host.OnStart = _ =>
        {
            stop.Cancel();
            return new FakeStartedAgent();
        };

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => s.Updater(server).InstallAsync(Endpoint, Token, "99.0.0", Sha256Of(NewExe).ToUpperInvariant(), stop.Token));

        var request = Assert.Single(server.Requests);
        Assert.Equal("https://wow.example.test/api/sync/agent", request.RequestUri!.ToString());
        Assert.Equal(("Bearer", Token), (request.Headers.Authorization!.Scheme, request.Headers.Authorization.Parameter));
        // Vérifiée avant tout remplacement, sur le fichier téléchargé et non sur l'exécutable en service.
        Assert.Equal(Path.Combine(s.Home, "updates", "AltBoardSync-99.0.0.exe"), Assert.Single(s.Host.Checked));
        Assert.Equal(s.Executable, Assert.Single(s.Host.Started));
        Assert.Equal(NewExe, File.ReadAllBytes(s.Executable));
        Assert.Equal(OldExe, File.ReadAllBytes(s.Executable + ".old"));
        Assert.True(File.GetAttributes(s.Executable + ".old").HasFlag(FileAttributes.Hidden));
    }

    [Fact]
    public async Task A_file_that_does_not_match_the_announced_checksum_is_not_installed()
    {
        using var s = new Setup();

        var failure = await s.Updater(new AgentDownloadServer(NewExe)).InstallAsync(Endpoint, Token, "99.0.0", Sha256Of(OldExe), CancellationToken.None);

        Assert.True(failure.RetryLater);
        Assert.Contains("SHA-256", failure.Message);
        Assert.Empty(s.Host.Checked);
        Assert.Equal(OldExe, File.ReadAllBytes(s.Executable));
        Assert.False(File.Exists(s.Executable + ".old"));
        Assert.Empty(Directory.GetFiles(Path.Combine(s.Home, "updates")));
    }

    [Theory]
    [InlineData(HttpStatusCode.NotFound)]
    [InlineData(HttpStatusCode.Unauthorized)]
    public async Task A_server_without_the_executable_is_retried_later(HttpStatusCode status)
    {
        using var s = new Setup();

        var failure = await s.Updater(new AgentDownloadServer(NewExe, status: status)).InstallAsync(Endpoint, Token, "99.0.0", Sha256Of(NewExe), CancellationToken.None);

        Assert.True(failure.RetryLater);
        Assert.Contains($"{(int)status}", failure.Message);
        Assert.Equal(OldExe, File.ReadAllBytes(s.Executable));
    }

    [Fact]
    public async Task A_server_already_serving_another_version_is_retried_later()
    {
        using var s = new Setup();

        var failure = await s.Updater(new AgentDownloadServer(NewExe, version: "99.0.1")).InstallAsync(Endpoint, Token, "99.0.0", Sha256Of(NewExe), CancellationToken.None);

        Assert.True(failure.RetryLater);
        Assert.Contains("99.0.1", failure.Message);
        Assert.Empty(s.Host.Checked);
    }

    [Theory]
    [InlineData(0, "98.0.0")]
    [InlineData(1, "99.0.0")]
    public async Task A_new_version_that_fails_its_selfcheck_is_never_installed(int exitCode, string reported)
    {
        using var s = new Setup();
        s.Host.SelfCheck = _ => new SelfCheckResult(exitCode, $"{reported}\nErreur inattendue (ArgumentNullException) : Value cannot be null.");

        var failure = await s.Updater(new AgentDownloadServer(NewExe)).InstallAsync(Endpoint, Token, "99.0.0", Sha256Of(NewExe), CancellationToken.None);

        Assert.False(failure.RetryLater);
        Assert.Contains("vérification", failure.Message);
        Assert.Contains(exitCode == 0 ? "se présente comme la version « 98.0.0 »" : "code 1, « Erreur inattendue (ArgumentNullException) : Value cannot be null. »", failure.Message);
        Assert.Empty(s.Host.Started);
        Assert.Equal(OldExe, File.ReadAllBytes(s.Executable));
        Assert.False(File.Exists(s.Executable + ".old"));
    }

    [Fact]
    public async Task A_new_version_that_stops_at_startup_is_replaced_by_the_previous_one()
    {
        using var s = new Setup();
        var started = new FakeStartedAgent();
        s.Host.OnStart = _ =>
        {
            started.Exit();
            return started;
        };

        var failure = await s.Updater(new AgentDownloadServer(NewExe)).InstallAsync(Endpoint, Token, "99.0.0", Sha256Of(NewExe), CancellationToken.None);

        Assert.False(failure.RetryLater);
        Assert.Contains("arrêtée au démarrage", failure.Message);
        Assert.Equal(OldExe, File.ReadAllBytes(s.Executable));
        Assert.False(File.GetAttributes(s.Executable).HasFlag(FileAttributes.Hidden));
        Assert.Equal(NewExe, File.ReadAllBytes(s.Executable + ".failed"));
        Assert.False(File.Exists(s.Executable + ".old"));
    }

    [Fact]
    public async Task A_new_version_that_never_takes_over_is_stopped_and_rolled_back()
    {
        using var s = new Setup();
        var started = new FakeStartedAgent();
        s.Host.OnStart = _ => started;

        var failure = await s.Updater(new AgentDownloadServer(NewExe)).InstallAsync(Endpoint, Token, "99.0.0", Sha256Of(NewExe), CancellationToken.None);

        Assert.True(started.Killed);
        Assert.False(failure.RetryLater);
        Assert.Contains("n'a pas pris la relève", failure.Message);
        Assert.Equal(OldExe, File.ReadAllBytes(s.Executable));
    }

    [Fact]
    public async Task A_new_version_that_cannot_be_started_is_replaced_by_the_previous_one()
    {
        using var s = new Setup();
        s.Host.OnStart = _ => throw new System.ComponentModel.Win32Exception(5, "Accès refusé.");

        var failure = await s.Updater(new AgentDownloadServer(NewExe)).InstallAsync(Endpoint, Token, "99.0.0", Sha256Of(NewExe), CancellationToken.None);

        Assert.False(failure.RetryLater);
        Assert.Contains("n'a pas pu être lancée : Accès refusé.", failure.Message);
        Assert.Equal(OldExe, File.ReadAllBytes(s.Executable));
        Assert.False(File.Exists(s.Executable + ".old"));
    }

    [Fact]
    public async Task A_read_only_folder_is_reported_without_touching_anything()
    {
        using var s = new Setup();
        // L'exécutable verrouillé sans partage de suppression : Windows refuse de le renommer.
        await using var locked = new FileStream(s.Executable, FileMode.Open, FileAccess.Read, FileShare.Read);

        var failure = await s.Updater(new AgentDownloadServer(NewExe)).InstallAsync(Endpoint, Token, "99.0.0", Sha256Of(NewExe), CancellationToken.None);

        Assert.False(failure.RetryLater);
        Assert.Contains("ne peut pas être remplacé", failure.Message);
        Assert.Empty(s.Host.Started);
    }

    [Fact]
    public async Task The_new_version_cleans_up_after_the_update()
    {
        using var s = new Setup();
        File.WriteAllBytes(s.Executable + ".old", OldExe);
        File.SetAttributes(s.Executable + ".old", FileAttributes.Hidden);
        File.WriteAllBytes(s.Executable + ".failed", NewExe);
        Directory.CreateDirectory(Path.Combine(s.Home, "updates"));
        File.WriteAllBytes(Path.Combine(s.Home, "updates", "AltBoardSync-99.0.0.exe"), NewExe);

        await AgentUpdater.CleanUpAsync(s.Executable, s.Home);

        Assert.False(File.Exists(s.Executable + ".old"));
        Assert.False(File.Exists(s.Executable + ".failed"));
        Assert.Empty(Directory.GetFiles(Path.Combine(s.Home, "updates")));
        Assert.Equal(OldExe, File.ReadAllBytes(s.Executable));
    }

    [Fact]
    public void The_download_address_sits_next_to_the_sync_address()
    {
        Assert.Equal("https://wow.ekreativ.be/api/sync/agent", AgentUpdater.DownloadUri(new Uri("https://wow.ekreativ.be/api/sync")).ToString());
        Assert.Equal("https://exemple.test/wow/api/sync/agent", AgentUpdater.DownloadUri(new Uri("https://exemple.test/wow/api/sync/?x=1")).ToString());
    }
}
