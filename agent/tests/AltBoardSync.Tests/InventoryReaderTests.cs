using System.Text.Json;
using AltBoardSync.Core.Discovery;
using AltBoardSync.Core.Inventory;
using AltBoardSync.Core.IO;
using AltBoardSync.Core.Lua;
using AltBoardSync.Core.Sync;

namespace AltBoardSync.Tests;

public class SyndicatorReaderTests
{
    [Fact]
    public void Mail_auctions_and_guild_banks_are_read()
    {
        var warnings = new List<string>();
        var data = SyndicatorReader.Read(Fixture.Parse("syndicator-small.lua"), warnings);

        Assert.NotNull(data);
        Assert.Empty(warnings);
        Assert.Equal(["Inconnu Fictif", "Zoé D'Ambre", "Élodie Brisefer"], data.Characters.Select(c => c.Name));

        var elodie = data.Characters.Single(c => c.Name == "Élodie Brisefer");
        // Deux courriers du même objet : quantités additionnées, échéance la plus proche. Cases vides ignorées.
        Assert.Equal(
            [
                new HoldingPayload("15210:1017", 1, 1796999134),
                new HoldingPayload("249427", 12, 1796999134),
                new HoldingPayload("249428", 5, 1796500000),
            ],
            elodie.Mail);
        Assert.Equal([new HoldingPayload("20576", 1, 1794091265)], elodie.Auctions);
        Assert.Empty(data.Characters.Single(c => c.Name == "Zoé D'Ambre").Mail);

        // Banque jamais ouverte et sans or : écartée.
        var guild = Assert.Single(data.Guilds);
        Assert.Equal(("Ordre Fictif", "ClassicBetaPvE2", 4699L), (guild.Name, guild.Realm, guild.MoneyCopper));
        var tab = Assert.Single(guild.Tabs);
        Assert.Equal((1, "Composants"), (tab.Index, tab.Name));
        Assert.Equal([new ItemCountPayload("2318", 25)], tab.Items);
    }

    [Fact]
    public void Cited_items_are_described_from_their_link()
    {
        var data = SyndicatorReader.Read(Fixture.Parse("syndicator-small.lua"), [])!;

        var sword = data.Items.Single(i => i.Key == "15210:1017");
        Assert.Equal(new ItemPayload("15210:1017", 15210, 1017, "Épée large de l'ours", 2, 135321, sword.Link), sword);
        Assert.StartsWith("|cnIQ2:|Hitem:15210:", sword.Link);
        Assert.Equal(data.Items.Select(i => i.Key).Order(StringComparer.Ordinal), data.Items.Select(i => i.Key));
        // Sacs, banque et équipement ne sont pas lus : AltBoard les relève déjà.
        Assert.DoesNotContain(data.Items, i => i.Key is "6948" or "148");
    }

    [Theory]
    [InlineData("|Hitem:2589::::::::1:1485|h[x]|h", 2589, "2589")]
    [InlineData("|Hitem:15210::::::-1017::|h[x]|h", 15210, "15210:-1017")]
    [InlineData("|Hitem:15210::::::0::|h[x]|h", 15210, "15210")]
    [InlineData(null, 2589, "2589")]
    [InlineData("pas un lien", 2589, "2589")]
    [InlineData(null, null, null)]
    [InlineData(null, 0, null)]
    public void Item_keys_follow_altboard(string? link, int? itemId, string? expected)
    {
        Assert.Equal(expected, SyndicatorReader.ItemKey(link, itemId));
    }

    [Fact]
    public void Unreadable_entries_are_counted_and_other_files_yield_nothing()
    {
        const string lua = """
            SYNDICATOR_DATA = { ["Characters"] = { ["Nom-PvE"] = {
              ["mail"] = { { ["itemCount"] = 2, ["itemLink"] = "|Hitem:0:|h[?]|h" }, { ["itemCount"] = 0, ["itemID"] = 5 }, { ["itemCount"] = 4, ["itemID"] = 7 } },
            } } }
            """;
        var warnings = new List<string>();

        var character = SyndicatorReader.Read(SavedVariablesParser.Parse(lua), warnings)!.Characters.Single();

        Assert.Equal("Nom", character.Name);
        Assert.Equal([new HoldingPayload("7", 4, null)], character.Mail);
        Assert.Contains("2 objets", Assert.Single(warnings));
        Assert.Null(SyndicatorReader.Read(SavedVariablesParser.Parse("BAGANATOR_CONFIG = { }"), []));
    }
}

public class BaganatorPayloadTests
{
    private static PayloadBuilder Builder() => new(new StableFileReader(new StableReadOptions { SettleDelay = TimeSpan.Zero }));

