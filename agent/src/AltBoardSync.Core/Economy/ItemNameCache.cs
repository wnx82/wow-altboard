using System.Buffers.Binary;
using System.Text;
using System.Text.RegularExpressions;
using AltBoardSync.Core.Sync;

namespace AltBoardSync.Core.Economy;

/// <summary>Noms lus dans un cache du jeu, et la version du client qui l'a écrit.</summary>
public sealed record ItemNameCacheData(int Build, IReadOnlyList<ItemNamePayload> Names);

/// <summary>
/// Cache des données envoyées par le serveur du jeu : <c>&lt;client&gt;\Cache\ADB\&lt;langue&gt;\DBCache.bin</c>.
/// Le client y range les enregistrements de ses tables absents des fichiers qu'il a livrés, dont les
/// noms de milliers d'objets de la table ItemSparse. Lecture seule. Format « XFTH » version 9, relevé
/// sur un vrai fichier de WoW Forever 1.60.1 (build 70862) :
/// <list type="bullet">
/// <item>en-tête de 44 octets : « XFTH », version (int32), build (int32), puis 32 octets ;</item>
/// <item>enregistrements de 32 octets d'en-tête : « XFTH », région, push, identifiant unique,
/// empreinte de la table (uint32), identifiant de l'enregistrement, taille des données (int32),
/// état (octet : 1 = valide, autre = supprimé), 3 octets de bourrage ; puis les données.</item>
/// </list>
/// Les données d'un enregistrement ItemSparse commencent par ses cinq chaînes, terminées par un octet
/// nul : description, trois noms alternatifs, puis le nom affiché.
/// </summary>
public static partial class ItemNameCache
{
    public const string FileName = "DBCache.bin";
    public const int SupportedVersion = 9;

    /// <summary>Empreinte de la table ItemSparse dans le cache.</summary>
    public const uint ItemSparseHash = 0x919BE54E;

    private const int HeaderSize = 44;
    private const int RecordHeaderSize = 32;
    private const int MaxNameLength = 200;
    private const int MaxNames = 100_000;
    private static readonly byte[] Magic = "XFTH"u8.ToArray();

    [GeneratedRegex(@"^\s*SET\s+textLocale\s+""([A-Za-z]{4})""", RegexOptions.Multiline | RegexOptions.CultureInvariant)]
    private static partial Regex TextLocale();

    /// <summary>
    /// Cache de la langue du client (<c>SET textLocale</c> de <c>WTF\Config.wtf</c>), ou le seul cache
    /// présent ; null s'il n'y en a aucun, ou plusieurs sans langue désignée.
    /// </summary>
    public static (string Path, string Locale)? Find(string flavorPath)
    {
        var root = Path.Combine(flavorPath, "Cache", "ADB");
        if (!Directory.Exists(root)) return null;

        string? locale = null;
        try
        {
            var config = Path.Combine(flavorPath, "WTF", "Config.wtf");
            if (File.Exists(config) && TextLocale().Match(File.ReadAllText(config)) is { Success: true } match) locale = match.Groups[1].Value;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            // Sans configuration lisible, le seul cache présent fait foi.
        }

        if (locale is not null)
        {
            var path = Path.Combine(root, locale, FileName);
            if (File.Exists(path)) return (path, locale);
        }

        var candidates = Directory.EnumerateDirectories(root).Where(d => File.Exists(Path.Combine(d, FileName))).ToList();
        return candidates.Count == 1 ? (Path.Combine(candidates[0], FileName), Path.GetFileName(candidates[0])) : null;
    }

    /// <summary>Noms d'objets du cache, par identifiant croissant. Un enregistrement supprimé retire le nom.</summary>
    /// <exception cref="InvalidDataException">Fichier d'un autre format ou d'une autre version, ou enregistrement tronqué.</exception>
    public static ItemNameCacheData Parse(ReadOnlySpan<byte> data)
    {
        if (data.Length < HeaderSize || !data[..4].SequenceEqual(Magic))
            throw new InvalidDataException("cache du jeu d'un format inconnu");
        var version = BinaryPrimitives.ReadInt32LittleEndian(data[4..]);
        if (version != SupportedVersion)
            throw new InvalidDataException($"cache du jeu en version {version}, seule la version {SupportedVersion} est lue");
        var build = BinaryPrimitives.ReadInt32LittleEndian(data[8..]);

        var names = new Dictionary<int, string>();
        var offset = HeaderSize;
        while (offset + RecordHeaderSize <= data.Length)
        {
            var header = data.Slice(offset, RecordHeaderSize);
            if (!header[..4].SequenceEqual(Magic)) throw new InvalidDataException($"enregistrement illisible à l'octet {offset}");
            var table = BinaryPrimitives.ReadUInt32LittleEndian(header[16..]);
            var id = BinaryPrimitives.ReadInt32LittleEndian(header[20..]);
            var size = BinaryPrimitives.ReadInt32LittleEndian(header[24..]);
            var valid = header[28] == 1;
            if (size < 0 || offset + RecordHeaderSize + size > data.Length) throw new InvalidDataException($"enregistrement tronqué à l'octet {offset}");

            if (table == ItemSparseHash && id > 0)
            {
                // Le dernier enregistrement d'un objet fait foi : une suppression retire le nom.
                if (valid && DisplayName(data.Slice(offset + RecordHeaderSize, size)) is { } name) names[id] = name;
                else names.Remove(id);
            }

            offset += RecordHeaderSize + size;
        }

        return new ItemNameCacheData(build, names.OrderBy(entry => entry.Key).Take(MaxNames).Select(entry => new ItemNamePayload(entry.Key, entry.Value)).ToList());
    }

    /// <summary>Cinquième chaîne terminée par un octet nul : le nom affiché. Null s'il manque, est vide ou trop long.</summary>
    private static string? DisplayName(ReadOnlySpan<byte> record)
    {
        for (var index = 0; index < 4; index++)
        {
            var end = record.IndexOf((byte)0);
            if (end < 0) return null;
            record = record[(end + 1)..];
        }

        var last = record.IndexOf((byte)0);
        if (last <= 0) return null;
        string name;
        try
        {
            name = new UTF8Encoding(false, throwOnInvalidBytes: true).GetString(record[..last]).Trim();
        }
        catch (DecoderFallbackException)
        {
            return null;
        }

        return name.Length is > 0 and <= MaxNameLength && !name.Any(char.IsControl) ? name : null;
    }
}
