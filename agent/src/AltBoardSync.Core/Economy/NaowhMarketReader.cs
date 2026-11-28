using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using AltBoardSync.Core.Lua;
using AltBoardSync.Core.Sync;

namespace AltBoardSync.Core.Economy;

/// <summary>
/// Lit les prix de l'hôtel des ventes que NaowhForever (modules Auction Prices et The Market) garde
/// dans <c>NaowhForeverDB.account</c> (voir docs/NAOWH-MARKET-DATA-MODEL.md) :
/// <list type="bullet">
/// <item><c>ahPrices[maison]</c> : dernier scan de chaque objet, plus bas prix d'achat immédiat
/// (<c>prices</c>, daté par <c>time</c>, ou par <c>seen</c> quand l'objet a été revu depuis),
/// médiane pondérée par la quantité (<c>medians</c>, datée par <c>medianTime</c>) et nombre
/// d'annonces (<c>listed</c>) ;</item>
/// <item><c>marketHistory[maison]</c> : médiane et nombre d'annonces par jour (14 jours dans l'addon),
/// une chaîne <c>,objet:prix:annonces,</c> par jour passé, deux tables pour le jour en cours.</item>
/// </list>
/// Les prix par variante à suffixe aléatoire (<c>suffixes</c>) sont rangés sous le nom traduit de la
/// variante, sans son identifiant : ils ne sont pas transmis. Rien n'est calculé ici.
/// </summary>
public static partial class NaowhMarketReader
{
    public const int MaxHouses = 20;

    /// <summary>L'addon relève environ 7 500 objets par maison ; la marge couvre un hôtel des ventes plus fourni.</summary>
    public const int MaxItemsPerHouse = 30_000;

    /// <summary>L'addon garde 14 jours (<c>HISTORY_DAYS</c>) ; seuls les plus récents passent au-delà.</summary>
    public const int MaxDaysPerHouse = 31;

    public const int MaxListed = 1_000_000_000;

    private const long SecondsPerDay = 86_400;

    /// <summary>Clé d'une maison : royaume (ou numéro de serveur quand le jeu n'en donne pas), tiret, camp.</summary>
    [GeneratedRegex(@"^([^\x00-\x1F]{1,80})-(Alliance|Horde|Blackwater)\z", RegexOptions.CultureInvariant)]
    private static partial Regex HouseKeyPattern();

    /// <summary>Une entrée d'un jour passé : <c>objet:prix</c> ou <c>objet:prix:annonces</c> (prix arrondi par l'addon).</summary>
    [GeneratedRegex(@"^([0-9]{1,10}):([0-9]{1,16})(?::([0-9]{0,10}))?\z", RegexOptions.CultureInvariant)]
    private static partial Regex DayEntryPattern();

    /// <summary>Maisons relevées, triées par clé ; liste vide si l'addon n'en a aucune.</summary>
    public static IReadOnlyList<NaowhHousePayload> Read(IReadOnlyDictionary<string, LuaValue> globals, List<string> warnings)
    {
        if (!globals.TryGetValue("NaowhForeverDB", out var root) || root.AsTable()?.Get("account")?.AsTable() is not { } account) return [];
        var prices = account.Get("ahPrices")?.AsTable();
        var history = account.Get("marketHistory")?.AsTable();
        if (prices is null && history is null) return [];

        var keys = new SortedSet<string>(StringComparer.Ordinal);
        var badKeys = 0;
        foreach (var table in new[] { prices, history })
        {
            foreach (var (key, value) in table?.Entries ?? [])
            {
                if (key.Kind == LuaKeyKind.String && key.Text is { Length: <= 120 } name && HouseKeyPattern().IsMatch(name) && value.AsTable() is not null) keys.Add(name);
                else badKeys++;
            }
        }

        if (badKeys > 0) warnings.Add($"NaowhForever : {badKeys} maisons de l'hôtel des ventes à la clé non reconnue, ignorées.");

        var houses = new List<NaowhHousePayload>();
        var rejected = new Rejections();
        foreach (var key in keys)
        {
            if (houses.Count == MaxHouses)
            {
                warnings.Add($"NaowhForever : plus de {MaxHouses} maisons de l'hôtel des ventes, les suivantes sont ignorées.");
                break;
            }

            var house = ReadHouse(key, prices?.Get(key)?.AsTable(), history?.Get(key)?.AsTable(), rejected, warnings);
            if (house is not null) houses.Add(house);
        }

        rejected.Report(warnings);
        return houses;
    }

