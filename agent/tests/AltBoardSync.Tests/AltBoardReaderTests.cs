using System.Text.Json;
using AltBoardSync.Core.AltBoard;
using AltBoardSync.Core.Lua;
using AltBoardSync.Core.Sync;

namespace AltBoardSync.Tests;

public class AltBoardReaderTests
{
    // Les valeurs attendues ont été relevées dans la fixture avec un second parser, indépendant de celui-ci.

    [Fact]
    public void Real_account_with_four_characters_is_read()
    {
        var document = Fixture.Read("account-four-characters.lua");

        Assert.Equal(2, document.Schema);
        Assert.Empty(document.Warnings);
        Assert.Equal(418, document.Items.Count);
        Assert.Equal(
            ["Player-9999-00000001", "Player-9999-00000005", "Player-9999-00000006", "Player-9999-00000008"],
            document.Characters.Select(c => c.Guid));
        Assert.Equal(
            ["Élodie Brisefer", "Zoé D'Ambre", "Ægir Çélèste", "Noël L’Hermite"],
            document.Characters.Select(c => c.Name));
    }

    [Fact]
    public void Character_identity_and_progress_match_the_source()
    {
        var mage = Fixture.Read("account-four-characters.lua").Characters[0];

        Assert.Equal("Player-9999-00000001", mage.Guid);
        Assert.Equal("Élodie Brisefer", mage.Name);
        Assert.Equal("ClassicBetaPvE2", mage.Realm);
        Assert.Equal("MAGE", mage.Class);
        Assert.Equal("Éolide de l’Ordre suprême", mage.Race);
        Assert.Equal("Alliance", mage.Faction);
        Assert.Equal(25, mage.Level);
        Assert.Equal(29426, mage.Xp);
        Assert.Equal(34000, mage.XpMax);
        Assert.Null(mage.RestedXp);
        Assert.Equal("Les Sans-Souci", mage.Guild);
        Assert.Equal("Taverne du Corbeau écarlate", mage.Zone);
        Assert.Equal(80964, mage.MoneyCopper);
        Assert.Equal(16.25, mage.ItemLevel);
        Assert.Equal(1791118113, mage.LastSeen);
        Assert.Equal(1791116901, mage.StatsAt);
        Assert.False(mage.Hidden);
    }

    [Fact]
    public void Professions_keep_their_order_and_ranks()
    {
        var mage = Fixture.Read("account-four-characters.lua").Characters[0];

        Assert.Equal(
            [
                new ProfessionPayload(197, "Couture", 88, 150, true, 136249),
                new ProfessionPayload(333, "Enchantement", 47, 75, true, 136244),
                new ProfessionPayload(356, "Pêche", 1, 75, false, 136245),
                new ProfessionPayload(185, "Cuisine", 20, 75, false, 133971),
            ],
            mage.Professions);
    }

    [Fact]
    public void Gear_is_indexed_by_slot_and_exposes_item_and_enchant_ids()
    {
        var mage = Fixture.Read("account-four-characters.lua").Characters[0];

        Assert.Equal([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16, 17, 18], mage.Gear.Select(g => g.Slot));
        var chest = mage.Gear.Single(g => g.Slot == 5);
        Assert.Equal(2969, chest.ItemId);
        Assert.Equal(24, chest.EnchantId);
        Assert.Equal("Gilet de lieur de sort", chest.Name);
        Assert.Equal(2, chest.Quality);
        Assert.Equal(17, chest.ItemLevel);
        Assert.Equal(132647, chest.Icon);
        Assert.StartsWith("|cnIQ2:|Hitem:2969:24:", chest.Link);
    }

    [Fact]
    public void Reputations_currencies_and_stats_match_the_source()
    {
        var mage = Fixture.Read("account-four-characters.lua").Characters[0];

        Assert.Equal([21, 47, 54, 69, 72, 369, 2586, 2740, 2758, 2779], mage.Reputations.Select(r => r.FactionId));
        Assert.Equal(new ReputationPayload(47, "Ironforge", "Alliance", 5, 4715, 3000, 9000), mage.Reputations[1]);
        Assert.Equal([new CurrencyPayload("Faveur marchande", 60, 0, 135725)], mage.Currencies);

        var stats = mage.Stats!;
        Assert.Equal(24, stats.Strength);
        Assert.Equal(116, stats.Intellect);
        Assert.Equal(453, stats.Armor);
        Assert.Equal("MANA", stats.PowerType);
        Assert.Equal(0.896000325679779, stats.Crit);
        Assert.Equal(5.710000038146973, stats.SpellCrit);
        Assert.Equal(0, stats.ResFire);
        Assert.Equal(0, stats.ResArcane);
        Assert.Null(stats.Defense);
    }

