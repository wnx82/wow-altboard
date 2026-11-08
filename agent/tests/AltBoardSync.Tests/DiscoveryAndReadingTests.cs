using AltBoardSync.Core.Config;
using AltBoardSync.Core.Discovery;
using AltBoardSync.Core.IO;
using AltBoardSync.Core.Sync;

namespace AltBoardSync.Tests;

public class AccountScannerTests
{
    [Fact]
    public void Finds_every_account_that_has_an_AltBoard_file()
    {
        using var temp = new TempDirectory();
        var flavor = temp.Combine("_classic_beta_");
        temp.AddAccount(flavor, "222222222#1", "account-two-characters.lua");
        temp.AddAccount(flavor, "111111111#1", "account-four-characters.lua");
        temp.AddAccount(flavor, "333333333#1", fixture: null); // compte sans AltBoard
        Directory.CreateDirectory(Path.Combine(flavor, "WTF", "Account", "SavedVariables")); // dossier technique, pas un compte
        File.WriteAllText(Path.Combine(flavor, "WTF", "Account", "111111111#1", "SavedVariables", "AltBoard.lua.bak"), "ancien");

        var sources = AccountScanner.Scan(flavor);

        Assert.Equal(["111111111#1", "222222222#1"], sources.Select(s => s.AccountFolder));
        Assert.All(sources, s => Assert.Equal("_classic_beta_", s.Flavor));
        Assert.All(sources, s => Assert.EndsWith("AltBoard.lua", s.FilePath));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(12)]
    public void Account_count_is_never_hard_coded(int count)
    {
        using var temp = new TempDirectory();
        var flavor = temp.Combine("_classic_beta_");
        Directory.CreateDirectory(Path.Combine(flavor, "WTF", "Account"));
        for (var i = 0; i < count; i++) temp.AddAccount(flavor, $"COMPTE{i:00}", "multi-realm.lua");

        Assert.Equal(count, AccountScanner.Scan(flavor).Count);
    }

    [Fact]
    public void Root_folder_with_several_clients_is_supported()
    {
        using var temp = new TempDirectory();
        temp.AddAccount(temp.Combine("_classic_beta_"), "COMPTE", "multi-realm.lua");
        temp.AddAccount(temp.Combine("_retail_"), "COMPTE", "multi-realm.lua");
        Directory.CreateDirectory(temp.Combine("Data"));

        var sources = AccountScanner.Scan(temp.Path);

        Assert.Equal(["_classic_beta_", "_retail_"], sources.Select(s => s.Flavor));
    }

    [Fact]
    public void Missing_wow_folder_is_an_explicit_error()
    {
        using var temp = new TempDirectory();

        Assert.Throws<DirectoryNotFoundException>(() => AccountScanner.Scan(temp.Combine("absent")));
    }

    [Fact]
    public void Addon_version_is_read_from_the_toc()
    {
        using var temp = new TempDirectory();
        var addon = temp.Combine("Interface", "AddOns", "AltBoard");
        Directory.CreateDirectory(addon);
        File.WriteAllText(Path.Combine(addon, "AltBoard.toc"), "## Interface: 16001\r\n## Title: AltBoard\r\n## Version: 0.8.3\r\n");

        Assert.Equal("0.8.3", AccountScanner.ReadAddonVersion(temp.Path));
        Assert.Null(AccountScanner.ReadAddonVersion(temp.Combine("ailleurs")));
    }
}

public class AccountKeyTests
{
    [Fact]
    public void Key_is_stable_across_machines_and_hides_the_folder_name()
    {
        var key = AccountKey.Compute("123456789#1");

        Assert.Equal(key, AccountKey.Compute(" 123456789#1 "));
        Assert.Equal(AccountKey.Compute("moncompte"), AccountKey.Compute("MONCOMPTE"));
        Assert.NotEqual(key, AccountKey.Compute("123456789#2"));
        Assert.Matches("^[0-9a-f]{64}$", key);
        Assert.DoesNotContain("123456789", key);
    }

    [Theory]
    [InlineData("123456789#1", "12…#1")]
    [InlineData("MONCOMPTEWOW", "MO…OW")]
    [InlineData("ABC", "…")]
    public void Hint_masks_the_folder_name(string folder, string expected)
    {
        Assert.Equal(expected, AccountKey.Hint(folder));
    }

    [Theory]
    [InlineData(" 123456789#1 ", "123456789#1")]
    [InlineData("MONCOMPTE", "MONCOMPTE")]
    [InlineData("COMPTÉ", null)]
    [InlineData("MON COMPTE", null)]
    public void Full_name_is_kept_only_when_the_server_can_check_it(string folder, string? expected)
    {
        Assert.Equal(expected, AccountKey.FullName(folder));
        Assert.Null(AccountKey.FullName(new string('A', AccountKey.MaxFolderNameLength + 1)));
    }
}

