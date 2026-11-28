using System.Text;
using System.Text.Json;
using AltBoardSync.Core.Discovery;
using AltBoardSync.Core.Economy;
using AltBoardSync.Core.IO;
using AltBoardSync.Core.Lua;
using AltBoardSync.Core.Sync;

namespace AltBoardSync.Tests;

public class NaowhMarketReaderTests
{
    private const string House = "Royaume Fictif-Alliance";

    [Fact]
    public void Houses_are_read_with_their_last_scan_and_history()
    {
        var warnings = new List<string>();
        var houses = NaowhMarketReader.Read(Fixture.Parse("naowh-market-small.lua"), warnings);

        Assert.Equal(["6947-Blackwater", House], houses.Select(h => h.Key));
        var house = houses[1];
        Assert.Equal((1795817357L, 1795817357L, 1795839703L), (house.ScannedAt!.Value, house.MedianAt!.Value, house.RecordedAt!.Value));

        // 25 objets au plus bas prix, un objet à la seule médiane ; triés par objet.
        Assert.Equal(26, house.Items.Count);
        Assert.Equal(house.Items.Select(i => i[0]).Order(), house.Items.Select(i => i[0]));
        // [objet, plus bas, médiane (arrondie), annonces, revu à]
        Assert.Equal([101L, 101_000L, 111_100L, 4L, 1795820000L], house.Items[0]);
        // Revu à une date hors bornes : sans date.
        Assert.Equal([102L, 102_000L, 112_200L, 5L, null], house.Items[1]);
        // Sans médiane (le scan rapide n'en a pas donné).
        Assert.Equal([125L, 125_000L, null, 7L, null], house.Items.Single(i => i[0] == 125));
        // Médiane seule ; annonces non entières : inconnues.
        Assert.Equal([127L, null, 5_000L, null, null], house.Items.Single(i => i[0] == 127));

        // Jours en UTC, du plus ancien au plus récent ; chaînes des jours passés, tables du jour en cours.
        Assert.Equal(["2026-11-17", "2026-11-18", "2026-11-27"], house.Days.Select(d => d.Day));
        Assert.Equal([[101L, 1_000L, 3L], [102L, 2_000L, null], [103L, 3_100L, null]], house.Days[0].Items);
        Assert.Equal([[101L, 1_050L, 4L], [102L, 2_100L, null]], house.Days[2].Items);

        var history = houses[0];
        Assert.Null(history.ScannedAt);
        Assert.Empty(history.Items);
        Assert.Equal([101L, 900L, 1L], Assert.Single(Assert.Single(history.Days).Items));

        Assert.Equal(
            [
                "NaowhForever : 1 maisons de l'hôtel des ventes à la clé non reconnue, ignorées.",
                "NaowhForever : 2 prix de l'hôtel des ventes invalides, ignorés.",
                "NaowhForever : 1 jours d'historique des prix invalides, ignorés.",
                "NaowhForever : 2 prix de l'historique invalides, ignorés.",
            ],
            warnings);
    }

    [Theory]
    [InlineData("NaowhForeverDB = { [\"account\"] = { [\"profMakes\"] = { } } }")]
    [InlineData("NaowhForeverDB = { [\"account\"] = { [\"ahPrices\"] = { [\"R-Alliance\"] = { [\"prices\"] = { } } } } }")]
    [InlineData("NaowhForeverDB = { [\"profiles\"] = { } }")]
    public void A_file_without_prices_yields_nothing(string lua)
    {
        var warnings = new List<string>();

        Assert.Empty(NaowhMarketReader.Read(SavedVariablesParser.Parse(lua), warnings));
        Assert.Empty(warnings);
    }

    [Fact]
    public void Content_hash_changes_with_a_price_or_a_day_only()
    {
        var text = Encoding.UTF8.GetString(Fixture.Bytes("naowh-market-small.lua"));
        string Hash(string lua) => NaowhMarketReader.Read(SavedVariablesParser.Parse(lua), []).Single(h => h.Key == House).ContentHash;

        var original = Hash(text);
        // Les variantes à suffixe et l'heure de la dernière demande de scan ne sont pas transmises.
        Assert.Equal(original, Hash(text.Replace("= 52000,", "= 53000,").Replace("[\"requested\"] = 1795817347", "[\"requested\"] = 1795817999")));
        Assert.NotEqual(original, Hash(text.Replace("[101] = 101000,", "[101] = 101001,")));
        Assert.NotEqual(original, Hash(text.Replace("101:1010:4", "101:1011:4")));
    }

    [Fact]
    public void Only_the_most_recent_days_are_kept()
    {
        var days = string.Join(", ", Enumerable.Range(20_700, 40).Select(d => $"[{d}] = \",101:{d}:1,\""));
        var lua = $"NaowhForeverDB = {{ [\"account\"] = {{ [\"marketHistory\"] = {{ [\"R-Horde\"] = {{ [\"days\"] = {{ {days} }} }} }} }} }}";

        var house = NaowhMarketReader.Read(SavedVariablesParser.Parse(lua), []).Single();

        Assert.Equal(NaowhMarketReader.MaxDaysPerHouse, house.Days.Count);
        Assert.Equal(20_739L, house.Days[^1].Items.Single()[1]);
    }
}

