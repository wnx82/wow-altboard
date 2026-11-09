using System.Buffers.Binary;
using System.Text;
using AltBoardSync.Core.Discovery;
using AltBoardSync.Core.Economy;
using AltBoardSync.Core.IO;
using AltBoardSync.Core.Sync;

namespace AltBoardSync.Tests;

/// <summary>Cache du jeu factice, au format « XFTH » version 9 (voir <see cref="ItemNameCache"/>).</summary>
internal static class DbCacheFile
{
    public const uint OtherTable = 0x12345678;

    public static byte[] Build(int build, params (uint Table, int Id, bool Valid, byte[] Data)[] records)
    {
        using var stream = new MemoryStream();
        var header = new byte[44];
        "XFTH"u8.CopyTo(header);
        BinaryPrimitives.WriteInt32LittleEndian(header.AsSpan(4), 9);
        BinaryPrimitives.WriteInt32LittleEndian(header.AsSpan(8), build);
        stream.Write(header);
        foreach (var (table, id, valid, data) in records)
        {
            var record = new byte[32];
            "XFTH"u8.CopyTo(record);
            BinaryPrimitives.WriteInt32LittleEndian(record.AsSpan(4), 1);
            BinaryPrimitives.WriteUInt32LittleEndian(record.AsSpan(16), table);
            BinaryPrimitives.WriteInt32LittleEndian(record.AsSpan(20), id);
            BinaryPrimitives.WriteInt32LittleEndian(record.AsSpan(24), data.Length);
            record[28] = valid ? (byte)1 : (byte)3;
            stream.Write(record);
            stream.Write(data);
        }

        return stream.ToArray();
    }

    /// <summary>Données d'un enregistrement ItemSparse : quatre chaînes, le nom affiché, puis des champs binaires.</summary>
    public static byte[] Item(string name, string description = "") =>
        [.. Encoding.UTF8.GetBytes($"{description}\0\0\0\0{name}\0"), 0x01, 0x02, 0x00, 0x03];

    public static (uint, int, bool, byte[]) Name(int id, string name) => (ItemNameCache.ItemSparseHash, id, true, Item(name));

    /// <summary>Écrit le cache et la langue du client sous un dossier de client factice.</summary>
    public static string Write(string flavorPath, byte[] content, string locale = "frFR")
    {
        var directory = Path.Combine(flavorPath, "Cache", "ADB", locale);
        Directory.CreateDirectory(directory);
        Directory.CreateDirectory(Path.Combine(flavorPath, "WTF"));
        File.WriteAllText(Path.Combine(flavorPath, "WTF", "Config.wtf"), $"SET gxApi \"D3D12\"\r\nSET textLocale \"{locale}\"\r\n");
        var path = Path.Combine(directory, ItemNameCache.FileName);
        File.WriteAllBytes(path, content);
        return path;
    }
}

public class ItemNameCacheTests
{
    [Fact]
    public void Names_come_from_item_sparse_records_and_the_last_record_wins()
    {
        var data = ItemNameCache.Parse(DbCacheFile.Build(
            70862,
            DbCacheFile.Name(720, "Masque de bandit"),
            (DbCacheFile.OtherTable, 721, true, DbCacheFile.Item("Pas un objet")),
            DbCacheFile.Name(13345, "Ancien nom"),
            DbCacheFile.Name(13345, "Nom corrigé"),
            DbCacheFile.Name(500, "Objet retiré"),
            (ItemNameCache.ItemSparseHash, 500, false, []),
            (ItemNameCache.ItemSparseHash, 600, true, DbCacheFile.Item("")),
            (ItemNameCache.ItemSparseHash, 601, true, "\0\0sans fin"u8.ToArray()),
            (ItemNameCache.ItemSparseHash, 602, true, [0, 0, 0, 0, 0xFF, 0xFE, 0]),
            DbCacheFile.Name(18726, "  Étoffe runique  ")));

        Assert.Equal(70862, data.Build);
        Assert.Equal(
            [new ItemNamePayload(720, "Masque de bandit"), new ItemNamePayload(13345, "Nom corrigé"), new ItemNamePayload(18726, "Étoffe runique")],
            data.Names);
    }

