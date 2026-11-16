using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using AltBoardSync.Core.Sync;

namespace AltBoardSync.Core.App;

public sealed record JournalEntry
{
    public const string Synced = "synced";
    public const string Failed = "failed";
    public const string Info = "info";

    /// <summary>Mise à jour automatique en échec : la synchronisation, elle, continue.</summary>
    public const string UpdateFailed = "update_failed";

    public required DateTimeOffset At { get; init; }

    public required string Kind { get; init; }

    public required string Message { get; init; }

    /// <summary>Nombre de personnages envoyés ; absent hors synchronisation réussie.</summary>
    public int? Characters { get; init; }

    public IReadOnlyList<CharacterChange> Changes { get; init; } = [];
}

/// <summary>Personnages du dernier envoi accepté (<c>characters.json</c>), auxquels le suivant est comparé.</summary>
public sealed record KnownCharacters
{
    public Dictionary<string, CharacterDigest> Characters { get; init; } = new();
}

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(JournalEntry))]
[JsonSerializable(typeof(KnownCharacters))]
public sealed partial class JournalJsonContext : JsonSerializerContext;

/// <summary>
/// Journal des synchronisations (<c>journal.jsonl</c>, une entrée par ligne) : ce qu'affiche la
/// fenêtre de l'agent. Il nomme les personnages, contrairement à <c>altboardsync.log</c>, et ne
/// quitte jamais la machine. Indisponible, il ne fait jamais échouer une synchronisation.
/// </summary>
public sealed class SyncJournal(string directory, Func<DateTimeOffset> now)
{
    private const long MaxBytes = 256 * 1024;
    private const int KeptEntries = 200;

    private readonly string _knownPath = Path.Combine(directory, "characters.json");

    public string JournalPath => Path.Combine(directory, "journal.jsonl");

    /// <summary>Inscrit un envoi accepté, avec ce qui a changé depuis le précédent.</summary>
    public IReadOnlyList<CharacterChange> Synced(SyncPayload document, string message)
    {
        var current = document.Accounts
            .SelectMany(account => account.Characters.Select(c => (Key: ChangeDetector.Key(account, c), Digest: ChangeDetector.Digest(c))))
            .ToList();
        IReadOnlyList<CharacterChange> changes = [];
        try
        {
            var known = LoadKnown();
            changes = ChangeDetector.Compare(known?.Characters, current);
            // Les personnages absents de cet envoi (compte illisible cette fois) restent connus.
            known ??= new KnownCharacters();
            foreach (var (key, digest) in current) known.Characters[key] = digest;
            WriteAtomically(_knownPath, JsonSerializer.Serialize(known, JournalJsonContext.Default.KnownCharacters));
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException)
        {
            // Comparaison impossible cette fois : l'envoi est inscrit sans le détail.
        }

        Append(new JournalEntry { At = now(), Kind = JournalEntry.Synced, Message = message, Characters = current.Count, Changes = changes });
        return changes;
    }

    public void Failed(string message) => Append(new JournalEntry { At = now(), Kind = JournalEntry.Failed, Message = message });

    public void Info(string message) => Append(new JournalEntry { At = now(), Kind = JournalEntry.Info, Message = message });

    public void UpdateFailed(string message) => Append(new JournalEntry { At = now(), Kind = JournalEntry.UpdateFailed, Message = message });

    /// <summary>Les dernières entrées, la plus récente en premier.</summary>
    public IReadOnlyList<JournalEntry> ReadLatest(int count = KeptEntries)
    {
        var entries = new List<JournalEntry>();
        try
        {
            if (!File.Exists(JournalPath)) return entries;
            // Partage total : une synchronisation peut écrire pendant la lecture.
            using var stream = new FileStream(JournalPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            using var reader = new StreamReader(stream, Encoding.UTF8);
            while (reader.ReadLine() is { } line)
            {
                if (Parse(line) is { } entry) entries.Add(entry);
            }
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            // Ce qui a pu être lu est rendu.
        }

        entries.Reverse();
        return entries.Count > count ? entries.GetRange(0, count) : entries;
    }

    private static JournalEntry? Parse(string line)
    {
        if (string.IsNullOrWhiteSpace(line)) return null;
        try
        {
            var entry = JsonSerializer.Deserialize(line, JournalJsonContext.Default.JournalEntry);
            if (entry?.Kind is null || entry.Message is null) return null;
            // Un champ omis ou nul dans le fichier reste nul ici, malgré sa valeur par défaut.
            var changes = (entry.Changes ?? []).Where(c => c?.Name is not null && c.Details is not null).ToList();
            return entry with { Changes = changes };
        }
        catch (JsonException)
        {
            // Ligne tronquée par une écriture interrompue.
            return null;
        }
    }

    /// <returns>Null si aucun envoi n'a encore été relevé.</returns>
    private KnownCharacters? LoadKnown()
    {
        if (!File.Exists(_knownPath)) return null;
        var known = JsonSerializer.Deserialize(File.ReadAllText(_knownPath), JournalJsonContext.Default.KnownCharacters);
        if (known?.Characters is null) return null;
        // Même précaution que pour le journal : un champ omis ne doit pas faire échouer la comparaison.
        foreach (var (key, digest) in known.Characters.ToList())
        {
            if (digest is null) known.Characters.Remove(key);
            else known.Characters[key] = digest with { Professions = digest.Professions ?? new(), Sections = digest.Sections ?? new() };
        }

        return known;
    }

    private void Append(JournalEntry entry)
    {
        try
        {
            Directory.CreateDirectory(directory);
            File.AppendAllText(JournalPath, JsonSerializer.Serialize(entry, JournalJsonContext.Default.JournalEntry) + "\n");
            if (new FileInfo(JournalPath).Length <= MaxBytes) return;
            var kept = File.ReadAllLines(JournalPath).TakeLast(KeptEntries);
            WriteAtomically(JournalPath, string.Join('\n', kept) + "\n");
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            // Voir le résumé de la classe.
        }
    }

    private static void WriteAtomically(string path, string content)
    {
        var temporary = path + ".tmp";
        File.WriteAllText(temporary, content);
        File.Move(temporary, path, overwrite: true);
    }
}