    /// <summary>Entrées écartées, comptées par nature : un avertissement par nature.</summary>
    private sealed class Rejections
    {
        public int Prices, Days, DayEntries;

        public void Report(List<string> warnings)
        {
            if (Prices > 0) warnings.Add($"NaowhForever : {Prices} prix de l'hôtel des ventes invalides, ignorés.");
            if (Days > 0) warnings.Add($"NaowhForever : {Days} jours d'historique des prix invalides, ignorés.");
            if (DayEntries > 0) warnings.Add($"NaowhForever : {DayEntries} prix de l'historique invalides, ignorés.");
        }
    }

    private static NaowhHousePayload? ReadHouse(string key, LuaTable? scan, LuaTable? history, Rejections rejected, List<string> warnings)
    {
        var items = ReadItems(key, scan, rejected, warnings);
        var days = ReadDays(history, rejected);
        if (items.Count == 0 && days.Count == 0) return null;

        var scannedAt = PayloadLimits.Timestamp(scan?.Get("time")?.AsInt64());
        var medianAt = PayloadLimits.Timestamp(scan?.Get("medianTime")?.AsInt64());
        var recordedAt = PayloadLimits.Timestamp(history?.Get("at")?.AsInt64());
        return new NaowhHousePayload(key, ContentHash(scannedAt, medianAt, recordedAt, items, days), scannedAt, medianAt, recordedAt, items, days);
    }

    /// <summary>
    /// Un tableau <c>[objet, plus bas, médiane, annonces, revu à]</c> par objet, trié par objet. Un objet
    /// a au moins un prix ; une médiane, des annonces ou une date absentes valent null.
    /// </summary>
    private static List<long?[]> ReadItems(string key, LuaTable? scan, Rejections rejected, List<string> warnings)
    {
        var items = new List<long?[]>();
        if (scan is null) return items;
        var lows = Numbers(scan.Get("prices")?.AsTable(), ref rejected.Prices);
        var medians = Numbers(scan.Get("medians")?.AsTable(), ref rejected.Prices);
        var listed = Numbers(scan.Get("listed")?.AsTable(), ref rejected.Prices);
        var seen = Numbers(scan.Get("seen")?.AsTable(), ref rejected.Prices);

        foreach (var id in lows.Keys.Union(medians.Keys).Order())
        {
            if (items.Count == MaxItemsPerHouse)
            {
                warnings.Add($"NaowhForever : « {key} » dépasse {MaxItemsPerHouse} objets, les suivants sont ignorés.");
                break;
            }

            var low = Copper(lows.GetValueOrDefault(id));
            var median = Copper(medians.GetValueOrDefault(id));
            if (low is null && median is null)
            {
                rejected.Prices++;
                continue;
            }

            var count = listed.TryGetValue(id, out var raw) ? Listed(raw) : null;
            var seenAt = seen.TryGetValue(id, out var at) ? PayloadLimits.Timestamp((long)Math.Round(at, MidpointRounding.AwayFromZero)) : null;
            items.Add([id, low, median, count, seenAt]);
        }

        return items;
    }

    /// <summary>Valeurs numériques d'une table indexée par objet ; une clé ou une valeur invalide est comptée.</summary>
    private static Dictionary<long, double> Numbers(LuaTable? table, ref int invalid)
    {
        var result = new Dictionary<long, double>();
        foreach (var (key, value) in table?.Entries ?? [])
        {
            if (key.AsInt64() is not (>= 1 and <= int.MaxValue) || value.AsDouble() is not { } number)
            {
                invalid++;
                continue;
            }

            result[key.AsInt64()!.Value] = number;
        }

        return result;
    }

