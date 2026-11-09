using System.Text.Json;

namespace AltBoardSync.Core.Config;

/// <summary>Dernière empreinte envoyée par compte : ce que « watch » compare avant de renvoyer.</summary>
public sealed record WatchState
{
    public Dictionary<string, string> Fingerprints { get; init; } = new();

    /// <summary>Empreinte du cache de noms d'objets envoyé, par client : un cache inchangé n'est pas renvoyé.</summary>
    public Dictionary<string, string> ItemNameHashes { get; init; } = new();
}

/// <summary>
/// État local de la surveillance (<c>%APPDATA%\AltBoardSync\state.json</c>). Perdu ou illisible, il
/// ne coûte qu'un envoi de plus : le serveur ignore un document qu'il connaît déjà.
/// </summary>
public sealed class WatchStateStore(string directory)
{
    public string StatePath => Path.Combine(directory, "state.json");

    public WatchState Load()
    {
        try
        {
            if (File.Exists(StatePath) && JsonSerializer.Deserialize(File.ReadAllText(StatePath), AgentJsonContext.Default.WatchState) is { } state)
            {
                // Le générateur de sérialisation passe les propriétés init par l'initialiseur d'objet :
                // une clé absente (état écrit par un agent plus ancien) ou nulle y vaut null, pas new().
                return state with { Fingerprints = state.Fingerprints ?? [], ItemNameHashes = state.ItemNameHashes ?? [] };
            }
        }
        catch (Exception e) when (e is JsonException or IOException or UnauthorizedAccessException)
        {
            // Repartir d'un état vide.
        }

        return new WatchState();
    }

    public void Save(WatchState state)
    {
        Directory.CreateDirectory(directory);
        var temporary = StatePath + ".tmp";
        File.WriteAllText(temporary, JsonSerializer.Serialize(state, AgentJsonContext.Default.WatchState));
        File.Move(temporary, StatePath, overwrite: true);
    }
}