    [Fact]
    public void Bags_and_bank_carry_counts_slots_and_timestamps()
    {
        var characters = Fixture.Read("account-four-characters.lua").Characters;
        var mage = characters[0];

        Assert.Equal(54, mage.Bags!.Items.Count);
        Assert.Equal(new ItemCountPayload("1114", 7), mage.Bags.Items[0]);
        Assert.Equal((57, 58, 1791117999L), (mage.Bags.SlotsUsed, mage.Bags.SlotsTotal, mage.Bags.At));
        Assert.Equal(40, mage.Bank!.Items.Count);
        Assert.Equal((52, 54, 1791111262L), (mage.Bank.SlotsUsed, mage.Bank.SlotsTotal, mage.Bank.At));

        // Banque jamais ouverte : le bloc est absent, pas vide.
        Assert.Null(characters[1].Bank);
        Assert.NotNull(characters[1].Bags);
    }

    [Fact]
    public void Item_reference_is_read()
    {
        var item = Fixture.Read("account-four-characters.lua").Items.Single(i => i.Key == "36");

        Assert.Equal(new ItemPayload("36", 36, null, "Vieille masse", 1, 133478, "|cnIQ1:|Hitem:36::::::::4:1489::75:::::::|h[Vieille masse]|h|r"), item);
    }

    [Fact]
    public void Second_real_account_is_read()
    {
        var document = Fixture.Read("account-two-characters.lua");

        Assert.Empty(document.Warnings);
        Assert.Equal(185, document.Items.Count);
        Assert.Equal(2, document.Characters.Count);

        var hunter = document.Characters[0];
        Assert.Equal(("Märta Ünsal", "HUNTER", 12, 389L, 7.125, 188, "Les Sans-Souci"),
            (hunter.Name, hunter.Class, hunter.Level, hunter.MoneyCopper, hunter.ItemLevel, hunter.RestedXp, hunter.Guild));
        Assert.Equal(["Travail du cuir", "Dépeçage", "Cuisine"], hunter.Professions.Select(p => p.Name));
        Assert.Equal(10, hunter.Gear.Count);

        var warlock = document.Characters[1];
        Assert.Equal(("Bjørn Ångström", "WARLOCK", 13, 7413L, 5d), (warlock.Name, warlock.Class, warlock.Level, warlock.MoneyCopper, warlock.ItemLevel));
        Assert.Null(warlock.Guild);
        Assert.Null(warlock.Bank);
    }

    [Fact]
    public void Unchanged_character_serializes_identically_despite_key_reordering()
    {
        // Le client réécrit les clés dans un ordre différent à chaque sauvegarde.
        var current = Fixture.Read("account-two-characters.lua").Characters[1];
        var previous = Fixture.Read("account-two-characters-previous.lua").Characters[1];

        Assert.Equal(Json(previous), Json(current));
    }

    [Fact]
    public void Login_without_progress_only_moves_timestamps_and_rested_xp()
    {
        var current = Fixture.Read("account-two-characters.lua").Characters[0];
        var previous = Fixture.Read("account-two-characters-previous.lua").Characters[0];

        Assert.NotEqual(previous.LastSeen, current.LastSeen);
        var normalized = current with
        {
            LastSeen = previous.LastSeen,
            StatsAt = previous.StatsAt,
            RestedXp = previous.RestedXp,
            Bags = current.Bags! with { At = previous.Bags!.At },
        };
        Assert.Equal(Json(previous), Json(normalized));
    }

    [Fact]
    public void Missing_database_is_reported()
    {
        var error = Assert.Throws<AltBoardFormatException>(() => Fixture.Read("no-altboarddb.lua"));
        Assert.Contains("AltBoardDB", error.Message);

        Assert.Throws<AltBoardFormatException>(() => Fixture.Read("empty.lua"));
        Assert.Throws<AltBoardFormatException>(() => AltBoardReader.Read(SavedVariablesParser.Parse("AltBoardDB = 5")));
    }

    [Fact]
    public void Database_without_characters_is_valid()
    {
        var document = AltBoardReader.Read(SavedVariablesParser.Parse("AltBoardDB = { schema = 2, chars = {}, items = {} }"));

        Assert.Empty(document.Characters);
        Assert.Empty(document.Items);
        Assert.Empty(document.Warnings);
    }