public class NaowhFeedReaderTests
{
    [Fact]
    public void Feed_is_decoded_per_region_and_house()
    {
        var warnings = new List<string>();
        var feed = NaowhFeedReader.Read(Fixture.Bytes("naowh-feed-small.lua"), warnings)!;

        Assert.Equal(1795839703L, feed.Time);
        Assert.Equal([1, 3], feed.Regions.Keys);
        // La maison sans prix est sautée ; celle d'un camp inconnu est comptée invalide.
        Assert.Equal([(111, "Alliance"), (114, "Horde"), (117, "Blackwater")], feed.Regions[3].Select(h => (h.Id, h.Faction)));
        Assert.Equal("NaowhForever : Prices.lua : 1 régions ou maisons invalides, ignorées.", Assert.Single(warnings));

        var own = feed.Regions[3][0];
        Assert.Equal(25, own.Items.Count);
        // [objet, plus bas, médiane, annonces]
        Assert.Equal([101L, 101_000L, 101_500L, 2L], own.Items[0]);
        Assert.Equal([125L, 125_000L, 125_500L, 1L], own.Items[^1]);
        // Annonces inconnues, médiane connue ; écart d'objet de plusieurs unités ; grand prix sur plus de six chiffres.
        Assert.Equal([[101L, 400L, 450L, null], [150L, 1_000_000_000_000L, 1_100_000_000_000L, 2L]], feed.Regions[3][2].Items);
    }

    [Theory]
    [InlineData("2t:rs", new long[] { 101, 1000 })]
    [InlineData("2t:rs:5", new long[] { 101, 1000, 5 })]
    [InlineData("2t:rs:0:s0", new long[] { 101, 1000, 0, 1008 })]
    public void A_house_entry_has_optional_count_and_median(string prices, long[] expected)
    {
        var item = Assert.Single(NaowhFeedReader.Decode(prices)!);

        Assert.Equal(expected[0], item[0]);
        Assert.Equal(expected[1], item[1]);
        Assert.Equal(expected.Length > 3 ? expected[3] : (long?)null, item[2]);
        Assert.Equal(expected.Length > 2 ? expected[2] : (long?)null, item[3]);
    }

    [Theory]
    [InlineData("2t")]
    [InlineData("2t:0")]
    [InlineData("0:rs")]
    [InlineData("2t:RS")]
    [InlineData("2t:rs:5:0")]
    [InlineData("2t:rs:1:2:3")]
    [InlineData("zzzzzzzzzzzzz:1")]
    public void A_malformed_house_is_rejected(string prices) => Assert.Null(NaowhFeedReader.Decode(prices));

    [Fact]
    public void A_file_that_is_not_a_feed_is_reported()
    {
        var warnings = new List<string>();

        Assert.Null(NaowhFeedReader.Read("-- Prices.lua\nlocal ns = _G.NaowhForever\n"u8, warnings));
        Assert.Null(NaowhFeedReader.Read("local ns = _G.NaowhForever\nns.AuctionFeed = { regions = { } }\n"u8, warnings));
        Assert.Equal(["NaowhForever : Prices.lua ne contient pas ns.AuctionFeed, flux de prix non transmis.", "NaowhForever : Prices.lua d'un format inconnu, flux de prix non transmis."], warnings);
    }

    [Fact]
    public void Code_instead_of_a_table_literal_is_refused()
    {
        Assert.Throws<LuaParseException>(() => NaowhFeedReader.Read("ns.AuctionFeed = os.execute(\"x\")\n"u8, []));
    }

    [Fact]
    public void The_region_is_the_one_whose_house_matches_a_scan()
    {
        var feed = NaowhFeedReader.Read(Fixture.Bytes("naowh-feed-small.lua"), [])!;
        var houses = NaowhMarketReader.Read(Fixture.Parse("naowh-market-small.lua"), []);

        Assert.Equal(3, NaowhFeedReader.MatchRegion(feed, houses));
        // Sans scan, ou avec trop peu de prix concordants, la région reste inconnue.
        Assert.Null(NaowhFeedReader.MatchRegion(feed, []));
        var few = houses[1] with { Items = houses[1].Items.Take(NaowhFeedReader.MatchMin - 1).ToList() };
        Assert.Null(NaowhFeedReader.MatchRegion(feed, [few]));
    }
}

public class NaowhPayloadTests
{
    private static PayloadBuilder Builder() => new(new StableFileReader(new StableReadOptions { SettleDelay = TimeSpan.Zero }));

    private static string AddFeed(string flavor)
    {
        var folder = Directory.CreateDirectory(Path.Combine(flavor, "Interface", "AddOns", NaowhFeedReader.AddonFolder)).FullName;
        var path = Path.Combine(folder, NaowhFeedReader.FileName);
        File.Copy(Fixture.PathOf("naowh-feed-small.lua"), path);
        return path;
    }

