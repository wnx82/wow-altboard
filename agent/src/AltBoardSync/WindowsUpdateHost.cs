using System.Diagnostics;
using System.Runtime.Versioning;
using AltBoardSync.Core.App;
using AltBoardSync.Core.Config;

/// <summary>
/// Ce que la mise à jour automatique demande à Windows : lancer <c>selfcheck</c> sur l'exécutable
/// téléchargé, puis lancer le nouvel exécutable pour qu'il prenne la place de cette surveillance.
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class WindowsUpdateHost(string homeDirectory) : IUpdateHost
{
    private static readonly TimeSpan SelfCheckTimeout = TimeSpan.FromMinutes(2);

    public string ExecutablePath => Environment.ProcessPath ?? throw new InvalidOperationException("Emplacement de l'exécutable inconnu.");

    public async Task<SelfCheckResult> SelfCheckAsync(string executable, CancellationToken cancellationToken)
    {
        var start = new ProcessStartInfo(executable, "selfcheck")
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            // Entrée redirigée aussi : seule dans sa console cachée, la vérification se croirait lancée
            // d'un double-clic (NativeConsole.IsDetached) et n'écrirait pas en UTF-8.
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = System.Text.Encoding.UTF8,
            StandardErrorEncoding = System.Text.Encoding.UTF8,
        };
        // Le même dossier que cette surveillance : configuration, état et jeton de ce PC.
        start.Environment[AgentConfigStore.HomeEnvironmentVariable] = homeDirectory;
        using var process = Process.Start(start) ?? throw new InvalidOperationException("selfcheck n'a pas démarré.");
        process.StandardInput.Close();
        var output = process.StandardOutput.ReadToEndAsync(cancellationToken);
        var error = process.StandardError.ReadToEndAsync(cancellationToken);
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(SelfCheckTimeout);
        try
        {
            await process.WaitForExitAsync(deadline.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            process.Kill(entireProcessTree: true);
            return new SelfCheckResult(-1, $"pas de réponse en {SelfCheckTimeout.TotalMinutes:0} min");
        }

        return new SelfCheckResult(process.ExitCode, (await output.ConfigureAwait(false)) + (await error.ConfigureAwait(false)));
    }

    public IStartedAgent StartTakeover(string executable) => new StartedAgent(WatchHost.StartInBackground("watch --takeover", executable));

    private sealed class StartedAgent : IStartedAgent
    {
        private readonly Process? _process;

        public StartedAgent(int processId)
        {
            try
            {
                _process = Process.GetProcessById(processId);
                Exited = _process.WaitForExitAsync();
            }
            catch (ArgumentException)
            {
                // Déjà terminé.
                Exited = Task.CompletedTask;
            }
        }

        public Task Exited { get; }

        public void Kill() => _process?.Kill(entireProcessTree: true);

        public void Dispose() => _process?.Dispose();
    }
}