public class StableFileReaderTests
{
    private static readonly StableReadOptions Fast = new() { MaxAttempts = 4, SettleDelay = TimeSpan.Zero };

    private static Task NoDelay(TimeSpan _, CancellationToken __) => Task.CompletedTask;

    [Fact]
    public async Task Stable_file_is_read_without_being_modified()
    {
        using var temp = new TempDirectory();
        var file = temp.Combine("AltBoard.lua");
        File.Copy(Fixture.PathOf("account-two-characters.lua"), file);
        var before = (File.GetLastWriteTimeUtc(file), new FileInfo(file).Length);

        var snapshot = await new StableFileReader(Fast, NoDelay).ReadAsync(file);

        Assert.Equal(Fixture.Bytes("account-two-characters.lua"), snapshot.Content);
        Assert.Equal(before, (File.GetLastWriteTimeUtc(file), new FileInfo(file).Length));
    }

    [Fact]
    public async Task Missing_file_is_reported()
    {
        using var temp = new TempDirectory();

        await Assert.ThrowsAsync<FileNotFoundException>(() => new StableFileReader(Fast, NoDelay).ReadAsync(temp.Combine("absent.lua")));
    }

    [Fact]
    public async Task File_locked_by_the_game_is_reported_after_retries()
    {
        using var temp = new TempDirectory();
        var file = temp.Combine("AltBoard.lua");
        File.WriteAllText(file, "AltBoardDB = {}");
        await using var exclusive = new FileStream(file, FileMode.Open, FileAccess.ReadWrite, FileShare.None);

        var error = await Assert.ThrowsAsync<UnstableFileException>(() => new StableFileReader(Fast, NoDelay).ReadAsync(file));
        Assert.Contains("4 tentatives", error.Message);
    }

    [Fact]
    public async Task File_being_written_is_read_once_it_settles()
    {
        using var temp = new TempDirectory();
        var file = temp.Combine("AltBoard.lua");
        File.WriteAllText(file, "AltBoardDB = {");
        var writes = 0;

        // Pendant les deux premières attentes, le jeu continue d'écrire.
        Task WritingGame(TimeSpan _, CancellationToken __)
        {
            if (writes < 2)
            {
                writes++;
                File.AppendAllText(file, writes == 2 ? "}" : "\r\n[\"schema\"] = 2,\r\n");
            }

            return Task.CompletedTask;
        }

        var snapshot = await new StableFileReader(Fast, WritingGame).ReadAsync(file);

        Assert.Equal("AltBoardDB = {\r\n[\"schema\"] = 2,\r\n}", System.Text.Encoding.UTF8.GetString(snapshot.Content));
    }

    [Fact]
    public async Task File_that_never_settles_is_not_read()
    {
        using var temp = new TempDirectory();
        var file = temp.Combine("AltBoard.lua");
        File.WriteAllText(file, "AltBoardDB = {");

        Task AlwaysWriting(TimeSpan _, CancellationToken __)
        {
            File.AppendAllText(file, "x");
            return Task.CompletedTask;
        }

        await Assert.ThrowsAsync<UnstableFileException>(() => new StableFileReader(Fast, AlwaysWriting).ReadAsync(file));
    }

    [Fact]
    public async Task Reading_does_not_block_a_concurrent_writer()
    {
        using var temp = new TempDirectory();
        var file = temp.Combine("AltBoard.lua");
        File.WriteAllText(file, "AltBoardDB = {}");
        await using var writer = new FileStream(file, FileMode.Open, FileAccess.Write, FileShare.Read);

        var snapshot = await new StableFileReader(Fast, NoDelay).ReadAsync(file);

        Assert.Equal(15, snapshot.Content.Length);
    }

    [Fact]
    public async Task Oversized_file_is_refused()
    {
        using var temp = new TempDirectory();
        var file = temp.Combine("AltBoard.lua");
        File.WriteAllBytes(file, new byte[2048]);

        await Assert.ThrowsAsync<InvalidDataException>(() => new StableFileReader(Fast with { MaxBytes = 1024 }, NoDelay).ReadAsync(file));
    }
}

