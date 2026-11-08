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
        Assert.EndsWith($":{payload.Auctionator.File.Hash}:{payload.Recipes.File.Hash}", result.Fingerprint);
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
}
