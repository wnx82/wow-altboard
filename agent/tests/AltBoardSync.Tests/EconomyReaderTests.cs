using System.Text;
using System.Text.Json;
using AltBoardSync.Core.Discovery;
using AltBoardSync.Core.Economy;
using AltBoardSync.Core.IO;
using AltBoardSync.Core.Lua;
using AltBoardSync.Core.Sync;

namespace AltBoardSync.Tests;

public class CborDecoderTests
{
    private static LuaValue? Decode(params byte[] bytes) => CborDecoder.Decode(bytes);

    [Fact]
    public void Scalars_are_decoded()
    {
        Assert.Equal(10L, Decode(0x0A)!.AsInt64());
        Assert.Equal(500L, Decode(0x19, 0x01, 0xF4)!.AsInt64());
        Assert.Equal(100_000L, Decode(0x1A, 0x00, 0x01, 0x86, 0xA0)!.AsInt64());
        Assert.Equal(-1L, Decode(0x20)!.AsInt64());
        Assert.Equal(1.5, Decode(0xF9, 0x3E, 0x00)!.AsDouble());
        Assert.Equal(1.1, Decode(0xFB, 0x3F, 0xF1, 0x99, 0x99, 0x99, 0x99, 0x99, 0x9A)!.AsDouble());
        Assert.True(Decode(0xF5)!.AsBoolean());
        Assert.Null(Decode(0xF6));
    }

    [Fact]
    public void Byte_and_text_strings_are_both_strings()
    {
        // Le client écrit les chaînes Lua en chaînes d'octets (type 2).
        Assert.Equal("ab", Decode(0x42, (byte)'a', (byte)'b')!.AsString());
        Assert.Equal("é", Decode(0x62, 0xC3, 0xA9)!.AsString());
    }

    [Fact]
    public void Maps_and_arrays_become_lua_tables()
    {
        // { "m": 8, "h": { "2480": 9 }, "l": [] }
        var value = Decode(0xA3, 0x41, (byte)'m', 0x08, 0x41, (byte)'h', 0xA1, 0x44, (byte)'2', (byte)'4', (byte)'8', (byte)'0', 0x09, 0x41, (byte)'l', 0x80)!.AsTable()!;

        Assert.Equal(8L, value.Get("m")!.AsInt64());
        Assert.Equal(9L, value.Get("h")!.AsTable()!.Get("2480")!.AsInt64());
        Assert.Equal(0, value.Get("l")!.AsTable()!.Count);

        var array = Decode(0x82, 0x01, 0x02)!.AsTable()!;
        Assert.Equal(new long[] { 1, 2 }, new[] { array.Get(1)!.AsInt64()!.Value, array.Get(2)!.AsInt64()!.Value });
    }

    [Theory]
    [InlineData(new byte[] { 0x19, 0x01 }, "fin de données")]
    [InlineData(new byte[] { 0x5A, 0xFF, 0xFF, 0xFF, 0xFF }, "longueur annoncée")]
    [InlineData(new byte[] { 0x9F, 0xFF }, "indéfinie")]
    [InlineData(new byte[] { 0x01, 0x02 }, "en trop")]
    [InlineData(new byte[] { 0xA1, 0x80, 0x01 }, "clé de table")]
    public void Malformed_documents_are_rejected(byte[] bytes, string expected)
    {
        var error = Assert.Throws<CborFormatException>(() => CborDecoder.Decode(bytes));
        Assert.Contains(expected, error.Message);
    }

    [Fact]
    public void Nesting_is_bounded()
    {
        var bytes = Enumerable.Repeat((byte)0x81, CborDecoder.MaxDepth + 2).Append((byte)0x01).ToArray();

        Assert.Contains("profonde", Assert.Throws<CborFormatException>(() => CborDecoder.Decode(bytes)).Message);
    }
}

public class AuctionatorReaderTests
{
    private static AuctionatorData? Read(string file, List<string>? warnings = null) =>
        AuctionatorReader.Read(SavedVariablesParser.ParseBinary(Fixture.Bytes(file)), warnings ?? []);

    [Fact]
    public void Binary_strings_keep_every_byte()
    {
        var globals = SavedVariablesParser.ParseBinary("X = \"a\\000\\n\\r\\\"\\\\ÿ\""u8.ToArray().Concat(new byte[] { 0x0D, 0x0A }).ToArray());

        Assert.Equal(new byte[] { 0x61, 0x00, 0x0A, 0x0D, 0x22, 0x5C, 0xC3, 0xBF }, Encoding.Latin1.GetBytes(globals["X"].AsString()!));
    }

    [Fact]
    public void Real_file_with_a_serialized_market_is_read()
    {
        var warnings = new List<string>();
        var data = Read("auctionator-small.lua", warnings)!;

        Assert.Empty(warnings);
        Assert.Equal(8, data.DbVersion);
        var market = Assert.Single(data.Markets);
        Assert.Equal("PvE", market.Key);
        Assert.Equal(8, market.Items.Count);
        // Un seul jour de relevés dans ce fichier : le 2026-11-05 (jour Auctionator 2500).
        Assert.All(market.Items, item => Assert.Equal(2500, Assert.Single(item.Days)[0]));
        Assert.Equal(12, data.VendorPrices.Count);
        Assert.Matches("^[0-9a-f]{64}$", market.ContentHash);
    }

    [Fact]
    public void Daily_low_high_and_quantity_follow_auctionator_semantics()
    {
        var market = Read("auctionator-multi-day.lua")!.Markets.Single();
        var item = market.Items.Single(i => i.Key == "2576");

        Assert.Equal(100L, item.LastMin);
        // Relevés réels : h = plus haut des prix minimums du jour ; l n'existe que s'il diffère de h ; a = quantité.
        long[][] expected =
        [
            [2481, 2500, 2500, 2],
            [2482, 300, 500, 76],
            [2483, 200, 200, 45],
            [2486, 700, 700, 1],
            [2500, 200, 1000, 34],
            [2501, 100, 100, 13],
        ];
        Assert.Equal(expected, item.Days.Select(d => d.Select(v => v!.Value).ToArray()));
        Assert.Equal(40, market.Items.Count);
        Assert.Equal(market.Items.Select(i => i.Key).Order(StringComparer.Ordinal), market.Items.Select(i => i.Key));
    }

