using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using AltBoardSync.Core.Lua;
using AltBoardSync.Core.Sync;

namespace AltBoardSync.Core.Economy;

/// <summary>Ce que l'agent retient d'EZAuctioneer.lua : les relevés de chaque scan complet, par marché.</summary>
public sealed record EzAuctioneerData(int Schema, IReadOnlyList<ScanMarketPayload> Markets);

/// <summary>
/// Lit les SavedVariables de l'addon EZAuctioneer (voir docs/EZAUCTIONEER-DATA-MODEL.md). Pour chaque
/// marché, l'addon garde les derniers scans de chaque objet : heure du scan (heure du serveur de jeu),
/// prix au 25e percentile pondéré par les unités en vente, unités en vente. Seuls ces relevés et le
/// résumé des scans sont transmis : ni le journal des positions, ni le classement, ni les réglages.
/// </summary>
public static partial class EzAuctioneerReader
{
    /// <summary>
    /// Versions de <c>EZAuctioneerDB</c> dont l'historique a le format connu : la 3 (un seul historique
    /// pour l'HV neutre) à la 5 (EZAuctioneer 0.4.3). Les versions 4 et 5 n'ont changé que le
    /// classement et les réglages ; un compte pas encore ouvert avec la dernière version reste en 4.
    /// </summary>
    public const int MinSupportedSchema = 3;
    public const int MaxSupportedSchema = 5;

    public const int MaxMarkets = 20;

    /// <summary>L'addon en garde 8 000 par marché ; la marge couvre une version qui en garderait plus.</summary>
    public const int MaxItemsPerMarket = 20_000;

    /// <summary>L'addon en garde 12 par objet (réglage <c>maxSamples</c>) ; seuls les plus récents passent au-delà.</summary>
    public const int MaxSamplesPerItem = 50;

    public const int MaxScansPerMarket = 50;

    /// <summary>Horodatages acceptés : du 2020-01-01 au 2100-01-01, en secondes Unix.</summary>
    public const long MinTimestamp = 1_577_836_800;
    public const long MaxTimestamp = 4_102_444_800;

    public const long MaxCopper = AuctionatorReader.MaxCopper;
    public const int MaxUnits = 1_000_000_000;

    /// <summary>Clé d'historique : objet, puis suffixe aléatoire (« de l'Ours »), puis facteur quand le suffixe est négatif.</summary>
    [GeneratedRegex(@"^i:\d{1,9}(:s-?\d{1,9}(:f\d{1,5})?)?$", RegexOptions.CultureInvariant)]
    private static partial Regex ItemKeyPattern();

    /// <summary>
    /// Clé de marché : <c>région:royaume:faction:faction</c> (HV de faction) ou <c>région:royaume:neutral</c>
    /// (HV neutre). Le royaume est celui que rend le jeu (<c>GetRealmName</c>).
    /// </summary>
    [GeneratedRegex(@"^(\d{1,4}|\?):[^\x00-\x1F]{1,80}:([^:\x00-\x1F]{1,40}:faction|neutral)$", RegexOptions.CultureInvariant)]
    private static partial Regex MarketKeyPattern();

    [GeneratedRegex(@"^[a-z][a-z0-9_-]{0,19}$", RegexOptions.CultureInvariant)]
    private static partial Regex OriginPattern();

    /// <summary>Lit les relevés, ou null si le fichier n'en contient aucun d'exploitable (un avertissement explique un format inconnu).</summary>
    public static EzAuctioneerData? Read(IReadOnlyDictionary<string, LuaValue> globals, List<string> warnings)
    {
        if (!globals.TryGetValue("EZAuctioneerDB", out var root) || root.AsTable() is not { } db)
        {
            warnings.Add("EZAuctioneer : EZAuctioneerDB absente, aucun scan transmis.");
            return null;
        }

        var schema = db.Get("schema")?.AsInt32();
        if (schema is not { } version || version < MinSupportedSchema || version > MaxSupportedSchema)
        {
            warnings.Add($"EZAuctioneer : version de base {schema?.ToString(CultureInfo.InvariantCulture) ?? "inconnue"} non prise en charge (attendue : {MinSupportedSchema} à {MaxSupportedSchema}), aucun scan transmis.");
            return null;
        }

        var reports = ReadReports(db);
        var markets = new List<ScanMarketPayload>();
        foreach (var (key, value) in db.Get("markets")?.AsTable()?.Entries ?? [])
        {
            if (key.Kind != LuaKeyKind.String || key.Text is not { Length: <= 120 } name || !MarketKeyPattern().IsMatch(name) || value.AsTable() is not { } market)
            {
                warnings.Add($"EZAuctioneer : marché « {Shorten(key.ToString())} » non reconnu, ignoré.");
                continue;
            }

            if (markets.Count == MaxMarkets)
            {
                warnings.Add($"EZAuctioneer : plus de {MaxMarkets} marchés, les suivants sont ignorés.");
                break;
            }

            var read = ReadMarket(name, market, reports.GetValueOrDefault(name) ?? new Dictionary<long, ScanPayload>(), warnings);
            if (read.Items.Count > 0) markets.Add(read);
        }

        markets.Sort((a, b) => string.CompareOrdinal(a.Key, b.Key));
        return markets.Count == 0 ? null : new EzAuctioneerData(version, markets);
    }