    [Fact]
    public void Another_format_or_version_or_a_truncated_record_is_refused()
    {
        Assert.Throws<InvalidDataException>(() => ItemNameCache.Parse("WDBC0000000000000000000000000000000000000000"u8));
        var other = DbCacheFile.Build(1);
        BinaryPrimitives.WriteInt32LittleEndian(other.AsSpan(4), 8);
        Assert.Contains("version 8", Assert.Throws<InvalidDataException>(() => ItemNameCache.Parse(other)).Message);

        var full = DbCacheFile.Build(1, DbCacheFile.Name(720, "Masque de bandit"));
        Assert.Throws<InvalidDataException>(() => ItemNameCache.Parse(full.AsSpan(0, full.Length - 3)));
        Assert.Empty(ItemNameCache.Parse(DbCacheFile.Build(1)).Names);
    }

    [Fact]
    public void The_cache_of_the_client_language_is_found()
    {
        using var temp = new TempDirectory();
        var flavor = temp.Combine("_forever_");
        Assert.Null(ItemNameCache.Find(flavor));

        var french = DbCacheFile.Write(flavor, DbCacheFile.Build(1));
        Assert.Equal((french, "frFR"), ItemNameCache.Find(flavor));

        // Deux langues : celle de Config.wtf. Sans Config.wtf, aucune n'est choisie.
        DbCacheFile.Write(flavor, DbCacheFile.Build(1), "enUS");
        Assert.Equal("enUS", ItemNameCache.Find(flavor)!.Value.Locale);
        File.Delete(Path.Combine(flavor, "WTF", "Config.wtf"));
        Assert.Null(ItemNameCache.Find(flavor));
        Directory.Delete(Path.Combine(flavor, "Cache", "ADB", "enUS"), recursive: true);
        Assert.Equal((french, "frFR"), ItemNameCache.Find(flavor));
    }

    [Fact]
    public async Task The_payload_builder_reads_the_cache_once_per_change()
    {
        using var temp = new TempDirectory();
        var flavor = temp.Combine("_forever_");
        temp.AddAccount(flavor, "111111111#1", "account-two-characters.lua");
        var cache = DbCacheFile.Write(flavor, DbCacheFile.Build(70862, DbCacheFile.Name(720, "Masque de bandit")));
        var builder = new PayloadBuilder(new StableFileReader(new StableReadOptions { SettleDelay = TimeSpan.Zero }));
        var (name, path) = Assert.Single(PayloadBuilder.Flavors(AccountScanner.Scan(flavor)));
        Assert.Equal("_forever_", name);

        var read = (await builder.ReadItemNamesAsync(name, path, knownHash: null))!;
        Assert.Null(read.Error);
        var payload = read.Payload!;
        Assert.Equal(("_forever_", "frFR", 70862), (payload.Flavor, payload.Locale, payload.Build));
        Assert.Equal([new ItemNamePayload(720, "Masque de bandit")], payload.Names);
        Assert.Equal(read.FileHash, payload.File.Hash);

        // Même empreinte que le dernier envoi : rien à renvoyer.
        var unchanged = (await builder.ReadItemNamesAsync(name, path, read.FileHash))!;
        Assert.Equal((read.FileHash, (ItemNamesPayload?)null, (string?)null), (unchanged.FileHash, unchanged.Payload, unchanged.Error));

        // Fichier d'un autre format : avertissement, aucune exception.
        File.WriteAllText(cache, "pas un cache");
        var broken = (await builder.ReadItemNamesAsync(name, path, read.FileHash))!;
        Assert.Null(broken.FileHash);
        Assert.StartsWith("cache du jeu illisible", broken.Error);

        Assert.Null(await builder.ReadItemNamesAsync("_classic_beta_", temp.Combine("_classic_beta_"), null));
    }
}
