using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using AltBoardSync.Core.Lua;
using AltBoardSync.Core.Sync;

namespace AltBoardSync.Core.Economy;

/// <summary>Ce que l'agent retient d'Auctionator.lua : la base de prix par hôtel des ventes et le cache des prix marchands.</summary>
public sealed record AuctionatorData(int DbVersion, IReadOnlyList<MarketPayload> Markets, IReadOnlyList<VendorPricePayload> VendorPrices);

/// <summary>
/// Lit les SavedVariables de l'addon Auctionator (voir docs/AUCTIONATOR-DATA-MODEL.md). Chaque hôtel
/// des ventes de <c>AUCTIONATOR_PRICE_DATABASE</c> est une table, ou une chaîne CBOR quand le client
/// l'a sérialisé à la déconnexion. Seuls les prix sont transmis : aucune valeur n'est calculée ici.
/// </summary>
public static partial class AuctionatorReader
{
    /// <summary>Version de base qu'écrit Auctionator 341 (<c>VERSION_KEY_SERIALIZED</c>) : la seule dont le format est connu.</summary>
    public const int SupportedDbVersion = 8;

    public const int MaxMarkets = 20;
    public const int MaxItemsPerMarket = 100_000;
    public const int MaxDaysPerItem = 400;
    public const int MaxVendorPrices = 100_000;

    /// <summary>Jour Auctionator le plus grand accepté (0 = 2020-01-01 ; 40 000 ≈ an 2129).</summary>
    public const int MaxDay = 40_000;

    /// <summary>Plafond d'un prix en pièces de cuivre (un milliard de pièces d'or) : au-delà, la valeur est corrompue.</summary>
    public const long MaxCopper = 10_000_000_000_000;

    public const int MaxAvailable = 1_000_000_000;

    /// <summary>Clé d'objet : identifiant seul, équipement par niveau d'objet (<c>g:</c>) ou mascotte (<c>p:</c>).</summary>
    [GeneratedRegex(@"^(\d{1,9}|g:\d{1,9}:\d{1,5}|p:\d{1,9})$", RegexOptions.CultureInvariant)]
    private static partial Regex ItemKeyPattern();

    /// <summary>
    /// Variante à suffixe aléatoire (WoW Forever, Auctionator 352) : <c>gr:&lt;objet&gt;:&lt;suffixe anglais&gt;</c>,
    /// par exemple <c>gr:15502:of the Monkey</c>. Auctionator range chaque enchère sous cette clé et sous
    /// la clé simple de l'objet, qui porte donc déjà le plus bas prix de toutes ses variantes. Ces clés ne
    /// sont pas transmises, sans avertissement : les prix par variante viennent des scans d'EZAuctioneer.
    /// </summary>
    [GeneratedRegex(@"^gr:\d{1,9}:", RegexOptions.CultureInvariant)]
    private static partial Regex SuffixVariantKeyPattern();

    /// <summary>Lit les données, ou null si le fichier n'a pas de base de prix exploitable (un avertissement l'explique).</summary>
    public static AuctionatorData? Read(IReadOnlyDictionary<string, LuaValue> globals, List<string> warnings)
    {
        if (!globals.TryGetValue("AUCTIONATOR_PRICE_DATABASE", out var root) || root.AsTable() is not { } database)
        {
            warnings.Add("Auctionator : AUCTIONATOR_PRICE_DATABASE absente, aucun prix transmis.");
            return null;
        }

        var version = database.Get("__dbversion")?.AsInt32();
        if (version != SupportedDbVersion)
        {
            warnings.Add($"Auctionator : version de base {version?.ToString(CultureInfo.InvariantCulture) ?? "inconnue"} non prise en charge (attendue : {SupportedDbVersion}), aucun prix transmis.");
            return null;
        }

        var markets = new List<MarketPayload>();
        foreach (var (key, value) in database.Entries)
        {
            if (key.Kind != LuaKeyKind.String || key.Text is not { Length: > 0 and <= 120 } name || name == "__dbversion") continue;
            if (markets.Count == MaxMarkets)
            {
                warnings.Add($"Auctionator : plus de {MaxMarkets} hôtels des ventes, les suivants sont ignorés.");
                break;
            }

            LuaTable? table;
            try
            {
                table = value switch
                {
                    LuaTable t => t,
                    // Chaîne lue en mode binaire : chaque caractère est un octet du document CBOR.
                    LuaString s => CborDecoder.Decode(Encoding.Latin1.GetBytes(s.Value))?.AsTable(),
                    _ => null,
                };
            }
            catch (CborFormatException e)
            {
                warnings.Add($"Auctionator : hôtel des ventes « {name} » illisible ({e.Message}), ignoré.");
                continue;
            }

            if (table is null)
            {
                warnings.Add($"Auctionator : hôtel des ventes « {name} » de forme inattendue, ignoré.");
                continue;
            }

            var market = ReadMarket(name, table, warnings);
            if (market.Items.Count > 0) markets.Add(market);
        }

        return new AuctionatorData(SupportedDbVersion, markets, ReadVendorPrices(globals, warnings));
    }