    /// <summary>
    /// Jours d'historique, du plus ancien au plus récent : jour (UTC, comme l'addon, qui compte les
    /// jours depuis 1970 à l'heure du serveur), puis un tableau <c>[objet, médiane, annonces]</c> par objet.
    /// </summary>
    private static List<NaowhDayPayload> ReadDays(LuaTable? history, Rejections rejected)
    {
        var days = new SortedDictionary<long, List<long?[]>>();
        if (history?.Get("days")?.AsTable() is not { } table) return [];
        var listedByDay = history.Get("listed")?.AsTable();
        foreach (var (key, value) in table.Entries)
        {
            if (key.AsInt64() is not { } day || PayloadLimits.Timestamp(day * SecondsPerDay) is null)
            {
                rejected.Days++;
                continue;
            }

            // Jour passé : une chaîne ; jour en cours : une table de prix, les annonces dans « listed ».
            var entries = value.AsString() is { } packed
                ? Unpack(packed, ref rejected.DayEntries)
                : value.AsTable() is { } prices
                    ? Unpacked(prices, listedByDay?.Get(day)?.AsTable(), ref rejected.DayEntries)
                    : null;
            if (entries is null)
            {
                rejected.Days++;
                continue;
            }

            if (entries.Count > 0) days[day] = entries;
        }

        return days
            .TakeLast(MaxDaysPerHouse)
            .Select(pair => new NaowhDayPayload(DateOnly.FromDayNumber(DateOnly.FromDateTime(DateTime.UnixEpoch).DayNumber + (int)pair.Key).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), pair.Value))
            .ToList();
    }

    /// <summary>Chaîne d'un jour passé (<c>,objet:prix,objet:prix:annonces,</c>), triée par objet ; un objet en double garde sa première entrée.</summary>
    private static List<long?[]> Unpack(string packed, ref int invalid)
    {
        var byItem = new SortedDictionary<long, long?[]>();
        foreach (var part in packed.Split(',', StringSplitOptions.RemoveEmptyEntries))
        {
            var match = DayEntryPattern().Match(part);
            if (!match.Success
                || !long.TryParse(match.Groups[1].ValueSpan, NumberStyles.None, CultureInfo.InvariantCulture, out var id) || id is < 1 or > int.MaxValue
                || !long.TryParse(match.Groups[2].ValueSpan, NumberStyles.None, CultureInfo.InvariantCulture, out var price) || Copper(price) is not { } median)
            {
                invalid++;
                continue;
            }

            long? listed = null;
            if (match.Groups[3].Success && match.Groups[3].Length > 0)
            {
                listed = long.TryParse(match.Groups[3].ValueSpan, NumberStyles.None, CultureInfo.InvariantCulture, out var count) ? Listed(count) : null;
            }

            byItem.TryAdd(id, [id, median, listed]);
        }

        return [.. byItem.Values];
    }

    /// <summary>Jour en cours, tables de l'addon : prix par objet, annonces par objet.</summary>
    private static List<long?[]> Unpacked(LuaTable prices, LuaTable? listed, ref int invalid)
    {
        var counts = Numbers(listed, ref invalid);
        var result = new List<long?[]>();
        foreach (var (id, price) in Numbers(prices, ref invalid).OrderBy(pair => pair.Key))
        {
            if (Copper(price) is not { } median)
            {
                invalid++;
                continue;
            }

            result.Add([id, median, counts.TryGetValue(id, out var count) ? Listed(count) : null]);
        }

        return result;
    }

    /// <summary>Prix à l'unité, arrondi à la pièce de cuivre ; null s'il est nul, négatif ou hors bornes.</summary>
    private static long? Copper(double? value) => value is > 0 ? PayloadLimits.Copper(value, 1, PayloadLimits.MaxCopper) : null;

    private static long? Listed(double value) => value is >= 0 and <= MaxListed && value == Math.Floor(value) ? (long)value : null;

    /// <summary>Empreinte d'une maison : ne change que si un prix, un jour ou une date change.</summary>
    private static string ContentHash(long? scannedAt, long? medianAt, long? recordedAt, IReadOnlyList<long?[]> items, IReadOnlyList<NaowhDayPayload> days)
    {
        var text = new StringBuilder();
        text.Append(CultureInfo.InvariantCulture, $"{scannedAt},{medianAt},{recordedAt}\n");
        foreach (var item in items) text.AppendJoin(',', item).Append(';');
        text.Append('\n');
        foreach (var day in days)
        {
            text.Append(day.Day).Append('|');
            foreach (var item in day.Items) text.AppendJoin(',', item).Append(';');
            text.Append('\n');
        }

        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(text.ToString())));
    }
}