    [Fact]
    public void Plain_table_and_serialized_forms_give_the_same_result()
    {
        const string table = """
            AUCTIONATOR_PRICE_DATABASE = {
            ["__dbversion"] = 8,
            ["PvE"] = { ["version"] = 2, ["2576"] = { ["m"] = 100, ["h"] = { ["2482"] = 500 }, ["l"] = { ["2482"] = 300 }, ["a"] = { ["2482"] = 76 } } },
            }
            """;
        // Même objet, en CBOR : { "2576": { "m": 100, "h": { "2482": 500 }, "l": { "2482": 300 }, "a": { "2482": 76 } }, "version": 2 }
        byte[] cbor =
        [
            0xA2, 0x44, .. "2576"u8, 0xA4,
            0x41, (byte)'m', 0x18, 0x64,
            0x41, (byte)'h', 0xA1, 0x44, .. "2482"u8, 0x19, 0x01, 0xF4,
            0x41, (byte)'l', 0xA1, 0x44, .. "2482"u8, 0x19, 0x01, 0x2C,
            0x41, (byte)'a', 0xA1, 0x44, .. "2482"u8, 0x18, 0x4C,
            0x47, .. "version"u8, 0x02,
        ];
        var serialized = Encoding.Latin1.GetBytes("AUCTIONATOR_PRICE_DATABASE = { [\"__dbversion\"] = 8, [\"PvE\"] = \"" + Encoding.Latin1.GetString(cbor) + "\" }");

        var fromTable = AuctionatorReader.Read(SavedVariablesParser.ParseBinary(Encoding.UTF8.GetBytes(table)), [])!.Markets.Single();
        var fromCbor = AuctionatorReader.Read(SavedVariablesParser.ParseBinary(serialized), [])!.Markets.Single();

        Assert.Equal(fromTable.ContentHash, fromCbor.ContentHash);
        Assert.Equal(new long[] { 2482, 300, 500, 76 }, fromCbor.Items.Single().Days.Single().Select(v => v!.Value));
    }

    [Fact]
    public void Unknown_database_version_is_skipped_with_a_warning()
    {
        var warnings = new List<string>();

        var data = AuctionatorReader.Read(SavedVariablesParser.ParseBinary("AUCTIONATOR_PRICE_DATABASE = { [\"__dbversion\"] = 7 }"u8), warnings);

        Assert.Null(data);
        Assert.Contains("version de base 7", Assert.Single(warnings));
    }

    [Fact]
    public void Suffix_variant_keys_are_skipped_without_warning()
    {
        // WoW Forever, Auctionator 352 : chaque enchère d'une variante est rangée sous « gr: » ET sous la
        // clé simple, qui garde le plus bas prix de toutes les variantes.
        const string lua = """
            AUCTIONATOR_PRICE_DATABASE = {
            ["__dbversion"] = 8,
            ["PvE Alliance"] = {
            ["15502"] = { ["m"] = 900, ["h"] = { ["2520"] = 900 } },
            ["gr:15502:of the Monkey"] = { ["m"] = 1500, ["h"] = { ["2520"] = 1500 } },
            ["gr:15502:of Nature Protection"] = { ["m"] = 900, ["h"] = { ["2520"] = 900 } },
            },
            }
            """;
        var warnings = new List<string>();

        var data = AuctionatorReader.Read(SavedVariablesParser.ParseBinary(Encoding.UTF8.GetBytes(lua)), warnings)!;

        Assert.Equal(["15502"], data.Markets.Single().Items.Select(i => i.Key));
        Assert.Empty(warnings);
    }

    [Fact]
    public void Invalid_keys_and_values_are_ignored_and_counted()
    {
        const string lua = """
            AUCTIONATOR_PRICE_DATABASE = {
            ["__dbversion"] = 8,
            ["PvE"] = {
            ["nom d'objet"] = { ["m"] = 5, ["h"] = { ["2482"] = 5 } },
            ["g:1234:60"] = { ["m"] = 5, ["h"] = { ["2482"] = 5, ["demain"] = 4 }, ["a"] = { ["2482"] = -3 } },
            ["99"] = { ["m"] = 0, ["a"] = { ["2482"] = 4 } },
            },
            ["Corrompu"] = "\255\255",
            }
            AUCTIONATOR_VENDOR_PRICE_CACHE = { ["2880"] = 33.333333333333336, ["x"] = 4, ["159"] = 0 }
            """;
        var warnings = new List<string>();

        var data = AuctionatorReader.Read(SavedVariablesParser.ParseBinary(Encoding.UTF8.GetBytes(lua)), warnings)!;

        var item = data.Markets.Single().Items.Single();
        Assert.Equal("g:1234:60", item.Key);
        // Quantité négative rejetée : le jour reste, sans quantité.
        Assert.Equal(new long?[] { 2482, 5, 5, null }, item.Days.Single());
        Assert.Contains(warnings, w => w.Contains("1 clés d'objet non reconnues"));
        Assert.Contains(warnings, w => w.Contains("2 relevés journaliers invalides"));
        Assert.Contains(warnings, w => w.Contains("« Corrompu » illisible"));
        Assert.Equal([new VendorPricePayload("2880", 33.333333333333336)], data.VendorPrices);
    }
}

public class EzAuctioneerReaderTests
{
    private static EzAuctioneerData? Read(string lua, List<string>? warnings = null) =>
        EzAuctioneerReader.Read(SavedVariablesParser.Parse(lua), warnings ?? []);

