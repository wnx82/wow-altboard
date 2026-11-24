using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using AltBoardSync.Core.Lua;
using AltBoardSync.Core.Sync;

namespace AltBoardSync.Core.Economy;

/// <summary>
/// Ce que l'agent retient d'EZAuctioneer.lua : les relevés de chaque scan complet, par marché ; le
/// portefeuille de revente de chaque personnage ; les bonnes affaires du dernier scan de chaque marché.
/// </summary>
public sealed record EzAuctioneerData(
    int Schema,
    IReadOnlyList<ScanMarketPayload> Markets,
    IReadOnlyList<PortfolioPayload> Portfolios,
    IReadOnlyList<MarketDealsPayload> Deals);

/// <summary>
/// Lit les SavedVariables de l'addon EZAuctioneer (voir docs/EZAUCTIONEER-DATA-MODEL.md). Pour chaque
/// marché, l'addon garde les derniers scans de chaque objet : heure du scan (heure du serveur de jeu),
/// prix au 25e percentile pondéré par les unités en vente, unités en vente. Sont transmis ces relevés
/// et le résumé des scans, le portefeuille de chaque personnage (<c>portfolio</c> : bilan, positions,
/// annonces suivies, journal des opérations) et le classement des bonnes affaires de chaque marché
/// (<c>lastDeals</c>), sans les noms ni les liens d'objets. Les réglages ne sont jamais transmis.
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
    public const long MinTimestamp = PayloadLimits.MinTimestamp;
    public const long MaxTimestamp = PayloadLimits.MaxTimestamp;

    public const long MaxCopper = AuctionatorReader.MaxCopper;
    public const int MaxUnits = 1_000_000_000;

    public const int MaxPortfolios = 200;
    public const int MaxPositionsPerPortfolio = 500;
    public const int MaxAuctionsPerPortfolio = 500;

    /// <summary>L'addon en garde 200 par personnage (<c>Core.JOURNAL_LOG</c>) ; seules les plus récentes passent au-delà.</summary>
    public const int MaxLogEntriesPerPortfolio = 300;

    /// <summary>
    /// L'addon en garde 150 par marché après un scan (<c>KEEP_DEALS</c>) ; la surveillance en direct peut
    /// en ajouter. Seules les premières du classement passent au-delà.
    /// </summary>
    public const int MaxDealsPerMarket = 150;

    /// <summary>Opérations du journal connues du serveur.</summary>
    public static readonly IReadOnlySet<string> LogKinds = new HashSet<string>(StringComparer.Ordinal)
    {
        "buy", "post", "sale", "pending", "expire", "cancel", "unknown", "remove",
    };

    // Motifs alignés sur ceux du serveur (expressions JavaScript) : chiffres ASCII seulement, et \z
    // plutôt que $, qui accepterait un saut de ligne final.

    /// <summary>Clé d'historique : objet, puis suffixe aléatoire (« de l'Ours »), puis facteur quand le suffixe est négatif.</summary>
    [GeneratedRegex(@"^i:[0-9]{1,9}(:s-?[0-9]{1,9}(:f[0-9]{1,5})?)?\z", RegexOptions.CultureInvariant)]
    private static partial Regex ItemKeyPattern();

    /// <summary>
    /// Clé de marché : <c>région:royaume:faction:faction</c> (HV de faction) ou <c>région:royaume:neutral</c>
    /// (HV neutre). Le royaume est celui que rend le jeu (<c>GetRealmName</c>) : vide depuis le build 71037
    /// de WoW Forever (<c>3::Alliance:faction</c>), le site le déduit des personnages du compte.
    /// </summary>
    [GeneratedRegex(@"^([0-9]{1,4}|\?):[^\x00-\x1F]{0,80}:([^:\x00-\x1F]{1,40}:faction|neutral)\z", RegexOptions.CultureInvariant)]
    private static partial Regex MarketKeyPattern();

    [GeneratedRegex(@"^[a-z][a-z0-9_-]{0,19}\z", RegexOptions.CultureInvariant)]
    private static partial Regex OriginPattern();

    /// <summary>Clé de portefeuille : <c>région:royaume:personnage</c>, royaume vide quand l'addon ne le connaissait pas.</summary>
    [GeneratedRegex(@"^([0-9]{1,4}|\?):([^:\x00-\x1F]{0,80}):([^:\x00-\x1F]{1,40})\z", RegexOptions.CultureInvariant)]
    private static partial Regex PortfolioKeyPattern();

    private const int MaxPortfolioKey = 160;

    /// <summary>Origine d'un achat du journal (« achat », « manuel ») ou d'une bonne affaire (« scan », « history »…).</summary>
    [GeneratedRegex(@"^[\p{L}\p{N} _-]{1,20}\z", RegexOptions.CultureInvariant)]
    private static partial Regex SourcePattern();

    /// <summary>
    /// Lit les relevés, les portefeuilles et les bonnes affaires, ou null si le fichier n'en contient
    /// aucun d'exploitable (un avertissement explique un format inconnu).
    /// </summary>
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
        var deals = new List<MarketDealsPayload>();
        var invalidDeals = 0;
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
            if (deals.Count < MaxMarkets && ReadDeals(name, market, ref invalidDeals) is { } marketDeals) deals.Add(marketDeals);
        }

        if (invalidDeals > 0) warnings.Add($"EZAuctioneer : {invalidDeals} bonnes affaires invalides, ignorées.");
        markets.Sort((a, b) => string.CompareOrdinal(a.Key, b.Key));
        deals.Sort((a, b) => string.CompareOrdinal(a.Market, b.Market));
        var portfolios = ReadPortfolios(db.Get("portfolio")?.AsTable(), warnings);
        return markets.Count == 0 && portfolios.Count == 0 && deals.Count == 0 ? null : new EzAuctioneerData(version, markets, portfolios, deals);
    }

    /// <summary>
    /// Bonnes affaires du dernier scan du marché (<c>lastDeals</c>), dans l'ordre du classement, ou null
    /// s'il n'y en a aucune d'exploitable. Une entrée d'un type inconnu (ni <c>resale</c> ni <c>vendor</c>)
    /// est sautée sans avertissement : une version plus récente de l'addon peut en ajouter.
    /// </summary>
    private static MarketDealsPayload? ReadDeals(string name, LuaTable market, ref int invalid)
    {
        if (market.Get("lastDeals")?.AsTable() is not { Count: > 0 } table) return null;
        var entries = new List<DealPayload>();
        foreach (var (_, value) in table.Entries)
        {
            if (entries.Count == MaxDealsPerMarket) break;
            if (value.AsTable() is not { } deal)
            {
                invalid++;
                continue;
            }

            var kind = deal.Get("kind")?.AsString();
            if (kind is not ("resale" or "vendor")) continue;
            // Avant EZAuctioneer 0.4.2, le prix de revente était la référence.
            if (deal.Get("key")?.AsString() is not { } key || !ItemKeyPattern().IsMatch(key)
                || Positive(deal.Get("qty")) is not { } qty
                || Copper(deal.Get("cost")) is not { } cost
                || Copper(deal.Get("resale") ?? deal.Get("reference")) is not { } resale
                || SignedCopper(deal.Get("profit")) is not { } profit
                || deal.Get("roi")?.AsDouble() is not { } roi || roi < -1000 || roi > 1000)
            {
                invalid++;
                continue;
            }

            entries.Add(new DealPayload(
                key,
                kind,
                Source(deal.Get("source")),
                qty,
                cost,
                resale,
                profit,
                roi,
                Count(deal.Get("listings")),
                deal.Get("thin")?.AsBoolean(),
                // Autres états de l'addon (valid, changed, timeout…) : non transmis.
                deal.Get("liveStatus")?.AsString() is ("live" or "gone" or "checking") and var live ? live : null));
        }

        if (entries.Count == 0) return null;
        return new MarketDealsPayload(name, Time(market.Get("lastSummary")?.AsTable()?.Get("at")), entries);
    }

    /// <summary>Entrées écartées des portefeuilles, comptées par nature : un avertissement par nature.</summary>
    private sealed class PortfolioRejections
    {
        public int Keys, Stats, Positions, Auctions, Log, OverPositions, OverAuctions;

        public void Report(List<string> warnings)
        {
            if (Keys > 0) warnings.Add($"EZAuctioneer : {Keys} portefeuilles à la clé non reconnue, ignorés.");
            if (Stats > 0) warnings.Add($"EZAuctioneer : portefeuilles : {Stats} valeurs du bilan invalides, comptées à zéro.");
            if (Positions > 0) warnings.Add($"EZAuctioneer : portefeuilles : {Positions} positions invalides, ignorées.");
            if (Auctions > 0) warnings.Add($"EZAuctioneer : portefeuilles : {Auctions} annonces suivies invalides, ignorées.");
            if (Log > 0) warnings.Add($"EZAuctioneer : portefeuilles : {Log} opérations du journal invalides, ignorées.");
            if (OverPositions > 0) warnings.Add($"EZAuctioneer : {OverPositions} portefeuilles dépassent {MaxPositionsPerPortfolio} positions, les suivantes sont ignorées.");
            if (OverAuctions > 0) warnings.Add($"EZAuctioneer : {OverAuctions} portefeuilles dépassent {MaxAuctionsPerPortfolio} annonces suivies, les suivantes sont ignorées.");
        }
    }

    /// <summary>Portefeuilles non vides, triés par clé.</summary>
    private static List<PortfolioPayload> ReadPortfolios(LuaTable? table, List<string> warnings)
    {
        var portfolios = new List<PortfolioPayload>();
        var rejected = new PortfolioRejections();
        foreach (var (key, value) in table?.Entries ?? [])
        {
            if (key.Kind != LuaKeyKind.String || key.Text is not { Length: <= MaxPortfolioKey } name || !PortfolioKeyPattern().IsMatch(name) || value.AsTable() is not { } journal)
            {
                rejected.Keys++;
                continue;
            }

            if (portfolios.Count == MaxPortfolios)
            {
                warnings.Add($"EZAuctioneer : plus de {MaxPortfolios} portefeuilles, les suivants sont ignorés.");
                break;
            }

            if (ReadPortfolio(name, journal, rejected) is { } portfolio) portfolios.Add(portfolio);
        }

        rejected.Report(warnings);
        portfolios.Sort((a, b) => string.CompareOrdinal(a.Key, b.Key));
        return portfolios;
    }

    /// <summary>
    /// Un portefeuille (<c>Core.Journal</c> de l'addon), ou null s'il est entièrement vide : ni position,
    /// ni annonce suivie, ni opération, bilan à zéro. Une valeur absente du bilan vaut zéro.
    /// </summary>
    private static PortfolioPayload? ReadPortfolio(string name, LuaTable journal, PortfolioRejections rejected)
    {
        var table = journal.Get("stats")?.AsTable();
        long Stat(string field, Func<LuaValue?, long?> read)
        {
            if (table?.Get(field) is not { } value) return 0;
            if (read(value) is { } amount) return amount;
            rejected.Stats++;
            return 0;
        }

        var stats = new PortfolioStatsPayload(
            Stat("realized", SignedCopper),
            Stat("sales", Count),
            Stat("cuts", Copper),
            Stat("expired", Count),
            Stat("depositsLost", Copper),
            Stat("unknown", Count));

        var positions = new List<PortfolioPositionPayload>();
        foreach (var (key, value) in journal.Get("positions")?.AsTable()?.Entries ?? [])
        {
            var position = value.AsTable();
            // L'addon ouvre chaque position avec listed = 0 : absent, rien n'est en vente.
            var listed = position?.Get("listed") is { } listedValue ? Count(listedValue) : 0;
            if (key.Kind != LuaKeyKind.String || key.Text is not { } itemKey || !ItemKeyPattern().IsMatch(itemKey) || position is null
                || Count(position.Get("qty")) is not { } qty || Copper(position.Get("cost")) is not { } cost || listed is null)
            {
                rejected.Positions++;
                continue;
            }

            positions.Add(new PortfolioPositionPayload(itemKey, qty, cost, listed.Value, Time(position.Get("opened"))));
        }

        positions.Sort((a, b) => string.CompareOrdinal(a.Key, b.Key));
        if (positions.Count > MaxPositionsPerPortfolio)
        {
            positions.RemoveRange(MaxPositionsPerPortfolio, positions.Count - MaxPositionsPerPortfolio);
            rejected.OverPositions++;
        }

        var auctions = new List<PortfolioAuctionPayload>();
        var auctionIds = new HashSet<long>();
        foreach (var (key, value) in journal.Get("auctions")?.AsTable()?.Entries ?? [])
        {
            var auction = value.AsTable();
            // L'identifiant d'enchère du jeu est la clé : numérique, ou chaîne si le client l'a écrite
            // ainsi. [99] et ["99"] sont deux clés Lua mais une seule annonce : le serveur refuse le double.
            var id = key.AsInt64() ?? (key.Kind == LuaKeyKind.String && long.TryParse(key.Text, NumberStyles.None, CultureInfo.InvariantCulture, out var parsed) ? parsed : null);
            if (id is not (>= 1 and <= PayloadLimits.MaxSafeInteger) || auction is null
                || auction.Get("key")?.AsString() is not { } itemKey || !ItemKeyPattern().IsMatch(itemKey)
                || Positive(auction.Get("qty")) is not { } qty || Copper(auction.Get("unit")) is not { } unit
                || !auctionIds.Add(id.Value))
            {
                rejected.Auctions++;
                continue;
            }

            var market = auction.Get("market")?.AsString();
            auctions.Add(new PortfolioAuctionPayload(
                id.Value,
                itemKey,
                qty,
                unit,
                Copper(auction.Get("deposit")),
                auction.Get("cut")?.AsDouble() is >= 0 and <= 1 and var cut ? cut : null,
                market is { Length: <= 120 } && MarketKeyPattern().IsMatch(market) ? market : null,
                Time(auction.Get("at"))));
        }

        auctions.Sort((a, b) => a.Id.CompareTo(b.Id));
        if (auctions.Count > MaxAuctionsPerPortfolio)
        {
            auctions.RemoveRange(MaxAuctionsPerPortfolio, auctions.Count - MaxAuctionsPerPortfolio);
            rejected.OverAuctions++;
        }

        var log = new List<PortfolioLogEntryPayload>();
        foreach (var (_, value) in journal.Get("log")?.AsTable()?.Entries ?? [])
        {
            var entry = value.AsTable();
            if (entry is null || Time(entry.Get("t")) is not { } at
                || entry.Get("kind")?.AsString() is not { } kind || !LogKinds.Contains(kind)
                || entry.Get("key")?.AsString() is not { } itemKey || !ItemKeyPattern().IsMatch(itemKey)
                || Count(entry.Get("qty")) is not { } qty)
            {
                rejected.Log++;
                continue;
            }

            log.Add(new PortfolioLogEntryPayload(
                at,
                kind,
                itemKey,
                qty,
                Copper(entry.Get("amount")),
                Copper(entry.Get("fee")),
                SignedCopper(entry.Get("gain")),
                Copper(entry.Get("unit")),
                Copper(entry.Get("deposit")),
                Source(entry.Get("source"))));
        }

        // Ordre chronologique ; à heure égale, l'ordre du fichier (OrderBy est stable).
        var ordered = log.OrderBy(entry => entry.At).TakeLast(MaxLogEntriesPerPortfolio).ToList();

        var empty = stats is { Realized: 0, Sales: 0, Cuts: 0, Expired: 0, DepositsLost: 0, Unknown: 0 };
        if (empty && positions.Count == 0 && auctions.Count == 0 && ordered.Count == 0) return null;
        return new PortfolioPayload(name, stats, positions, auctions, ordered);
    }

    /// <summary>Nombre entier positif ou nul, sur 32 bits comme les compteurs du serveur.</summary>
    private static long? Count(LuaValue? value) => value?.AsInt32() is >= 0 and var count ? count : null;

    /// <summary>Nombre entier strictement positif, sur 32 bits.</summary>
    private static long? Positive(LuaValue? value) => value?.AsInt32() is >= 1 and var count ? count : null;

    private static long? Copper(LuaValue? value) => PayloadLimits.Copper(value?.AsDouble(), 0, PayloadLimits.MaxCopper);

    /// <summary>Gain ou perte, en pièces de cuivre.</summary>
    private static long? SignedCopper(LuaValue? value) => PayloadLimits.Copper(value?.AsDouble(), -PayloadLimits.MaxCopper, PayloadLimits.MaxCopper);

    private static long? Time(LuaValue? value) => PayloadLimits.Timestamp(value?.AsInt64());

    private static string? Source(LuaValue? value) => value?.AsString() is { } source && SourcePattern().IsMatch(source) ? source : null;

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
