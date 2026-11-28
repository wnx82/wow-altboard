using System.Text;
using AltBoardSync.Core.Lua;
using AltBoardSync.Core.Sync;

namespace AltBoardSync.Core.Economy;

/// <summary>Flux de prix d'une région, décodé : heure des données et maisons qui ont des prix.</summary>
public sealed record NaowhFeed(long Time, IReadOnlyDictionary<int, IReadOnlyList<NaowhFeedHousePayload>> Regions);

/// <summary>
/// Lit le flux de prix livré avec NaowhForever (<c>Interface\AddOns\NaowhForever_AuctionData\Prices.lua</c>,
/// voir docs/NAOWH-MARKET-DATA-MODEL.md) : pour chaque région et chaque hôtel des ventes de Blizzard,
/// le plus bas prix d'achat immédiat de chaque objet, son nombre d'annonces et sa médiane pondérée par
/// la quantité, tirés des données de Blizzard à la publication de l'addon. Le fichier est du code Lua
/// (<c>ns.AuctionFeed = { … }</c>) : seul le littéral de la table est lu, jamais exécuté.
/// </summary>
public static class NaowhFeedReader
{
    public const string AddonFolder = "NaowhForever_AuctionData";
    public const string FileName = "Prices.lua";

    public const int MaxRegions = 10;
    public const int MaxHousesPerRegion = 50;
    public const int MaxItemsPerHouse = 30_000;

    /// <summary>Base des nombres du flux.</summary>
    private const int Base = 36;

    private const string Assignment = "ns.AuctionFeed";

    public static readonly IReadOnlySet<string> Factions = new HashSet<string>(StringComparer.Ordinal) { "Alliance", "Horde", "Blackwater" };

    /// <summary>Chemin du flux d'un client, ou null si l'addon n'est pas installé.</summary>
    public static string? Find(string flavorPath)
    {
        var path = Path.Combine(flavorPath, "Interface", "AddOns", AddonFolder, FileName);
        return File.Exists(path) ? path : null;
    }

    /// <summary>
    /// Décode le flux, ou null s'il est vide (le dépôt de l'addon garde un fichier sans prix) ou d'un
    /// format inconnu ; un avertissement explique un format inconnu.
    /// </summary>
    public static NaowhFeed? Read(ReadOnlySpan<byte> content, List<string> warnings)
    {
        var source = Encoding.UTF8.GetString(content);
        var start = source.IndexOf(Assignment + " =", StringComparison.Ordinal);
        if (start < 0 || (start > 0 && source[start - 1] != '\n'))
        {
            warnings.Add($"NaowhForever : {FileName} ne contient pas {Assignment}, flux de prix non transmis.");
            return null;
        }

        // « ns.AuctionFeed = {…} » devient « AuctionFeed = {…} », une affectation que le lecteur de
        // SavedVariables accepte. Tout ce qui n'est pas un littéral y est refusé.
        var globals = SavedVariablesParser.Parse(source[(start + 3)..]);
        if (!globals.TryGetValue("AuctionFeed", out var root) || root.AsTable() is not { } feed
            || PayloadLimits.Timestamp(feed.Get("time")?.AsInt64()) is not { } time
            || feed.Get("regions")?.AsTable() is not { } regions)
        {
            warnings.Add($"NaowhForever : {FileName} d'un format inconnu, flux de prix non transmis.");
            return null;
        }

        var result = new SortedDictionary<int, IReadOnlyList<NaowhFeedHousePayload>>();
        var invalid = 0;
        foreach (var (regionKey, regionValue) in regions.Entries)
        {
            if (regionKey.AsInt64() is not (>= 1 and <= 1_000) || regionValue.AsTable() is not { } houses || result.Count == MaxRegions)
            {
                invalid++;
                continue;
            }

            var list = new List<NaowhFeedHousePayload>();
            foreach (var (houseKey, houseValue) in houses.Entries)
            {
                var house = houseValue.AsTable();
                if (houseKey.AsInt64() is not (>= 1 and <= int.MaxValue) || house is null
                    || house.Get("faction")?.AsString() is not { } faction || !Factions.Contains(faction)
                    || house.Get("prices")?.AsString() is not { } prices
                    || Decode(prices) is not { } items)
                {
                    invalid++;
                    continue;
                }

                if (items.Count > 0 && list.Count < MaxHousesPerRegion) list.Add(new NaowhFeedHousePayload((int)houseKey.AsInt64()!.Value, faction, items));
            }

            list.Sort((a, b) => a.Id.CompareTo(b.Id));
            if (list.Count > 0) result[(int)regionKey.AsInt64()!.Value] = list;
        }

        if (invalid > 0) warnings.Add($"NaowhForever : {FileName} : {invalid} régions ou maisons invalides, ignorées.");
        return result.Count == 0 ? null : new NaowhFeed(time, result);
    }

