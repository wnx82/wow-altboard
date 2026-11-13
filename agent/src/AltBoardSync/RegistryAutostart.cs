using System.Runtime.Versioning;
using AltBoardSync.Core.App;
using Microsoft.Win32;

/// <summary>
/// Lance « watch » à l'ouverture de session par la clé Run de l'utilisateur. Pas un service
/// Windows : il tournerait sous un autre compte et ne pourrait pas déchiffrer le jeton (DPAPI).
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class RegistryAutostart : IAutostart
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "AltBoardSync";

    public bool IsEnabled
    {
        get
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKey);
            return key?.GetValue(ValueName) is string;
        }
    }

    /// <summary>Enregistre l'emplacement actuel de l'exécutable : à refaire s'il est déplacé.</summary>
    public void Enable()
    {
        var executable = Environment.ProcessPath ?? throw new InvalidOperationException("Emplacement de l'exécutable inconnu.");
        // Par conhost sans affichage : lancé directement, un programme en console ouvrirait une
        // fenêtre à chaque ouverture de session, le temps de s'en détacher.
        var conhost = Path.Combine(Environment.SystemDirectory, "conhost.exe");
        var command = File.Exists(conhost) ? $"\"{conhost}\" --headless \"{executable}\" watch" : $"\"{executable}\" watch";
        using var key = Registry.CurrentUser.CreateSubKey(RunKey);
        key.SetValue(ValueName, command);
    }

    /// <summary>
    /// Démarrage activé vers un autre exécutable que celui-ci (une version plus ancienne, ailleurs sur
    /// le PC) : le fait pointer sur celui-ci.
    /// </summary>
    /// <returns>La nouvelle commande, ou null si rien n'a changé.</returns>
    public string? PointHere()
    {
        string? command;
        using (var key = Registry.CurrentUser.OpenSubKey(RunKey)) command = key?.GetValue(ValueName) as string;
        var executable = Environment.ProcessPath;
        if (command is null || executable is null || command.Contains($"\"{executable}\"", StringComparison.OrdinalIgnoreCase)) return null;
        Enable();
        using var updated = Registry.CurrentUser.OpenSubKey(RunKey);
        return updated?.GetValue(ValueName) as string;
    }

    public void Disable()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey, writable: true);
        key?.DeleteValue(ValueName, throwOnMissingValue: false);
    }
}
