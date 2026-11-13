using System.Text;
using AltBoardSync.Core.App;
using AltBoardSync.Core.Config;

// Sans terminal ni script pour lire la sortie : double-clic, ouverture de session, « autostart on ».
var detached = NativeConsole.IsDetached();
if (!detached)
{
    try
    {
        Console.OutputEncoding = Encoding.UTF8;
    }
    catch (IOException)
    {
        // Sortie redirigée sans console : rien à régler.
    }
}

// La fenêtre : un double-clic sur l'exécutable, ou la commande « ui ».
var wantsWindow = OperatingSystem.IsWindows()
    && ((args.Length == 0 && detached) || args is [var first] && first.Equals("ui", StringComparison.OrdinalIgnoreCase));
// Une surveillance plus ancienne tourne (la mise à jour vient d'être téléchargée) : celle-ci prend sa place.
var replacing = false;
string? replacedVersion = null;
if (wantsWindow && OperatingSystem.IsWindows())
{
    var olderRunning = WatchHost.RunningIsOlder(AgentApp.Version, out replacedVersion);
    // Une surveillance de cette version, ou plus récente, tourne déjà : la fenêtre est la sienne.
    if (!olderRunning && WatchHost.ShowRunning()) return AgentApp.ExitOk;
    if (!detached)
    {
        // Depuis un terminal : il est rendu tout de suite, la fenêtre vit dans son propre processus.
        if (!StartInBackground("ui")) return AgentApp.ExitFailed;
        Console.WriteLine("AltBoard Sync est ouvert : sa fenêtre s'affiche, son icône est dans la zone de notification.");
        return AgentApp.ExitOk;
    }

    if (olderRunning)
    {
        if (!WatchHost.StopRunningAndWait(TimeSpan.FromSeconds(15)))
        {
            Win32.MessageBoxW(
                0, "Une version plus ancienne d'AltBoard Sync tourne et ne s'arrête pas.\n\nQuittez-la par son icône de la zone de notification, puis relancez celle-ci.",
                "AltBoard Sync", Win32.MbIconError);
            return AgentApp.ExitFailed;
        }

        replacing = true;
    }

    args = ["watch"];
}

// « watch » sans terminal : tâche de fond. Elle quitte sa console, qui se ferme, et ne parle plus
// que par sa fenêtre, la zone de notification et le journal.
var watching = args.Length > 0 && args[0].Equals("watch", StringComparison.OrdinalIgnoreCase);
var background = watching && detached;
if (background) NativeConsole.Detach();

using var cancellation = new CancellationTokenSource();
if (!background)
{
    Console.CancelKeyPress += (_, e) =>
    {
        e.Cancel = true;
        cancellation.Cancel();
    };
}

// « token set » en console interactive : saisie masquée, le jeton ne s'affiche jamais.
var input = background ? TextReader.Null : Console.In;
if (args is ["token", "set"] && !Console.IsInputRedirected)
{
    Console.Write("Jeton d'agent : ");
    var typed = new StringBuilder();
    while (true)
    {
        var key = Console.ReadKey(intercept: true);
        if (key.Key == ConsoleKey.Enter) break;
        if (key.Key == ConsoleKey.Backspace)
        {
            if (typed.Length > 0) typed.Length--;
        }
        else if (!char.IsControl(key.KeyChar))
        {
            typed.Append(key.KeyChar);
        }
    }

    Console.WriteLine();
    input = new StringReader(typed.ToString());
}

// En tâche de fond, personne ne lit la sortie : les erreurs sont gardées pour une boîte de message.
var backgroundErrors = new StringWriter();
var autostart = OperatingSystem.IsWindows() ? new RegistryAutostart() : null;
var environment = new AgentEnvironment
{
    HomeDirectory = AgentConfigStore.DefaultDirectory,
    Out = background ? TextWriter.Null : Console.Out,
    Error = background ? TextWriter.Synchronized(backgroundErrors) : Console.Error,
    In = input,
    Autostart = autostart,
};