    [Fact]
    public void Scan_samples_are_read_per_market()
    {
        var warnings = new List<string>();
        var data = EzAuctioneerReader.Read(Fixture.Parse("ezauctioneer-small.lua"), warnings)!;

        Assert.Equal(5, data.Schema);
        // Le marché neutre, sans historique, n'est pas transmis.
        var market = Assert.Single(data.Markets);
        Assert.Equal("3:Royaume Test PvE:Alliance:faction", market.Key);
        Assert.Equal(["i:13133", "i:2589", "i:4306:s1019"], market.Items.Select(i => i.Key));
        // Relevés remis dans l'ordre chronologique : [heure, prix p25, unités].
        long[][] linen = [[1794915321, 10, 1200], [1795009157, 12, 840], [1795079141, 15, 610]];
        Assert.Equal(linen, market.Items.Single(i => i.Key == "i:2589").Samples);
        Assert.Equal([[1795079141L, 149900, 1]], market.Items.Single(i => i.Key == "i:13133").Samples);
        Assert.Matches("^[0-9a-f]{64}$", market.ContentHash);
        Assert.Contains(warnings, w => w.Contains("1 clés d'objet non reconnues"));
        Assert.Contains(warnings, w => w.Contains("1 relevés invalides"));
        Assert.Equal(2, warnings.Count);
    }

    [Fact]
    public void Successful_scans_are_reported_once_each()
    {
        var market = EzAuctioneerReader.Read(Fixture.Parse("ezauctioneer-small.lua"), [])!.Markets.Single();

        // Le résumé (à 1795079141) et le rapport (à 1795079142) du même scan n'en font qu'un ; le scan rejeté n'est pas repris.
        Assert.Equal(
            [new ScanPayload(1795009158, 241312, 5981, "external"), new ScanPayload(1795079141, 174284, 6744, "own")],
            market.Scans);
    }

    [Theory]
    [InlineData(3)]
    [InlineData(4)]
    public void Earlier_schemas_with_the_same_history_format_are_read(int schema)
    {
        var data = Read(MinimalFile(schema, "{ [\"ts\"] = 1795079141, [\"p\"] = 5, [\"units\"] = 2 }"));

        Assert.Equal(schema, data!.Schema);
        Assert.Equal([[1795079141L, 5, 2]], data.Markets.Single().Items.Single().Samples);
    }

    [Theory]
    [InlineData("2", "2")]
    [InlineData("6", "6")]
    [InlineData("nil", "inconnue")]
    public void Unknown_schema_is_skipped_with_a_warning(string schema, string shown)
    {
        var warnings = new List<string>();

        Assert.Null(Read($"EZAuctioneerDB = {{ [\"schema\"] = {schema}, [\"markets\"] = {{ }} }}", warnings));
        Assert.Contains($"version de base {shown} non prise en charge", Assert.Single(warnings));
    }

    [Fact]
    public void File_without_samples_sends_nothing_and_warns_nothing()
    {
        var warnings = new List<string>();

        Assert.Null(Read("EZAuctioneerDB = { [\"schema\"] = 5, [\"markets\"] = { [\"3:R:neutral\"] = { [\"history\"] = { } } } }", warnings));
        Assert.Empty(warnings);
    }

    [Fact]
    public void Only_the_most_recent_samples_are_kept()
    {
        var samples = string.Join(", ", Enumerable.Range(0, 60).Select(i => $"{{ [\"ts\"] = {1795000000 + i * 3600}, [\"p\"] = {100 + i}, [\"units\"] = 1 }}"));

        var item = Read(MinimalFile(5, samples))!.Markets.Single().Items.Single();

        Assert.Equal(EzAuctioneerReader.MaxSamplesPerItem, item.Samples.Count);
        Assert.Equal(110L, item.Samples[0][1]);
        Assert.Equal(159L, item.Samples[^1][1]);
    }

    [Fact]
    public void Invalid_markets_and_values_are_ignored()
    {
        const string lua = """
            EZAuctioneerDB = { ["schema"] = 5, ["markets"] = {
            ["sans forme"] = { ["history"] = { ["i:1"] = { ["samples"] = { { ["ts"] = 1795079141, ["p"] = 5, ["units"] = 2 } } } } },
            ["3:R:Horde:faction"] = { ["history"] = { ["i:2"] = { ["samples"] = {
            { ["ts"] = 1500000000, ["p"] = 5, ["units"] = 2 },
            { ["ts"] = 1795079141, ["p"] = 10000000000001, ["units"] = 2 },
            { ["ts"] = 1795079142, ["p"] = 5, ["units"] = -1 },
            { ["ts"] = 1795079143, ["p"] = 5 },
            { ["ts"] = 1795079144, ["p"] = 7, ["units"] = 0 },
            } } } },
            } }
            """;
        var warnings = new List<string>();

        var market = Read(lua, warnings)!.Markets.Single();

        Assert.Equal("3:R:Horde:faction", market.Key);
        Assert.Equal([[1795079144L, 7, 0]], market.Items.Single().Samples);
        Assert.Contains(warnings, w => w.Contains("« sans forme » non reconnu"));
        Assert.Contains(warnings, w => w.Contains("4 relevés invalides"));
    }

    [Fact]
    public void A_market_without_realm_is_kept_for_the_site_to_complete()
    {
        // WoW Forever, build 71037 : GetRealmName() rend "", la clé n'a plus de royaume.
        const string lua = """
            EZAuctioneerDB = { ["schema"] = 5, ["markets"] = {
            ["3::Alliance:faction"] = { ["history"] = { ["i:2"] = { ["samples"] = { { ["ts"] = 1795079144, ["p"] = 7, ["units"] = 3 } } } } },
            ["3::neutral"] = { ["history"] = { ["i:3"] = { ["samples"] = { { ["ts"] = 1795079144, ["p"] = 9, ["units"] = 1 } } } } },
            } }
            """;
        var warnings = new List<string>();

        var markets = Read(lua, warnings)!.Markets;

        Assert.Equal(["3::Alliance:faction", "3::neutral"], markets.Select(m => m.Key));
        Assert.Empty(warnings);
    }

    [Fact]
    public void Content_hash_follows_the_samples_only()
    {
        var first = Read(MinimalFile(5, "{ [\"ts\"] = 1795079141, [\"p\"] = 5, [\"units\"] = 2 }"))!.Markets.Single();
        var reordered = Read(MinimalFile(5, "{ [\"units\"] = 2, [\"p\"] = 5, [\"ts\"] = 1795079141 }").Replace("[\"schema\"] = 5,", "[\"schema\"] = 5, [\"lastRequest\"] = 1,"))!.Markets.Single();
        var changed = Read(MinimalFile(5, "{ [\"ts\"] = 1795079141, [\"p\"] = 6, [\"units\"] = 2 }"))!.Markets.Single();

        Assert.Equal(first.ContentHash, reordered.ContentHash);
        Assert.NotEqual(first.ContentHash, changed.ContentHash);
    }

