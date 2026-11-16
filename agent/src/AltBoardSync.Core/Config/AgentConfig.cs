using System.Text.Json;
using System.Text.Json.Serialization;
using AltBoardSync.Core.Discovery;

namespace AltBoardSync.Core.Config;

public sealed record AgentConfig
{
    public const string DefaultServerUrl = "https://wow.ekreativ.be/api/sync";

    /// <summary>Identité de l'installation, générée au premier lancement. Le nom d'hôte n'en tient jamais lieu : un PC peut être renommé.</summary>
    public Guid MachineUuid { get; init; }

    public string? MachineName { get; init; }

    public string WowPath { get; init; } = AccountScanner.DefaultWowPath;

    public string ServerUrl { get; init; } = DefaultServerUrl;

    /// <summary>
    /// Mise à jour automatique (agent 0.9.0 et suivants) ; absente, elle est active. Nullable plutôt
    /// qu'un booléen à true : le générateur de sérialisation passe les propriétés init par l'initialiseur
    /// d'objet, et une clé absente d'une configuration plus ancienne y vaudrait false.
    /// </summary>
    public bool? AutoUpdate { get; init; }

    [JsonIgnore]
    public bool UpdatesAutomatically => AutoUpdate ?? true;
}

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase, WriteIndented = true)]
[JsonSerializable(typeof(AgentConfig))]
[JsonSerializable(typeof(WatchState))]
public sealed partial class AgentJsonContext : JsonSerializerContext;

/// <summary>Configuration locale (<c>%APPDATA%\AltBoardSync\config.json</c>). Ne contient aucun secret.</summary>
public sealed class AgentConfigStore(string directory)
{
    public const string HomeEnvironmentVariable = "ALTBOARDSYNC_HOME";

    public string Directory { get; } = directory;

    public string ConfigPath => Path.Combine(Directory, "config.json");

    public static string DefaultDirectory =>
        Environment.GetEnvironmentVariable(HomeEnvironmentVariable) is { Length: > 0 } home
            ? home
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "AltBoardSync");

    public AgentConfig LoadOrCreate()
    {
        if (!File.Exists(ConfigPath))
        {
            var created = new AgentConfig { MachineUuid = Guid.NewGuid() };
            Save(created);
            return created;
        }

        AgentConfig? config;
        try
        {
            config = JsonSerializer.Deserialize(File.ReadAllText(ConfigPath), AgentJsonContext.Default.AgentConfig);
        }
        catch (JsonException e)
        {
            // Ne jamais régénérer en silence : un nouvel UUID créerait une seconde machine côté serveur.
            throw new InvalidDataException($"Configuration illisible ({ConfigPath}) : {e.Message}", e);
        }

        if (config is null) throw new InvalidDataException($"Configuration vide ({ConfigPath})");
        var repaired = config;
        if (repaired.MachineUuid == Guid.Empty) repaired = repaired with { MachineUuid = Guid.NewGuid() };
        // Jusqu'à la version 0.4.0, le défaut désignait le client de la bêta et chaque configuration
        // l'a enregistré tel quel : il ne verrait jamais celui de la sortie officielle. La racine qui
        // le contient lit les deux.
        if (BetaClientRoot(repaired.WowPath) is { } root) repaired = repaired with { WowPath = root };
        if (repaired != config) Save(repaired);
        return repaired;
    }

    /// <summary>Racine contenant <paramref name="wowPath"/> quand il désigne le client de la bêta ; sinon null.</summary>
    private static string? BetaClientRoot(string wowPath)
    {
        var trimmed = wowPath.TrimEnd('\\', '/');
        var separator = trimmed.LastIndexOfAny(['\\', '/']);
        if (separator <= 0 || !trimmed[(separator + 1)..].Equals(AccountScanner.BetaFlavor, StringComparison.OrdinalIgnoreCase)) return null;
        return trimmed[..separator];
    }

    public void Save(AgentConfig config)
    {
        System.IO.Directory.CreateDirectory(Directory);
        var temporary = ConfigPath + ".tmp";
        File.WriteAllText(temporary, JsonSerializer.Serialize(config, AgentJsonContext.Default.AgentConfig));
        File.Move(temporary, ConfigPath, overwrite: true);
    }
}