    /// <summary>
    /// Prix d'une maison : <c>écart:prix:annonces:médiane,…</c> en base 36, chaque objet donné par son
    /// écart avec le précédent (le premier depuis zéro), annonces et médiane facultatives. Un tableau
    /// <c>[objet, plus bas, médiane, annonces]</c> par objet, trié par objet ; null si la chaîne est mal formée.
    /// </summary>
    public static List<long?[]>? Decode(string prices)
    {
        var items = new List<long?[]>();
        long item = 0;
        foreach (var entry in prices.Split(',', StringSplitOptions.RemoveEmptyEntries))
        {
            var fields = entry.Split(':');
            if (fields.Length is < 2 or > 4 || Number(fields[0]) is not (>= 1 and var step)) return null;
            item += step;
            if (item > int.MaxValue) return null;
            var low = Number(fields[1]);
            if (low is not (>= 1 and <= PayloadLimits.MaxCopper)) return null;
            long? listed = fields.Length > 2 && fields[2].Length > 0 ? Number(fields[2]) : null;
            long? median = fields.Length > 3 && fields[3].Length > 0 ? Number(fields[3]) : null;
            if (listed is < 0 or > NaowhMarketReader.MaxListed || median is < 1 or > PayloadLimits.MaxCopper) return null;
            if (fields.Length > 2 && fields[2].Length > 0 && listed is null) return null;
            if (fields.Length > 3 && fields[3].Length > 0 && median is null) return null;
            if (items.Count == MaxItemsPerHouse) break;
            items.Add([item, low, median, listed]);
        }

        return items;
    }

    /// <summary>Entier en base 36 (chiffres puis lettres minuscules), ou null : vide, autre caractère, trop grand.</summary>
    private static long? Number(string text)
    {
        if (text.Length is 0 or > 12) return null;
        long value = 0;
        foreach (var c in text)
        {
            int digit = c switch
            {
                >= '0' and <= '9' => c - '0',
                >= 'a' and <= 'z' => c - 'a' + 10,
                _ => -1,
            };
            if (digit < 0) return null;
            value = value * Base + digit;
        }

        return value;
    }

    /// <summary>Écart de prix toléré entre un scan du joueur et une maison du flux (comme l'addon : 1 %).</summary>
    public const double MatchSpread = 0.01;

    /// <summary>Objets concordants au moins pour reconnaître une maison (comme l'addon : 20).</summary>
    public const int MatchMin = 20;

    /// <summary>
    /// Région du flux dont une maison concorde le mieux avec les scans du joueur (plus bas prix à 1 %
    /// près, comme le fait l'addon pour trouver la maison du joueur), ou null si aucune n'atteint
    /// <see cref="MatchMin"/> objets : sans scan, la région du joueur est inconnue.
    /// </summary>
    public static int? MatchRegion(NaowhFeed feed, IEnumerable<NaowhHousePayload> houses)
    {
        var scans = houses
            .Select(house => house.Items.Where(item => item[1] is not null).ToDictionary(item => item[0]!.Value, item => item[1]!.Value))
            .Where(prices => prices.Count > 0)
            .ToList();
        int? best = null;
        var most = MatchMin - 1;
        foreach (var (region, feedHouses) in feed.Regions)
        {
            foreach (var house in feedHouses)
            {
                foreach (var own in scans)
                {
                    var count = house.Items.Count(item => own.TryGetValue(item[0]!.Value, out var price) && Math.Abs(item[1]!.Value - price) <= price * MatchSpread);
                    if (count <= most) continue;
                    most = count;
                    best = region;
                }
            }
        }

        return best;
    }
}