    private static MarketPayload ReadMarket(string name, LuaTable table, List<string> warnings)
    {
        var items = new List<MarketItemPayload>();
        int badKeys = 0, badDays = 0;
        foreach (var (key, value) in table.Entries)
        {
            // La table contient aussi des marqueurs internes (version = 2) : seules les tables d'objet comptent.
            if (value.AsTable() is not { } entry) continue;
            var itemKey = key.Kind == LuaKeyKind.String ? key.Text : key.AsInt64()?.ToString(CultureInfo.InvariantCulture);
            if (itemKey is not null && SuffixVariantKeyPattern().IsMatch(itemKey)) continue;
            if (itemKey is null || !ItemKeyPattern().IsMatch(itemKey))
            {
                badKeys++;
                continue;
            }

            if (items.Count == MaxItemsPerMarket)
            {
                warnings.Add($"Auctionator : « {name} » dépasse {MaxItemsPerMarket} objets, les suivants sont ignorés.");
                break;
            }

            var days = ReadDays(entry, ref badDays);
            if (days.Count == 0) continue;
            var lastMin = entry.Get("m")?.AsInt64() is { } m and > 0 and <= MaxCopper ? m : (long?)null;
            items.Add(new MarketItemPayload(itemKey, lastMin, days));
        }

        if (badKeys > 0) warnings.Add($"Auctionator : « {name} » : {badKeys} clés d'objet non reconnues, ignorées.");
        if (badDays > 0) warnings.Add($"Auctionator : « {name} » : {badDays} relevés journaliers invalides, ignorés.");

        items.Sort((a, b) => string.CompareOrdinal(a.Key, b.Key));
        return new MarketPayload(name, ContentHash(items), items);
    }

    /// <summary>
    /// Un relevé par jour : plus bas et plus haut des prix minimums vus ce jour-là, plus grande
    /// quantité en vente. Auctionator n'écrit le plus bas (<c>l</c>) que s'il diffère du plus haut (<c>h</c>).
    /// </summary>
    private static List<long?[]> ReadDays(LuaTable entry, ref int invalid)
    {
        var highs = DayValues(entry.Get("h"), MaxCopper, ref invalid);
        var lows = DayValues(entry.Get("l"), MaxCopper, ref invalid);
        var available = DayValues(entry.Get("a"), MaxAvailable, ref invalid);

        var days = new SortedSet<int>(highs.Keys);
        days.UnionWith(lows.Keys);

        var result = new List<long?[]>(days.Count);
        foreach (var day in days.Reverse())
        {
            if (result.Count == MaxDaysPerItem) break;
            long? high = highs.TryGetValue(day, out var h) ? h : null;
            long? low = lows.TryGetValue(day, out var l) ? l : null;
            low ??= high;
            high ??= low;
            if (low > high) (low, high) = (high, low);
            result.Add([day, low, high, available.TryGetValue(day, out var a) ? a : null]);
        }

        result.Reverse();
        return result;
    }

    private static Dictionary<int, long> DayValues(LuaValue? value, long max, ref int invalid)
    {
        var result = new Dictionary<int, long>();
        if (value?.AsTable() is not { } table) return result;
        foreach (var (key, raw) in table.Entries)
        {
            var day = key.Kind == LuaKeyKind.String
                ? int.TryParse(key.Text, NumberStyles.None, CultureInfo.InvariantCulture, out var parsed) ? parsed : -1
                : key.AsInt64() is { } n and >= 0 and <= MaxDay ? (int)n : -1;
            var number = raw.AsInt64();
            if (day is < 0 or > MaxDay || number is not { } v || v < 0 || v > max)
            {
                invalid++;
                continue;
            }

            result[day] = v;
        }

        return result;
    }

    private static List<VendorPricePayload> ReadVendorPrices(IReadOnlyDictionary<string, LuaValue> globals, List<string> warnings)
    {
        var result = new List<VendorPricePayload>();
        if (!globals.TryGetValue("AUCTIONATOR_VENDOR_PRICE_CACHE", out var root) || root.AsTable() is not { } cache) return result;
        foreach (var (key, value) in cache.Entries)
        {
            var itemKey = key.Kind == LuaKeyKind.String ? key.Text : key.AsInt64()?.ToString(CultureInfo.InvariantCulture);
            // Prix marchand à l'unité : prix de la pile divisé par sa taille, donc pas toujours entier.
            if (itemKey is null || !ItemKeyPattern().IsMatch(itemKey) || value.AsDouble() is not { } price || price <= 0 || price > MaxCopper) continue;
            if (result.Count == MaxVendorPrices)
            {
                warnings.Add($"Auctionator : plus de {MaxVendorPrices} prix marchands, les suivants sont ignorés.");
                break;
            }

            result.Add(new VendorPricePayload(itemKey, price));
        }

        result.Sort((a, b) => string.CompareOrdinal(a.Key, b.Key));
        return result;
    }

    /// <summary>Empreinte des relevés d'un hôtel des ventes, indépendante de leur forme dans le fichier (table ou CBOR).</summary>
    private static string ContentHash(IReadOnlyList<MarketItemPayload> items)
    {
        var text = new StringBuilder();
        foreach (var item in items)
        {
            text.Append(item.Key).Append('|').Append(item.LastMin?.ToString(CultureInfo.InvariantCulture)).Append('|');
            foreach (var day in item.Days)
                text.AppendJoin(',', day.Select(v => v?.ToString(CultureInfo.InvariantCulture) ?? "")).Append(';');
            text.Append('\n');
        }

        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(text.ToString())));
    }
}