WatchHost? host = null;
if (watching && OperatingSystem.IsWindows())
{
    host = WatchHost.TryStart(cancellation, environment.HomeDirectory, autostart!, showWindow: wantsWindow);
    if (host is null)
    {
        if (wantsWindow)
        {
            // Une autre surveillance vient de démarrer (double-clic répété) : sa fenêtre arrive.
            var shown = false;
            for (var attempt = 0; attempt < 15 && !(shown = WatchHost.ShowRunning()); attempt++) Thread.Sleep(200);
            if (shown) return AgentApp.ExitOk;
            // Elle ne répond pas, ou vient d'une version sans fenêtre : sans console, seule une
            // boîte de message peut le dire.
            Win32.MessageBoxW(
                0, "AltBoard Sync tourne déjà mais n'affiche pas sa fenêtre.\n\nQuittez-le par son icône de la zone de notification, puis relancez-le.",
                "AltBoard Sync", Win32.MbIconError);
        }
        else if (!background)
        {
            Console.Error.WriteLine("La synchronisation automatique tourne déjà dans cette session.");
        }

        return AgentApp.ExitFailed;
    }

    environment = environment with { WatchControl = host.Control, OnWatchEvent = host.OnEvent };
    // La version remplacée était peut-être celle que lance le démarrage avec Windows.
    if (replacing)
    {
        string? autostartCommand = null;
        try
        {
            autostartCommand = autostart!.PointHere();
        }
        catch (Exception e) when (e is UnauthorizedAccessException or IOException or System.Security.SecurityException)
        {
            // Inscription inchangée : l'interrupteur de la fenêtre permet de la refaire.
        }

        host.ReportReplaced(replacedVersion, autostartCommand);
    }
}

int exitCode;
try
{
    exitCode = await new AgentApp(environment).RunAsync(args, cancellation.Token);
}
catch (OperationCanceledException)
{
    environment.Error.WriteLine("Interrompu.");
    exitCode = AgentApp.ExitFailed;
}
catch (Exception e)
{
    // Filet de dernier recours : une sortie sans un mot laisserait croire à un arrêt normal. En
    // arrière-plan, ce texte part dans la boîte de message ci-dessous.
    environment.Error.WriteLine($"Erreur inattendue ({e.GetType().Name}) : {e.Message}");
    exitCode = AgentApp.ExitFailed;
}
finally
{
    if (OperatingSystem.IsWindows()) host?.Dispose();
}

// La surveillance n'a pas pu démarrer (configuration illisible, URL invalide) : sans console,
// seule une boîte de message peut le dire.
if (background && exitCode != AgentApp.ExitOk && OperatingSystem.IsWindows() && backgroundErrors.ToString().Trim() is { Length: > 0 } errors)
    Win32.MessageBoxW(0, errors, "AltBoard Sync", Win32.MbIconError);

// « autostart on » lance aussi la surveillance tout de suite, « autostart off » arrête celle qui tourne.
if (OperatingSystem.IsWindows() && exitCode == AgentApp.ExitOk && args is [var command, var action]
    && command.Equals("autostart", StringComparison.OrdinalIgnoreCase))
{
    if (action == "on")
    {
        if (WatchHost.IsRunning())
        {
            Console.WriteLine("La synchronisation automatique tourne déjà.");
        }
        else if (StartInBackground("watch"))
        {
            Console.WriteLine("Synchronisation automatique démarrée en arrière-plan : son icône est dans la zone de notification.");
        }
        else
        {
            exitCode = AgentApp.ExitFailed;
        }
    }
    else if (action == "off" && WatchHost.StopRunning())
    {
        Console.WriteLine("Synchronisation automatique en cours arrêtée.");
    }
}

return exitCode;

static bool StartInBackground(string command)
{
    if (!OperatingSystem.IsWindows()) return false;
    try
    {
        WatchHost.StartInBackground(command);
        return true;
    }
    catch (System.ComponentModel.Win32Exception e)
    {
        Console.Error.WriteLine($"Erreur : la synchronisation automatique n'a pas pu être lancée ({e.Message}).");
        return false;
    }
}