    [Fact]
    public async Task Prices_are_attached_to_the_account_and_the_feed_follows_its_scans()
    {
        using var temp = new TempDirectory();
        var flavor = temp.Combine("_forever_");
        var folder = Path.GetDirectoryName(temp.AddAccount(flavor, "111111111#1", "account-four-characters.lua"))!;
        File.Copy(Fixture.PathOf("naowh-market-small.lua"), Path.Combine(folder, "NaowhForever.lua"));
        AddFeed(flavor);
        var builder = Builder();

        var result = await builder.ReadAccountAsync(AccountScanner.Scan(flavor).Single());

        var payload = result.Payload!;
        var market = payload.NaowhMarket!;
        Assert.Equal(Fixture.Bytes("naowh-market-small.lua").LongLength, market.File.Size);
        Assert.Equal(2, market.Houses.Count);
        // Aucune recette dans ce fichier, mais son empreinte compte : « watch » renvoie le compte s'il change.
        Assert.Null(payload.Recipes);
        Assert.Contains($":{market.File.Hash}:", result.Fingerprint);
        Assert.Equal(4, payload.Warnings.Count(w => w.StartsWith("NaowhForever :", StringComparison.Ordinal)));

        var read = (await builder.ReadNaowhFeedAsync("_forever_", flavor, null, PayloadBuilder.NaowhHouses([payload], "_forever_")))!;
        var feed = read.Payload!;
        Assert.Equal((3, 1795839703L, 3), (feed.Region, feed.Time, feed.Houses.Count));
        Assert.Equal(feed.File.Hash, read.FileHash);

        // Déjà envoyé : rien à relire. Sans scan de ce client : rien à envoyer, rien à retenir.
        var known = (await builder.ReadNaowhFeedAsync("_forever_", flavor, feed.File.Hash, market.Houses))!;
        Assert.Equal((feed.File.Hash, (NaowhFeedPayload?)null), (known.FileHash, known.Payload));
        var blind = (await builder.ReadNaowhFeedAsync("_forever_", flavor, null, PayloadBuilder.NaowhHouses([payload], "_classic_beta_")))!;
        Assert.Equal(((string?)null, (NaowhFeedPayload?)null), (blind.FileHash, blind.Payload));
        Assert.StartsWith("NaowhForever : flux de prix non transmis", blind.Notice);

        var document = PayloadBuilder.Build(new MachinePayload(Guid.Empty, "pc", null), [payload], "0.12.0", DateTimeOffset.UnixEpoch, null, [feed]);
        using var json = JsonDocument.Parse(JsonSerializer.Serialize(document, SyncJsonContext.Default.SyncPayload));
        var house = json.RootElement.GetProperty("accounts")[0].GetProperty("naowhMarket").GetProperty("houses")[1];
        Assert.Equal("Royaume Fictif-Alliance", house.GetProperty("key").GetString());
        Assert.Equal("[101,101000,111100,4,1795820000]", house.GetProperty("items")[0].GetRawText());
        Assert.Equal("[127,null,5000,null,null]", house.GetProperty("items")[25].GetRawText());
        Assert.Equal("""{"day":"2026-11-27","items":[[101,1050,4],[102,2100,null]]}""", house.GetProperty("days")[2].GetRawText());
        var sent = json.RootElement.GetProperty("naowhFeeds")[0];
        Assert.Equal("_forever_", sent.GetProperty("flavor").GetString());
        Assert.Equal("[101,400,450,null]", sent.GetProperty("houses")[2].GetProperty("items")[0].GetRawText());
    }

    [Fact]
    public async Task No_feed_without_the_addon_and_an_unreadable_feed_is_only_reported()
    {
        using var temp = new TempDirectory();
        var flavor = temp.Combine("_forever_");
        Directory.CreateDirectory(flavor);
        var builder = Builder();

        Assert.Null(await builder.ReadNaowhFeedAsync("_forever_", flavor, null, []));

        File.WriteAllText(AddFeed(flavor), "ns.AuctionFeed = { time = ");
        var read = (await builder.ReadNaowhFeedAsync("_forever_", flavor, null, []))!;
        Assert.Null(read.Payload);
        Assert.Null(read.FileHash);
        Assert.StartsWith("flux de prix de NaowhForever illisible", read.Error);
    }

    [Fact]
    public async Task An_unreadable_naowh_file_drops_recipes_and_prices_with_one_warning()
    {
        using var temp = new TempDirectory();
        var flavor = temp.Combine("_forever_");
        var folder = Path.GetDirectoryName(temp.AddAccount(flavor, "222222222#1", "account-two-characters.lua"))!;
        File.WriteAllText(Path.Combine(folder, "NaowhForever.lua"), "NaowhForeverDB = { [\"account\"] = ");

        var result = await Builder().ReadAccountAsync(AccountScanner.Scan(flavor).Single());

        Assert.True(result.Succeeded);
        Assert.Null(result.Payload!.NaowhMarket);
        Assert.Null(result.Payload.Recipes);
        Assert.Contains(result.Payload.Warnings, w => w.StartsWith("NaowhForever illisible, recettes et prix non transmis", StringComparison.Ordinal));
    }
}