public class AgentConfigStoreTests
{
    [Fact]
    public void Machine_uuid_is_generated_once_and_persisted()
    {
        using var temp = new TempDirectory();

        var first = new AgentConfigStore(temp.Path).LoadOrCreate();
        var second = new AgentConfigStore(temp.Path).LoadOrCreate();

        Assert.NotEqual(Guid.Empty, first.MachineUuid);
        Assert.Equal(first.MachineUuid, second.MachineUuid);
        Assert.Equal(AccountScanner.DefaultWowPath, second.WowPath);
        Assert.Equal("https://wow.ekreativ.be/api/sync", second.ServerUrl);
        Assert.DoesNotContain("token", File.ReadAllText(temp.Combine("config.json")), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(@"C:\Program Files (x86)\World of Warcraft\_classic_beta_", @"C:\Program Files (x86)\World of Warcraft")]
    [InlineData(@"D:\Jeux\World of Warcraft\_CLASSIC_BETA_\", @"D:\Jeux\World of Warcraft")]
    public void Beta_client_path_is_replaced_by_its_root(string saved, string expected)
    {
        using var temp = new TempDirectory();
        var uuid = Guid.NewGuid();
        new AgentConfigStore(temp.Path).Save(new AgentConfig { MachineUuid = uuid, MachineName = "Salon", WowPath = saved, ServerUrl = "https://exemple.test/api/sync" });

        var loaded = new AgentConfigStore(temp.Path).LoadOrCreate();

        Assert.Equal(expected, loaded.WowPath);
        Assert.Equal(uuid, loaded.MachineUuid);
        Assert.Equal("Salon", loaded.MachineName);
        Assert.Equal("https://exemple.test/api/sync", loaded.ServerUrl);
        // Enregistré, pas seulement appliqué : « config » montre le dossier réellement lu.
        var onDisk = System.Text.Json.JsonSerializer.Deserialize(File.ReadAllText(temp.Combine("config.json")), AgentJsonContext.Default.AgentConfig);
        Assert.Equal(expected, onDisk?.WowPath);
    }

    [Theory]
    [InlineData(@"C:\Program Files (x86)\World of Warcraft\_forever_")]
    [InlineData(@"C:\Program Files (x86)\World of Warcraft")]
    [InlineData(@"D:\Sauvegardes\_classic_beta_copie")]
    [InlineData("_classic_beta_")]
    public void Other_paths_are_kept_as_written(string saved)
    {
        using var temp = new TempDirectory();
        new AgentConfigStore(temp.Path).Save(new AgentConfig { MachineUuid = Guid.NewGuid(), WowPath = saved });
        var written = File.ReadAllText(temp.Combine("config.json"));

        Assert.Equal(saved, new AgentConfigStore(temp.Path).LoadOrCreate().WowPath);
        Assert.Equal(written, File.ReadAllText(temp.Combine("config.json")));
    }

    [Fact]
    public void Corrupted_configuration_never_regenerates_the_uuid_silently()
    {
        using var temp = new TempDirectory();
        File.WriteAllText(temp.Combine("config.json"), "{ pas du json");

        Assert.Throws<InvalidDataException>(() => new AgentConfigStore(temp.Path).LoadOrCreate());
        Assert.Equal("{ pas du json", File.ReadAllText(temp.Combine("config.json")));
    }

    [Fact]
    public void Token_is_stored_encrypted_and_read_back()
    {
        if (!OperatingSystem.IsWindows()) return;
        using var temp = new TempDirectory();
        var store = new TokenStore(temp.Path, _ => null);

        Assert.Null(store.Read());
        store.Save("  wab_jeton-secret-de-test  ");

        Assert.Equal("wab_jeton-secret-de-test", store.Read());
        Assert.DoesNotContain("jeton-secret", System.Text.Encoding.Latin1.GetString(File.ReadAllBytes(store.TokenPath)));
        Assert.True(store.Delete());
        Assert.Null(store.Read());
    }

    [Fact]
    public void Environment_token_takes_precedence()
    {
        using var temp = new TempDirectory();

        Assert.Equal("depuis-env", new TokenStore(temp.Path, name => name == TokenStore.EnvironmentVariable ? " depuis-env " : null).Read());
    }

    [Theory]
    [InlineData("wab_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq", true)]
    [InlineData("wab_0123456789-_ABCDEFGHIJKLMNOPQRSTUVWXYZabcde", true)]
    // Copie tronquée, ou caractère de trop.
    [InlineData("wab_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop", false)]
    [InlineData("wab_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqr", false)]
    // Autre chose qu'un jeton : mot de passe, URL, texte voisin copié avec lui.
    [InlineData("", false)]
    [InlineData("WAB_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq", false)]
    [InlineData("wab_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmno q", false)]
    [InlineData("wab_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmno+/", false)]
    [InlineData("Bearer wab_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijk", false)]
    public void Token_shape_is_the_one_the_server_issues(string token, bool expected)
    {
        Assert.Equal(expected, TokenStore.IsWellFormed(token));
    }
}