    [Fact]
    public void Partial_data_is_kept_and_unusable_characters_are_skipped()
    {
        var document = Fixture.Read("partial-data.lua");

        Assert.Equal(["Player-9999-0000A001", "Player-9999-0000A004"], document.Characters.Select(c => c.Guid));

        var minimal = document.Characters[0];
        Assert.Equal("Minimal Seul", minimal.Name);
        Assert.Null(minimal.Level);
        Assert.Null(minimal.MoneyCopper);
        Assert.Null(minimal.Stats);
        Assert.Null(minimal.Bags);
        Assert.Empty(minimal.Gear);
        Assert.Empty(minimal.Professions);

        var wrongTypes = document.Characters[1];
        Assert.Null(wrongTypes.Level);
        Assert.Null(wrongTypes.MoneyCopper);
        Assert.Null(wrongTypes.ItemLevel);
        Assert.Null(wrongTypes.Guild);
        Assert.Null(wrongTypes.Stats);
        Assert.True(wrongTypes.Hidden);
        Assert.Equal(new GearPayload(4, null, null, null, null, null, null, "pas un lien"), Assert.Single(wrongTypes.Gear));
        Assert.Equal(new ProfessionPayload(197, "Couture", 12, 75, true, null), Assert.Single(wrongTypes.Professions));
        // Sacs sans horodatage : le bloc n'est pas daté, il n'est donc pas transmis.
        Assert.Null(wrongTypes.Bags);
    }

    [Fact]
    public void A_character_without_realm_is_kept_with_an_empty_realm()
    {
        // WoW Forever, build 71037 : le jeu ne donne plus le royaume, l'addon enregistre "".
        var document = AltBoardReader.Read(SavedVariablesParser.Parse("""
            AltBoardDB = { schema = 2, chars = {
            ["Player-9999-0000B001"] = { name = "Élodie Brisefer", realm = "", lastSeen = 1795488898, level = 47 },
            ["Player-9999-0000B002"] = { name = "Zoé D'Ambre", lastSeen = 1794538560, level = 6 },
            ["Player-9999-0000B003"] = { realm = "", lastSeen = 1795467430 },
            } }
            """));

        Assert.Equal(
            [("Player-9999-0000B001", "Élodie Brisefer", "", (int?)47), ("Player-9999-0000B002", "Zoé D'Ambre", "", 6)],
            document.Characters.Select(c => (c.Guid, c.Name, c.Realm, c.Level)));
        Assert.Equal(["personnage Player-9999-0000B003 ignoré : nom ou lastSeen absent"], document.Warnings);
    }

    [Fact]
    public void Unknown_structures_are_reported_as_warnings()
    {
        var warnings = Fixture.Read("partial-data.lua").Warnings;

        Assert.Contains(warnings, w => w.Contains("clé racine inconnue") && w.Contains("futureRootKey"));
        Assert.Contains(warnings, w => w.Contains("champ de personnage inconnu") && w.Contains("futureField"));
        Assert.Contains(warnings, w => w.Contains("Player-9999-0000A002") && w.Contains("ignoré"));
        Assert.Contains(warnings, w => w.Contains("Player-9999-0000A003") && w.Contains("ignoré"));
        Assert.Contains(warnings, w => w.Contains("GUID"));
        Assert.Contains(warnings, w => w.Contains("métier ignoré"));
    }

    [Fact]
    public void Unknown_addon_schema_is_read_on_a_best_effort_basis()
    {
        var document = Fixture.Read("unknown-schema.lua");

        Assert.Equal(99, document.Schema);
        var character = Assert.Single(document.Characters);
        Assert.Equal(("Venu du Futur", 30, 123456L), (character.Name, character.Level, character.MoneyCopper));
        Assert.Contains(document.Warnings, w => w.Contains("schéma AltBoard inconnue (99)"));
        Assert.Contains(document.Warnings, w => w.Contains("talents"));
    }

    [Fact]
    public void Characters_from_several_realms_are_sorted_by_guid()
    {
        var characters = Fixture.Read("multi-realm.lua").Characters;

        Assert.Equal(["Player-4620-0000C001", "Player-4620-0000C003", "Player-5827-0000C002"], characters.Select(c => c.Guid));
        Assert.Equal(["ClassicBetaPvE2", "ClassicBetaPvE2", "ClassicBetaPvP1"], characters.Select(c => c.Realm));
        Assert.Equal(["Alliance", "Alliance", "Horde"], characters.Select(c => c.Faction!));
    }