    /// <summary>
    /// Deux portefeuilles au format d'EZAuctioneer 0.4.3 (Core.Journal), sans aucun scan : positions,
    /// annonces suivies (clé numérique ou chaîne), journal dans le désordre, montants fractionnaires.
    /// </summary>
    internal const string PortfolioFile = """
        EZAuctioneerDB = { ["schema"] = 5, ["markets"] = { ["3:Royaume Test PvE:neutral"] = { ["history"] = { }, ["lastDeals"] = { } } }, ["portfolio"] = {
        ["3:Royaume Test PvE:Ada"] = {
          ["stats"] = { ["realized"] = 1234.5, ["sales"] = 3, ["cuts"] = 210, ["expired"] = 1, ["depositsLost"] = 60, ["unknown"] = 0 },
          ["positions"] = {
            ["i:4306:s1019"] = { ["key"] = "i:4306:s1019", ["itemID"] = 4306, ["name"] = "Bottes de l'Ours", ["link"] = "|cff1eff00|Hitem:4306::::::1019|h[Bottes de l'Ours]|h|r", ["qty"] = 2, ["cost"] = 49500, ["listed"] = 1, ["opened"] = 1795079248 },
            ["i:2589"] = { ["key"] = "i:2589", ["qty"] = 20, ["cost"] = 240.4, ["listed"] = 0 },
          },
          ["auctions"] = {
            [1234567] = { ["key"] = "i:4306:s1019", ["qty"] = 1, ["unit"] = 30000, ["deposit"] = 150, ["cut"] = 0.05, ["market"] = "3:Royaume Test PvE:Alliance:faction", ["at"] = 1795079300, ["soldPending"] = true },
            ["99"] = { ["key"] = "i:2589", ["qty"] = 20, ["unit"] = 15 },
          },
          ["log"] = {
            { ["t"] = 1795079300, ["kind"] = "post", ["key"] = "i:4306:s1019", ["name"] = "Bottes de l'Ours", ["qty"] = 1, ["unit"] = 30000, ["deposit"] = 150 },
            { ["t"] = 1795079248, ["kind"] = "buy", ["key"] = "i:4306:s1019", ["name"] = "Bottes de l'Ours", ["link"] = "|cff1eff00|Hitem:4306::::::1019|h[Bottes de l'Ours]|h|r", ["qty"] = 2, ["amount"] = 49500, ["source"] = "achat" },
            { ["t"] = 1795090000, ["kind"] = "sale", ["key"] = "i:4306:s1019", ["qty"] = 1, ["amount"] = 30000, ["fee"] = 1500, ["gain"] = -0.5 },
          },
        },
        ["3::Bea"] = { ["stats"] = { ["realized"] = -500 } },
        } }
        """;

    /// <summary>
    /// Classements de trois marchés : revente à l'HV et au marchand, type inconnu, entrée incomplète,
    /// ancienne entrée sans prix de revente, classement vide, ROI hors bornes.
    /// </summary>
    internal const string DealsFile = """
        EZAuctioneerDB = { ["schema"] = 5, ["markets"] = {
        ["3:Royaume Test PvE:Alliance:faction"] = {
          ["history"] = { },
          ["lastSummary"] = { ["at"] = 1795079141, ["auctions"] = 174284 },
          ["lastDeals"] = {
            { ["key"] = "i:13133", ["kind"] = "resale", ["source"] = "both", ["name"] = "Épaulettes drakefeu", ["qty"] = 1, ["cost"] = 49898, ["resale"] = 149900.4, ["profit"] = 80000.5, ["roi"] = 1.6033, ["listings"] = 4, ["thin"] = true, ["liveStatus"] = "gone" },
            { ["key"] = "i:2589", ["kind"] = "vendor", ["source"] = "vendor", ["qty"] = 200, ["cost"] = 1000, ["resale"] = 10, ["profit"] = 1000, ["roi"] = 1, ["liveStatus"] = "valid" },
            { ["key"] = "i:4306:s1019", ["kind"] = "craft", ["qty"] = 1, ["cost"] = 1, ["resale"] = 2, ["profit"] = 1, ["roi"] = 1 },
            { ["key"] = "i:4", ["kind"] = "resale", ["cost"] = 1, ["resale"] = 2, ["profit"] = 1, ["roi"] = 1 },
            { ["key"] = "i:5", ["kind"] = "resale", ["qty"] = 1, ["cost"] = 1, ["reference"] = 3, ["profit"] = -2, ["roi"] = -2 },
          },
        },
        ["3:Royaume Test PvE:neutral"] = { ["lastDeals"] = { } },
        ["3:Royaume Test PvE:Horde:faction"] = { ["lastDeals"] = { { ["key"] = "i:6", ["kind"] = "resale", ["qty"] = 1, ["cost"] = 1, ["resale"] = 2, ["profit"] = 1, ["roi"] = 5000 } } },
        } }
        """;