    [Fact]
    public async Task Holdings_are_attached_to_altboard_characters_by_name()
    {
        using var temp = new TempDirectory();
        var flavor = temp.Combine("_forever_");
        var folder = Path.GetDirectoryName(temp.AddAccount(flavor, "111111111#1", "account-four-characters.lua"))!;
        File.Copy(Fixture.PathOf("syndicator-small.lua"), Path.Combine(folder, "Syndicator.lua"));

        var source = AccountScanner.Scan(flavor).Single();
        Assert.Equal("Syndicator.lua", Path.GetFileName(source.SyndicatorFilePath));
        var result = await Builder().ReadAccountAsync(source);

        var payload = result.Payload!;
        var baganator = payload.Baganator!;
        // « Inconnu Fictif » n'existe pas dans AltBoard : signalé, pas transmis.
        Assert.Contains("1 personnage absent d'AltBoard", Assert.Single(payload.Warnings));
        Assert.Equal(["Player-9999-00000001", "Player-9999-00000005"], baganator.Characters.Select(c => c.Guid));
        Assert.Equal(3, baganator.Characters[0].Mail.Count);
        Assert.Empty(baganator.Characters[1].Mail);
        Assert.Single(baganator.Guilds);
        Assert.EndsWith($":{baganator.File.Hash}", result.Fingerprint);

        // Objets du courrier inconnus d'AltBoard : ajoutés au référentiel ; ceux qu'AltBoard décrit gardent sa description.
        Assert.Contains(payload.Items, i => i.Key == "249428" && i.Name == "Peau immaculée");
        Assert.Equal(payload.Items.Select(i => i.Key).Distinct().Count(), payload.Items.Count);
        Assert.Equal(payload.Items.Select(i => i.Key).Order(StringComparer.Ordinal), payload.Items.Select(i => i.Key));

        using var json = JsonDocument.Parse(JsonSerializer.Serialize(payload, SyncJsonContext.Default.AccountPayload));
        var mail = json.RootElement.GetProperty("baganator").GetProperty("characters")[0].GetProperty("mail")[0];
        Assert.Equal("15210:1017", mail.GetProperty("key").GetString());
        Assert.Equal(1796999134, mail.GetProperty("expiresAt").GetInt64());
        Assert.Equal(25, json.RootElement.GetProperty("baganator").GetProperty("guilds")[0].GetProperty("tabs")[0].GetProperty("items")[0].GetProperty("count").GetInt32());
    }

    [Fact]
    public async Task The_most_recently_seen_namesake_receives_the_holdings()
    {
        using var temp = new TempDirectory();
        var flavor = temp.Combine("_forever_");
        var folder = Path.GetDirectoryName(temp.AddAccount(flavor, "111111111#1", "account-four-characters.lua"))!;
        var characters = (await Builder().ReadAccountAsync(AccountScanner.Scan(flavor).Single())).Payload!.Characters;
        var newest = characters.MaxBy(c => c.LastSeen)!;
        // Tous les personnages portent le même nom : seul le plus récent reçoit le courrier.
        var lua = string.Join(
            "\n",
            File.ReadAllLines(Path.Combine(folder, "AltBoard.lua"))
                .Select(line => characters.Aggregate(line, (text, c) => text.Replace($"\"{c.Name}\"", "\"Homonyme\""))));
        File.WriteAllText(Path.Combine(folder, "AltBoard.lua"), lua);
        File.WriteAllText(
            Path.Combine(folder, "Syndicator.lua"),
            """SYNDICATOR_DATA = { ["Characters"] = { ["Homonyme-PvE"] = { ["mail"] = { { ["itemCount"] = 1, ["itemID"] = 7 } } } } }""");

        var baganator = (await Builder().ReadAccountAsync(AccountScanner.Scan(flavor).Single())).Payload!.Baganator!;

        Assert.Equal(newest.Guid, Assert.Single(baganator.Characters).Guid);
    }

    [Fact]
    public async Task An_unreadable_syndicator_file_never_blocks_the_sync()
    {
        using var temp = new TempDirectory();
        var flavor = temp.Combine("_forever_");
        var folder = Path.GetDirectoryName(temp.AddAccount(flavor, "222222222#1", "account-two-characters.lua"))!;
        File.WriteAllText(Path.Combine(folder, "Syndicator.lua"), "SYNDICATOR_DATA = {");

        var result = await Builder().ReadAccountAsync(AccountScanner.Scan(flavor).Single());

        Assert.True(result.Succeeded);
        Assert.Null(result.Payload!.Baganator);
        Assert.Contains("Baganator illisible", Assert.Single(result.Payload.Warnings));
    }
}