    [Fact]
    public void Special_strings_and_numbers_survive()
    {
        var document = Fixture.Read("special-strings.lua");
        var character = Assert.Single(document.Characters);

        Assert.Equal("Zoé D'Ambre", character.Name);
        Assert.Equal("Éveil-des-Âmes", character.Realm);
        Assert.Equal("L’Ordre d'Émeraude \\ <Çà & Là>", character.Guild);
        Assert.Equal("Val d'Est\tligne\ndeux", character.Zone);
        Assert.Equal("Éolide", character.Race);
        Assert.Equal(21474836470000, character.MoneyCopper);
        Assert.Equal(63.0625, character.ItemLevel);
        Assert.Equal(1500, character.Xp);

        // Les valeurs non finies ne sont jamais transmises.
        Assert.Equal(5.072000026702881, character.Stats!.Crit);
        Assert.Null(character.Stats.Dodge);
        Assert.Null(character.Stats.Parry);
        Assert.Equal((10, 20, 30, 40, 50),
            (character.Stats.ResFire, character.Stats.ResNature, character.Stats.ResFrost, character.Stats.ResShadow, character.Stats.ResArcane));

        Assert.Equal([3, 16], character.Gear.Select(g => g.Slot));
        Assert.Equal("Épaulières 日本語 🐉", character.Gear[0].Name);
        Assert.Equal((16797, 2488), (character.Gear[0].ItemId, character.Gear[0].EnchantId));
        Assert.Equal("Lame d'O'Brien", character.Gear[1].Name);
        Assert.Null(character.Gear[1].EnchantId);

        Assert.Equal([new ItemCountPayload("2589:-17", 20), new ItemCountPayload("6948", 1)], character.Bags!.Items);
        Assert.Equal(new ItemPayload("2589:-17", 2589, -17, "Étoffe \"de\" lin", 1, 132889,
            "|cnIQ1:|Hitem:2589::::::-17:::::::::|h[Étoffe \"de\" lin]|h|r"), Assert.Single(document.Items));
    }

    [Fact]
    public void Out_of_range_values_are_dropped_instead_of_poisoning_the_document()
    {
        var veryLongKey = new string('k', 2000);
        var document = AltBoardReader.Read(SavedVariablesParser.Parse($$"""
            AltBoardDB = { schema = 2, chars = {
              ["Player-1-AAAA0001"] = {
                name = "Bornes", realm = "Royaume", lastSeen = 1791000000,
                level = 70000, money = 1e300, xp = 5000000000, rested = -1, statsAt = -5,
                gear = { { link = "lien", q = -1 } },
                reps = { [47] = { name = "Faction", reaction = 99999 } },
                profs = { { name = "Métier", skillLine = -3 } },
                bags = { ["1"] = 2 }, bagsAt = 99999999999999,
              },
              ["Player-1-AAAA0002"] = { name = "Trop Tard", realm = "Royaume", lastSeen = 1e15 },
            }, ["{{veryLongKey}}"] = 1 }
            """));

        var character = Assert.Single(document.Characters);
        Assert.Null(character.Level);
        Assert.Null(character.MoneyCopper);
        Assert.Null(character.Xp);
        Assert.Null(character.RestedXp);
        Assert.Null(character.StatsAt);
        Assert.Null(character.Gear[0].Quality);
        Assert.Null(character.Reputations[0].Reaction);
        Assert.Empty(character.Professions);
        Assert.Null(character.Bags);
        Assert.All(document.Warnings, w => Assert.True(w.Length <= 300));
        Assert.Contains(document.Warnings, w => w.Contains("Player-1-AAAA0002"));
    }

    [Fact]
    public void Payload_is_valid_json_with_camel_case_names()
    {
        var character = Fixture.Read("special-strings.lua").Characters[0];

        using var json = JsonDocument.Parse(Json(character));

        Assert.Equal("Zoé D'Ambre", json.RootElement.GetProperty("name").GetString());
        Assert.Equal(21474836470000, json.RootElement.GetProperty("moneyCopper").GetInt64());
        Assert.False(json.RootElement.TryGetProperty("restedXp", out _));
        Assert.False(json.RootElement.GetProperty("stats").TryGetProperty("dodge", out _));
    }