    [Fact]
    public void Portfolios_are_read_with_positions_auctions_and_journal()
    {
        var warnings = new List<string>();

        var data = Read(PortfolioFile, warnings)!;

        Assert.Empty(warnings);
        // Aucun scan : seuls les portefeuilles partent.
        Assert.Empty(data.Markets);
        Assert.Empty(data.Deals);
        Assert.Equal(["3::Bea", "3:Royaume Test PvE:Ada"], data.Portfolios.Select(p => p.Key));

        // Bilan seul, non nul : transmis ; un champ absent vaut zéro.
        var bea = data.Portfolios[0];
        Assert.Equal(new PortfolioStatsPayload(-500, 0, 0, 0, 0, 0), bea.Stats);
        Assert.Empty(bea.Positions);
        Assert.Empty(bea.Auctions);
        Assert.Empty(bea.Log);

        var ada = data.Portfolios[1];
        // Montants fractionnaires arrondis à la pièce, à la demi-pièce loin de zéro.
        Assert.Equal(new PortfolioStatsPayload(1235, 3, 210, 1, 60, 0), ada.Stats);
        Assert.Equal(
            [new PortfolioPositionPayload("i:2589", 20, 240, 0, null), new PortfolioPositionPayload("i:4306:s1019", 2, 49500, 1, 1795079248)],
            ada.Positions);
        Assert.Equal(
            [
                new PortfolioAuctionPayload(99, "i:2589", 20, 15, null, null, null, null),
                new PortfolioAuctionPayload(1234567, "i:4306:s1019", 1, 30000, 150, 0.05, "3:Royaume Test PvE:Alliance:faction", 1795079300),
            ],
            ada.Auctions);
        Assert.Equal(
            [
                new PortfolioLogEntryPayload(1795079248, "buy", "i:4306:s1019", 2, 49500, null, null, null, null, "achat"),
                new PortfolioLogEntryPayload(1795079300, "post", "i:4306:s1019", 1, null, null, null, 30000, 150, null),
                new PortfolioLogEntryPayload(1795090000, "sale", "i:4306:s1019", 1, 30000, 1500, -1, null, null, null),
            ],
            ada.Log);
    }

    [Fact]
    public void Invalid_portfolio_entries_are_dropped_with_one_warning_per_kind()
    {
        const string lua = """
            EZAuctioneerDB = { ["schema"] = 5, ["portfolio"] = {
            ["Ada"] = { ["stats"] = { ["realized"] = 5 } },
            ["3:R:Ada:Autre"] = { ["stats"] = { ["realized"] = 5 } },
            [5] = { ["stats"] = { ["realized"] = 5 } },
            ["3:R:Ada"] = {
              ["stats"] = { ["realized"] = "beaucoup", ["sales"] = -1, ["cuts"] = 100, ["expired"] = 1.5 },
              ["positions"] = {
                ["i:1"] = { ["qty"] = 1, ["cost"] = 10 },
                ["x:2"] = { ["qty"] = 1, ["cost"] = 10, ["listed"] = 0 },
                ["i:3"] = { ["qty"] = -1, ["cost"] = 10, ["listed"] = 0 },
                ["i:4"] = { ["qty"] = 1, ["listed"] = 0 },
                ["i:5"] = "pas une table",
                ["i:6"] = { ["qty"] = 3000000000, ["cost"] = 10, ["listed"] = 0 },
              },
              ["auctions"] = {
                [10] = { ["key"] = "i:1", ["qty"] = 1, ["unit"] = 5, ["cut"] = 2, ["market"] = "inconnu", ["at"] = 12, ["deposit"] = -3 },
                ["10"] = { ["key"] = "i:1", ["qty"] = 2, ["unit"] = 5 },
                [0] = { ["key"] = "i:1", ["qty"] = 1, ["unit"] = 5 },
                [11] = { ["key"] = "i:1", ["qty"] = 0, ["unit"] = 5 },
                [12] = { ["key"] = "i:1", ["qty"] = 1 },
                ["abc"] = { ["key"] = "i:1", ["qty"] = 1, ["unit"] = 5 },
              },
              ["log"] = {
                { ["t"] = 1795079248, ["kind"] = "buy", ["key"] = "i:1", ["qty"] = 1, ["amount"] = -5, ["source"] = "achat; autre" },
                { ["t"] = 1795079249, ["kind"] = "gift", ["key"] = "i:1", ["qty"] = 1 },
                { ["t"] = 1500000000, ["kind"] = "buy", ["key"] = "i:1", ["qty"] = 1 },
                { ["t"] = 1795079250, ["kind"] = "sale", ["qty"] = 1 },
                "pas une table",
              },
            },
            } }
            """;
        var warnings = new List<string>();

        var portfolio = Read(lua, warnings)!.Portfolios.Single();

        Assert.Equal("3:R:Ada", portfolio.Key);
        Assert.Equal(new PortfolioStatsPayload(0, 0, 100, 0, 0, 0), portfolio.Stats);
        // Valeur facultative invalide (commission, marché, heure, dépôt) : omise, l'entrée reste.
        // Quantité au-delà de 32 bits : refusée, comme par le serveur.
        Assert.Equal([new PortfolioPositionPayload("i:1", 1, 10, 0, null)], portfolio.Positions);
        // [10] et ["10"] : la même annonce, gardée une fois.
        Assert.Equal([new PortfolioAuctionPayload(10, "i:1", 1, 5, null, null, null, null)], portfolio.Auctions);
        Assert.Equal([new PortfolioLogEntryPayload(1795079248, "buy", "i:1", 1, null, null, null, null, null, null)], portfolio.Log);
        Assert.Equal(
            [
                "EZAuctioneer : 3 portefeuilles à la clé non reconnue, ignorés.",
                "EZAuctioneer : portefeuilles : 3 valeurs du bilan invalides, comptées à zéro.",
                "EZAuctioneer : portefeuilles : 5 positions invalides, ignorées.",
                "EZAuctioneer : portefeuilles : 5 annonces suivies invalides, ignorées.",
                "EZAuctioneer : portefeuilles : 4 opérations du journal invalides, ignorées.",
            ],
            warnings);
    }

    [Fact]
    public void Empty_portfolios_are_not_sent()
    {
        const string lua = """
            EZAuctioneerDB = { ["schema"] = 5, ["markets"] = { ["3:R:neutral"] = { ["history"] = { }, ["lastDeals"] = { } } }, ["portfolio"] = {
            ["3:R:Ada"] = { ["positions"] = { }, ["auctions"] = { }, ["log"] = { }, ["stats"] = { ["realized"] = 0, ["sales"] = 0, ["cuts"] = 0, ["expired"] = 0, ["depositsLost"] = 0, ["unknown"] = 0 } },
            ["3:R:Bea"] = { ["stats"] = { ["sales"] = 0 } },
            ["3:R:Cyd"] = { },
            } }
            """;
        var warnings = new List<string>();

        Assert.Null(Read(lua, warnings));
        Assert.Empty(warnings);
    }