    private static ScanMarketPayload ReadMarket(string name, LuaTable market, Dictionary<long, ScanPayload> reports, List<string> warnings)
    {
        // Le résumé du dernier scan réussi du marché complète les rapports des cinq derniers scans.
        if (ReadReport(market.Get("lastSummary")?.AsTable(), "at") is { } summary) reports.TryAdd(summary.At, summary);

        var items = new List<ScanItemPayload>();
        int badKeys = 0, badSamples = 0;
        foreach (var (key, value) in market.Get("history")?.AsTable()?.Entries ?? [])
        {
            if (value.AsTable() is not { } entry) continue;
            if (key.Kind != LuaKeyKind.String || key.Text is not { } itemKey || !ItemKeyPattern().IsMatch(itemKey))
            {
                badKeys++;
                continue;
            }

            if (items.Count == MaxItemsPerMarket)
            {
                warnings.Add($"EZAuctioneer : « {name} » dépasse {MaxItemsPerMarket} objets, les suivants sont ignorés.");
                break;
            }

            var samples = ReadSamples(entry.Get("samples")?.AsTable(), ref badSamples);
            if (samples.Count > 0) items.Add(new ScanItemPayload(itemKey, samples));
        }

        if (badKeys > 0) warnings.Add($"EZAuctioneer : « {name} » : {badKeys} clés d'objet non reconnues, ignorées.");
        if (badSamples > 0) warnings.Add($"EZAuctioneer : « {name} » : {badSamples} relevés invalides, ignorés.");

        items.Sort((a, b) => string.CompareOrdinal(a.Key, b.Key));
        var scans = Distinct(reports.Values).TakeLast(MaxScansPerMarket).ToList();
        return new ScanMarketPayload(name, ContentHash(scans, items), scans, items);
    }

    /// <summary>Écart au-delà duquel deux rapports aux mêmes nombres sont deux scans différents.</summary>
    public const int SameScanSeconds = 60;

    /// <summary>
    /// Rapports dans l'ordre chronologique, un par scan. Le résumé du dernier scan et son rapport
    /// sont datés séparément par l'addon : constaté sur les fichiers réels, ils peuvent différer
    /// d'une seconde. Deux rapports si proches, aux mêmes nombres, décrivent le même scan.
    /// </summary>
    private static IEnumerable<ScanPayload> Distinct(IEnumerable<ScanPayload> reports)
    {
        ScanPayload? previous = null;
        foreach (var report in reports.OrderBy(r => r.At))
        {
            if (previous is not null && report.At - previous.At <= SameScanSeconds && report.Auctions == previous.Auctions && report.Items == previous.Items) continue;
            previous = report;
            yield return report;
        }
    }

    /// <summary>Relevés d'un objet, du plus ancien au plus récent, un par scan : <c>[heure, prix, unités]</c>.</summary>
    private static List<long[]> ReadSamples(LuaTable? table, ref int invalid)
    {
        var byTime = new SortedDictionary<long, long[]>();
        foreach (var (_, value) in table?.Entries ?? [])
        {
            var sample = value.AsTable();
            var at = sample?.Get("ts")?.AsInt64();
            var price = sample?.Get("p")?.AsInt64();
            var units = sample?.Get("units")?.AsInt64();
            if (at is not { } t || t < MinTimestamp || t > MaxTimestamp
                || price is not { } p || p < 1 || p > MaxCopper
                || units is not { } u || u < 0 || u > MaxUnits)
            {
                invalid++;
                continue;
            }

            byTime[t] = [t, p, u];
        }

        return byTime.Values.TakeLast(MaxSamplesPerItem).ToList();
    }

    /// <summary>Rapports des derniers scans réussis (<c>scanLog</c>), rangés par marché puis par heure de fin.</summary>
    private static Dictionary<string, Dictionary<long, ScanPayload>> ReadReports(LuaTable db)
    {
        var result = new Dictionary<string, Dictionary<long, ScanPayload>>(StringComparer.Ordinal);
        foreach (var (_, value) in db.Get("scanLog")?.AsTable()?.Entries ?? [])
        {
            var report = value.AsTable();
            if (report?.Get("outcome")?.AsString() != "ok" || report.Get("market")?.AsString() is not { } market) continue;
            if (ReadReport(report, "endedAt") is not { } scan) continue;
            if (!result.TryGetValue(market, out var scans)) result[market] = scans = new Dictionary<long, ScanPayload>();
            scans.TryAdd(scan.At, scan);
        }

        return result;
    }

    private static ScanPayload? ReadReport(LuaTable? report, string timeField)
    {
        if (report is null || report.Get(timeField)?.AsInt64() is not { } at || at < MinTimestamp || at > MaxTimestamp) return null;
        int? Count(string field) => report.Get(field)?.AsInt64() is { } n and >= 0 and <= MaxUnits ? (int)n : null;
        var origin = report.Get("origin")?.AsString();
        return new ScanPayload(at, Count("auctions"), Count("items"), origin is not null && OriginPattern().IsMatch(origin) ? origin : null);
    }

    /// <summary>Empreinte des relevés d'un marché : ne change que si un scan ou un relevé change.</summary>
    private static string ContentHash(IReadOnlyList<ScanPayload> scans, IReadOnlyList<ScanItemPayload> items)
    {
        var text = new StringBuilder();
        foreach (var scan in scans)
            text.Append(CultureInfo.InvariantCulture, $"{scan.At},{scan.Auctions},{scan.Items},{scan.Origin};");
        text.Append('\n');
        foreach (var item in items)
        {
            text.Append(item.Key).Append('|');
            foreach (var sample in item.Samples) text.AppendJoin(',', sample).Append(';');
            text.Append('\n');
        }

        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(text.ToString())));
    }

    private static string Shorten(string text) => text.Length > 60 ? text[..60] + "…" : text;
}