    [Fact]
    public void Addon_errors_are_cleaned_shortened_and_sorted_oldest_first()
    {
        var longMessage = new string('m', 450);
        var longVersion = new string('v', 50);
        var document = AltBoardReader.Read(SavedVariablesParser.Parse($$"""
            AltBoardDB = { schema = 2, errors = {
              { t = 1795000200, where = "  OnEvent\tBAG_UPDATE ", msg = "Bags.lua:42: attempt to index nil\nstack traceback:\n\t[C]: ?\0", v = "0.8.3-beta" },
              { t = 1795000100, where = "Collect", msg = "{{longMessage}}", v = "{{longVersion}}" },
              { where = "sans date", msg = "x" },
              { t = 1500000000, where = "trop ancienne", msg = "x" },
              { t = 1795000300, where = "  ", msg = "x" },
              { t = 1795000400, where = "Vide", msg = "\n\t" },
              "pas une table",
            } }
            """));

        Assert.Equal(
            [
                new AddonErrorPayload(1795000100, "Collect", new string('m', 400), new string('v', 40)),
                // Sauts de ligne, tabulations et octet nul : une espace chacun, ou par suite.
                new AddonErrorPayload(1795000200, "OnEvent BAG_UPDATE", "Bags.lua:42: attempt to index nil stack traceback: [C]: ?", "0.8.3-beta"),
            ],
            document.AddonErrors);
        Assert.Equal("erreurs de l'addon : 5 entrées invalides ignorées", Assert.Single(document.Warnings));
    }

    [Fact]
    public void Only_the_ten_most_recent_addon_errors_are_kept()
    {
        var entries = string.Join(", ", Enumerable.Range(0, 12).Select(i => $"{{ t = {1795000000 + i}, where = \"Endroit {i}\", msg = \"erreur\" }}"));

        var errors = AltBoardReader.Read(SavedVariablesParser.Parse($"AltBoardDB = {{ schema = 2, errors = {{ {entries} }} }}")).AddonErrors!;

        Assert.Equal(10, errors.Count);
        Assert.Equal(("Endroit 2", "Endroit 11"), (errors[0].Where, errors[^1].Where));
        Assert.All(errors, error => Assert.Null(error.Version));
    }

    [Fact]
    public void Empty_error_list_is_sent_so_that_old_errors_are_cleared()
    {
        // Fichier réel : l'addon garde une liste vide.
        var document = Fixture.Read("account-four-characters.lua");
        Assert.NotNull(document.AddonErrors);
        Assert.Empty(document.AddonErrors);

        using var json = JsonDocument.Parse(AccountJson(document));
        Assert.Equal(JsonValueKind.Array, json.RootElement.GetProperty("addonErrors").ValueKind);
        Assert.Equal(0, json.RootElement.GetProperty("addonErrors").GetArrayLength());
    }

    [Fact]
    public void Missing_error_list_is_left_out()
    {
        var document = AltBoardReader.Read(SavedVariablesParser.Parse("AltBoardDB = { schema = 2, chars = {} }"));
        Assert.Null(document.AddonErrors);
        using var json = JsonDocument.Parse(AccountJson(document));
        Assert.False(json.RootElement.TryGetProperty("addonErrors", out _));

        var mistyped = AltBoardReader.Read(SavedVariablesParser.Parse("AltBoardDB = { schema = 2, errors = \"aucune\" }"));
        Assert.Null(mistyped.AddonErrors);
        Assert.Contains(mistyped.Warnings, w => w.Contains("errors n'est pas une table"));
    }

    [Fact]
    public void Addon_errors_use_the_server_field_names()
    {
        var document = AltBoardReader.Read(SavedVariablesParser.Parse("""
            AltBoardDB = { schema = 2, errors = { { t = 1795000100, where = "Collect", msg = "erreur", v = "0.8.3" }, { t = 1795000200, where = "Bags", msg = "autre" } } }
            """));

        using var json = JsonDocument.Parse(AccountJson(document));
        var errors = json.RootElement.GetProperty("addonErrors");
        Assert.Equal(
            (1795000100L, "Collect", "erreur", "0.8.3"),
            (errors[0].GetProperty("at").GetInt64(), errors[0].GetProperty("where").GetString(), errors[0].GetProperty("message").GetString(), errors[0].GetProperty("version").GetString()));
        Assert.False(errors[1].TryGetProperty("version", out _));
    }

    private static string AccountJson(AltBoardDocument document) =>
        JsonSerializer.Serialize(
            new AccountPayload("cle", "11…#1", "_forever_", document.Schema, null, new SourceFilePayload("hash", DateTimeOffset.UnixEpoch, 1), document.Characters, document.Items, document.Warnings)
            {
                AddonErrors = document.AddonErrors,
            },
            SyncJsonContext.Default.AccountPayload);

    private static string Json(CharacterPayload character) =>
        JsonSerializer.Serialize(character, SyncJsonContext.Default.CharacterPayload);
}