    [Fact]
    public void Journal_is_sorted_by_time_and_only_the_most_recent_entries_are_kept()
    {
        static string Journal(IEnumerable<string> entries) =>
            $"EZAuctioneerDB = {{ [\"schema\"] = 5, [\"portfolio\"] = {{ [\"3:R:Ada\"] = {{ [\"log\"] = {{ {string.Join(", ", entries)} }} }} }} }}";
        static string Entry(long at, int qty) => $"{{ [\"t\"] = {at}, [\"kind\"] = \"buy\", [\"key\"] = \"i:1\", [\"qty\"] = {qty} }}";

        // À heure égale, l'ordre du fichier est gardé.
        var tied = Read(Journal([Entry(1795000500, 1), Entry(1795000500, 2), Entry(1795000100, 9), Entry(1795000500, 3)]))!.Portfolios.Single().Log;
        Assert.Equal([9L, 1, 2, 3], tied.Select(e => e.Qty));

        // Du plus récent au plus ancien dans le fichier : les 300 plus récents, remis dans l'ordre.
        var many = Read(Journal(Enumerable.Range(0, 310).Select(i => Entry(1795000000 + (309 - i) * 10L, i))))!.Portfolios.Single().Log;
        Assert.Equal(EzAuctioneerReader.MaxLogEntriesPerPortfolio, many.Count);
        Assert.Equal((1795000100L, 1795003090L), (many[0].At, many[^1].At));
        Assert.Equal(many.Select(e => e.At).Order(), many.Select(e => e.At));
    }

    [Fact]
    public void Deals_are_read_per_market_in_rank_order()
    {
        var warnings = new List<string>();

        var data = Read(DealsFile, warnings)!;

        // Aucun relevé : seules les bonnes affaires partent.
        Assert.Empty(data.Markets);
        Assert.Empty(data.Portfolios);
        // Classement vide, ou sans entrée valide : le marché n'est pas transmis.
        var market = Assert.Single(data.Deals);
        Assert.Equal(("3:Royaume Test PvE:Alliance:faction", 1795079141L), (market.Market, market.At));
        Assert.Equal(
            [
                new DealPayload("i:13133", "resale", "both", 1, 49898, 149900, 80001, 1.6033, 4, true, "gone"),
                // État de vérification que le serveur ne connaît pas (« valid ») : omis.
                new DealPayload("i:2589", "vendor", "vendor", 200, 1000, 10, 1000, 1, null, null, null),
                // Entrée d'avant EZAuctioneer 0.4.2 : la référence tient lieu de prix de revente.
                new DealPayload("i:5", "resale", null, 1, 1, 3, -2, -2, null, null, null),
            ],
            market.Entries);
        // Type inconnu (« craft ») : sauté sans avertissement ; quantité absente et ROI hors bornes : comptés.
        Assert.Equal("EZAuctioneer : 2 bonnes affaires invalides, ignorées.", Assert.Single(warnings));
    }

    [Fact]
    public void Only_the_first_deals_of_the_ranking_are_kept()
    {
        var entries = string.Join(", ", Enumerable.Range(1, 160).Select(i =>
            $"{{ [\"key\"] = \"i:{i}\", [\"kind\"] = \"resale\", [\"qty\"] = 1, [\"cost\"] = 100, [\"resale\"] = 200, [\"profit\"] = {1000 - i}, [\"roi\"] = 1 }}"));

        var deals = Read($"EZAuctioneerDB = {{ [\"schema\"] = 5, [\"markets\"] = {{ [\"3:R:neutral\"] = {{ [\"lastDeals\"] = {{ {entries} }} }} }} }}")!.Deals.Single();

        Assert.Equal(EzAuctioneerReader.MaxDealsPerMarket, deals.Entries.Count);
        Assert.Equal(("i:1", "i:150"), (deals.Entries[0].Key, deals.Entries[^1].Key));
        Assert.Null(deals.At);
    }

    private static string MinimalFile(int schema, string samples) =>
        $"EZAuctioneerDB = {{ [\"schema\"] = {schema}, [\"markets\"] = {{ [\"3:R:Alliance:faction\"] = {{ [\"history\"] = {{ [\"i:2589\"] = {{ [\"samples\"] = {{ {samples} }} }} }} }} }} }}";
}

public class RecipeReaderTests
{
    [Fact]
    public void Learned_recipes_are_read_per_character()
    {
        var warnings = new List<string>();
        var characters = RecipeReader.Read(Fixture.Parse("naowh-recipes.lua"), warnings);

        Assert.Empty(warnings);
        var character = Assert.Single(characters);
        Assert.Equal("Player-9999-00000001", character.Guid);
        Assert.Equal(37, character.Recipes.Count);
        // Relevé réel : le sort 2963 (Couture, ligne 197) produit 1 objet 2996 avec 2 objets 2589.
        var recipe = character.Recipes.Single(r => r.OutputItemId == 2996);
        Assert.Equal(new RecipePayload(2963, 197, 2996, 1, false, recipe.Reagents), recipe);
        Assert.Equal([new ReagentPayload(2589, 2)], recipe.Reagents);
        Assert.Equal(character.Recipes.Select(r => r.SpellId).Order(), character.Recipes.Select(r => r.SpellId));
    }

    [Fact]
    public void Incomplete_recipes_are_skipped()
    {
        const string lua = """
            NaowhForeverDB = { ["account"] = { ["profMakes"] = {
            ["Player-1-0A"] = {
            [10] = { ["recipe"] = 100, ["made"] = 2, ["prof"] = 164, ["cooldown"] = true, ["need"] = { [20] = 3, [21] = 1 } },
            [11] = { ["recipe"] = 101, ["need"] = { } },
            [12] = { ["made"] = 1, ["need"] = { [20] = 1 } },
            [13] = { ["recipe"] = 103, ["need"] = { [20] = 0 } },
            },
            ["Nom-Royaume"] = { [10] = { ["recipe"] = 100, ["need"] = { [20] = 1 } } },
            } } }
            """;
        var warnings = new List<string>();

        var recipe = RecipeReader.Read(SavedVariablesParser.Parse(lua), warnings).Single().Recipes.Single();

        Assert.Equal(new RecipePayload(100, 164, 10, 2, true, recipe.Reagents), recipe);
        Assert.Equal([new ReagentPayload(20, 3), new ReagentPayload(21, 1)], recipe.Reagents);
        Assert.Contains("3 recettes incomplètes", Assert.Single(warnings));
    }

    [Fact]
    public void File_without_recipes_yields_nothing()
    {
        Assert.Empty(RecipeReader.Read(SavedVariablesParser.Parse("NaowhForeverDB = { [\"profiles\"] = { } }"), []));
    }
}

public class EconomyPayloadTests
{
    private static PayloadBuilder Builder() => new(new StableFileReader(new StableReadOptions { SettleDelay = TimeSpan.Zero }));

    [Fact]
    public async Task Market_and_recipes_are_attached_to_the_account()
    {
        using var temp = new TempDirectory();
        var flavor = temp.Combine("_forever_");
        var altBoard = temp.AddAccount(flavor, "111111111#1", "account-four-characters.lua");
        var folder = Path.GetDirectoryName(altBoard)!;
        File.Copy(Fixture.PathOf("auctionator-multi-day.lua"), Path.Combine(folder, "Auctionator.lua"));
        File.Copy(Fixture.PathOf("naowh-recipes.lua"), Path.Combine(folder, "NaowhForever.lua"));

        var source = AccountScanner.Scan(flavor).Single();
        Assert.Equal(("Auctionator.lua", "NaowhForever.lua"), (Path.GetFileName(source.AuctionatorFilePath), Path.GetFileName(source.RecipesFilePath)));
        var result = await Builder().ReadAccountAsync(source);

        var payload = result.Payload!;
        Assert.Empty(payload.Warnings);
        Assert.Equal(40, payload.Auctionator!.Markets.Single().Items.Count);
        Assert.Equal(Fixture.Bytes("auctionator-multi-day.lua").LongLength, payload.Auctionator.File.Size);
        Assert.Equal(37, payload.Recipes!.Characters.Single().Recipes.Count);
        // Les deux derniers champs, Baganator et EZAuctioneer, sont absents ici.
        Assert.EndsWith($":{payload.Auctionator.File.Hash}:{payload.Recipes.File.Hash}:-:-", result.Fingerprint);
        Assert.StartsWith($"{PayloadBuilder.PayloadFormat}:", result.Fingerprint);

        using var json = JsonDocument.Parse(JsonSerializer.Serialize(payload, SyncJsonContext.Default.AccountPayload));
        Assert.Equal("111111111#1", json.RootElement.GetProperty("folderName").GetString());
        Assert.Equal("11…#1", json.RootElement.GetProperty("folderHint").GetString());
        var item = json.RootElement.GetProperty("auctionator").GetProperty("markets")[0].GetProperty("items")[0];
        Assert.Equal(JsonValueKind.Array, item.GetProperty("days")[0].ValueKind);
        Assert.Equal(4, item.GetProperty("days")[0].GetArrayLength());
        Assert.True(json.RootElement.GetProperty("recipes").GetProperty("characters")[0].GetProperty("recipes")[0].TryGetProperty("outputQuantity", out _));
    }

    [Fact]
    public async Task Unreadable_economy_files_never_block_the_altboard_sync()
    {
        using var temp = new TempDirectory();
        var flavor = temp.Combine("_forever_");
        var folder = Path.GetDirectoryName(temp.AddAccount(flavor, "222222222#1", "account-two-characters.lua"))!;
        File.WriteAllText(Path.Combine(folder, "Auctionator.lua"), "AUCTIONATOR_PRICE_DATABASE = {");
        File.WriteAllText(Path.Combine(folder, "NaowhForever.lua"), "NaowhForeverDB = ");

        var result = await Builder().ReadAccountAsync(AccountScanner.Scan(flavor).Single());

        Assert.True(result.Succeeded);
        Assert.Equal(2, result.Payload!.Characters.Count);
        Assert.Null(result.Payload.Auctionator);
        Assert.Null(result.Payload.Recipes);
        Assert.Contains(result.Payload.Warnings, w => w.StartsWith("Auctionator illisible"));
        Assert.Contains(result.Payload.Warnings, w => w.StartsWith("NaowhForever illisible"));

        using var json = JsonDocument.Parse(JsonSerializer.Serialize(result.Payload, SyncJsonContext.Default.AccountPayload));
        Assert.False(json.RootElement.TryGetProperty("auctionator", out _));
        Assert.False(json.RootElement.TryGetProperty("recipes", out _));
    }

    [Fact]
    public async Task Scan_samples_and_portfolio_are_attached_to_the_account_without_item_names()
    {
        using var temp = new TempDirectory();
        var flavor = temp.Combine("_forever_");
        var folder = Path.GetDirectoryName(temp.AddAccount(flavor, "111111111#1", "account-four-characters.lua"))!;
        File.Copy(Fixture.PathOf("ezauctioneer-small.lua"), Path.Combine(folder, "EZAuctioneer.lua"));

        var source = AccountScanner.Scan(flavor).Single();
        Assert.Equal("EZAuctioneer.lua", Path.GetFileName(source.EzAuctioneerFilePath));
        var result = await Builder().ReadAccountAsync(source);

        var payload = result.Payload!;
        var ez = payload.EzAuctioneer!;
        Assert.Equal(5, ez.Schema);
        Assert.Equal(Fixture.Bytes("ezauctioneer-small.lua").LongLength, ez.File.Size);
        Assert.Equal(3, ez.Markets.Single().Items.Count);
        Assert.EndsWith($":-:{ez.File.Hash}", result.Fingerprint);
        Assert.Contains(payload.Warnings, w => w.StartsWith("EZAuctioneer : "));

        var text = JsonSerializer.Serialize(payload, SyncJsonContext.Default.AccountPayload);
        using var json = JsonDocument.Parse(text);
        var market = json.RootElement.GetProperty("ezAuctioneer").GetProperty("markets")[0];
        Assert.Equal(3, market.GetProperty("items")[0].GetProperty("samples")[0].GetArrayLength());
        Assert.Equal("own", market.GetProperty("scans")[1].GetProperty("origin").GetString());
        // Portefeuille du personnage fictif : transmis depuis l'agent 0.11.0.
        var portfolio = json.RootElement.GetProperty("ezAuctioneer").GetProperty("portfolios")[0];
        Assert.Equal("3:Royaume Test PvE:Testeur", portfolio.GetProperty("key").GetString());
        Assert.Equal(("buy", 16800L), (portfolio.GetProperty("log")[0].GetProperty("kind").GetString(), portfolio.GetProperty("log")[0].GetProperty("amount").GetInt64()));
        // La bonne affaire du fichier, sans type, n'est pas transmise ; les noms d'objets restent sur le PC.
        Assert.False(json.RootElement.GetProperty("ezAuctioneer").TryGetProperty("deals", out _));
        Assert.DoesNotContain("drakefeu", text);
    }

    [Fact]
    public async Task Portfolio_alone_is_sent_with_an_empty_market_list()
    {
        using var temp = new TempDirectory();
        var flavor = temp.Combine("_forever_");
        var folder = Path.GetDirectoryName(temp.AddAccount(flavor, "123456789#1", "account-two-characters.lua"))!;
        File.WriteAllText(Path.Combine(folder, "EZAuctioneer.lua"), EzAuctioneerReaderTests.PortfolioFile);

        var result = await Builder().ReadAccountAsync(AccountScanner.Scan(flavor).Single());

        var ez = result.Payload!.EzAuctioneer!;
        Assert.Empty(ez.Markets);
        Assert.Equal(["3::Bea", "3:Royaume Test PvE:Ada"], ez.Portfolios!.Select(p => p.Key));
        Assert.Null(ez.Deals);
        Assert.Empty(result.Payload.Warnings);

        var text = JsonSerializer.Serialize(result.Payload, SyncJsonContext.Default.AccountPayload);
        using var json = JsonDocument.Parse(text);
        var root = json.RootElement.GetProperty("ezAuctioneer");
        Assert.Equal(0, root.GetProperty("markets").GetArrayLength());
        Assert.False(root.TryGetProperty("deals", out _));
        var ada = root.GetProperty("portfolios")[1];
        Assert.Equal(
            ["realized", "sales", "cuts", "expired", "depositsLost", "unknown"],
            ada.GetProperty("stats").EnumerateObject().Select(p => p.Name));
        Assert.Equal(["key", "qty", "cost", "listed", "openedAt"], ada.GetProperty("positions")[1].EnumerateObject().Select(p => p.Name));
        Assert.Equal(["key", "qty", "cost", "listed"], ada.GetProperty("positions")[0].EnumerateObject().Select(p => p.Name));
        Assert.Equal(
            ["id", "key", "qty", "unit", "deposit", "cut", "market", "postedAt"],
            ada.GetProperty("auctions")[1].EnumerateObject().Select(p => p.Name));
        Assert.Equal(1234567L, ada.GetProperty("auctions")[1].GetProperty("id").GetInt64());
        Assert.Equal(["at", "kind", "key", "qty", "amount", "source"], ada.GetProperty("log")[0].EnumerateObject().Select(p => p.Name));
        Assert.Equal(["at", "kind", "key", "qty", "amount", "fee", "gain"], ada.GetProperty("log")[2].EnumerateObject().Select(p => p.Name));
        Assert.Equal(-1L, ada.GetProperty("log")[2].GetProperty("gain").GetInt64());
        // Noms et liens d'objets du portefeuille restent sur le PC.
        Assert.DoesNotContain("Ours", root.GetRawText());
        Assert.DoesNotContain("Hitem", root.GetRawText());
    }

    [Fact]
    public async Task Deals_use_the_server_field_names()
    {
        using var temp = new TempDirectory();
        var flavor = temp.Combine("_forever_");
        var folder = Path.GetDirectoryName(temp.AddAccount(flavor, "123456789#1", "account-two-characters.lua"))!;
        File.WriteAllText(Path.Combine(folder, "EZAuctioneer.lua"), EzAuctioneerReaderTests.DealsFile);

        var result = await Builder().ReadAccountAsync(AccountScanner.Scan(flavor).Single());

        var text = JsonSerializer.Serialize(result.Payload!, SyncJsonContext.Default.AccountPayload);
        using var json = JsonDocument.Parse(text);
        var root = json.RootElement.GetProperty("ezAuctioneer");
        Assert.Equal(0, root.GetProperty("markets").GetArrayLength());
        // Aucun portefeuille : liste vide, pour que le site remette à zéro ceux que ce PC avait envoyés.
        Assert.Equal(0, root.GetProperty("portfolios").GetArrayLength());
        var deals = root.GetProperty("deals")[0];
        Assert.Equal(["market", "at", "entries"], deals.EnumerateObject().Select(p => p.Name));
        Assert.Equal(
            ["key", "kind", "source", "qty", "cost", "resale", "profit", "roi", "listings", "thin", "live"],
            deals.GetProperty("entries")[0].EnumerateObject().Select(p => p.Name));
        Assert.Equal(1.6033, deals.GetProperty("entries")[0].GetProperty("roi").GetDouble());
        Assert.False(deals.GetProperty("entries")[1].TryGetProperty("live", out _));
        Assert.DoesNotContain("drakefeu", root.GetRawText());
    }

    [Fact]
    public async Task Unreadable_ezauctioneer_file_never_blocks_the_sync()
    {
        using var temp = new TempDirectory();
        var flavor = temp.Combine("_forever_");
        var folder = Path.GetDirectoryName(temp.AddAccount(flavor, "222222222#1", "account-two-characters.lua"))!;
        File.WriteAllText(Path.Combine(folder, "EZAuctioneer.lua"), "EZAuctioneerDB = {");

        var result = await Builder().ReadAccountAsync(AccountScanner.Scan(flavor).Single());

        Assert.True(result.Succeeded);
        Assert.Null(result.Payload!.EzAuctioneer);
        Assert.Contains(result.Payload.Warnings, w => w.StartsWith("EZAuctioneer illisible"));
    }
}
