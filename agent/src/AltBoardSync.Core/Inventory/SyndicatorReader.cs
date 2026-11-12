using System.Globalization;
using System.Text.RegularExpressions;
using AltBoardSync.Core.AltBoard;
using AltBoardSync.Core.Lua;
using AltBoardSync.Core.Sync;

namespace AltBoardSync.Core.Inventory;

/// <summary>Un personnage tel que Syndicator le décrit : par son nom, Syndicator ne connaissant pas le GUID.</summary>
public sealed record SyndicatorCharacter(string Name, IReadOnlyList<HoldingPayload> Mail, IReadOnlyList<HoldingPayload> Auctions);

/// <summary>Contenu utile de Syndicator.lua, et la description des objets cités (nom, qualité, icône, lien).</summary>
public sealed record SyndicatorData(IReadOnlyList<SyndicatorCharacter> Characters, IReadOnlyList<GuildBankPayload> Guilds, IReadOnlyList<ItemPayload> Items);

/// <summary>
/// Lit <c>SYNDICATOR_DATA</c>, les données de l'addon Baganator (Syndicator est sa bibliothèque
/// d'inventaire, voir docs/BAGANATOR-DATA-MODEL.md) : courrier, enchères en cours et banques de
/// guilde. Sacs et banque ne sont pas repris : AltBoard les relève déjà, à l'identique.
/// Syndicator désigne un personnage par « Nom-Royaume », sans GUID : le rattachement aux personnages
/// d'AltBoard se fait dans <see cref="PayloadBuilder"/>.
/// </summary>
public static partial class SyndicatorReader
{
    public const int MaxCharacters = 200;
    public const int MaxEntries = 2_000;
    public const int MaxGuilds = 50;
    public const int MaxTabs = 16;
    public const int MaxItemsPerTab = 500;
    private const int MaxLink = 600;
    private const int MaxTabName = 60;
    private const long MaxSafeInteger = 9_007_199_254_740_991;

    // « item:ID:enchantement:gemme1:gemme2:gemme3:gemme4:suffixe:… », comme Data.ItemKey d'AltBoard.
    [GeneratedRegex(@"item:([-\d:]+)", RegexOptions.CultureInvariant)]
    private static partial Regex ItemStringPattern();

    [GeneratedRegex(@"\|h\[(.+?)\]\|h", RegexOptions.CultureInvariant)]
    private static partial Regex LinkNamePattern();

    [GeneratedRegex(@"^\d{1,9}(?::-?\d{1,9})?$", RegexOptions.CultureInvariant)]
    private static partial Regex ItemKeyPattern();

    /// <summary>Null quand le fichier ne contient pas de données Syndicator.</summary>
    public static SyndicatorData? Read(IReadOnlyDictionary<string, LuaValue> globals, List<string> warnings)
    {
        if (!globals.TryGetValue("SYNDICATOR_DATA", out var root) || root.AsTable() is not { } data) return null;

        var context = new Context();
        var characters = new List<SyndicatorCharacter>();
        foreach (var (key, value) in data.Get("Characters")?.AsTable()?.Entries ?? [])
        {
            if (value.AsTable() is not { } character) continue;
            var name = AltBoardReader.Text(character.Get("details")?.AsTable()?.Get("character"), AltBoardReader.MaxName) ?? NameFromKey(key);
            if (name is null) continue;
            if (characters.Count == MaxCharacters)
            {
                warnings.Add($"Baganator : plus de {MaxCharacters} personnages, les suivants sont ignorés.");
                break;
            }

            characters.Add(new SyndicatorCharacter(name, Holdings(character.Get("mail"), context), Holdings(character.Get("auctions"), context)));
        }

        var guilds = new List<GuildBankPayload>();
        foreach (var (key, value) in data.Get("Guilds")?.AsTable()?.Entries ?? [])
        {
            if (value.AsTable() is not { } guild || ReadGuild(key, guild, context) is not { } bank) continue;
            if (guilds.Count == MaxGuilds)
            {
                warnings.Add($"Baganator : plus de {MaxGuilds} banques de guilde, les suivantes sont ignorées.");
                break;
            }

            guilds.Add(bank);
        }

        if (context.Ignored > 0) warnings.Add($"Baganator : {context.Ignored} objets sans identifiant lisible, ignorés.");
        characters.Sort((a, b) => string.CompareOrdinal(a.Name, b.Name));
        guilds.Sort((a, b) => string.CompareOrdinal($"{a.Name}-{a.Realm}", $"{b.Name}-{b.Realm}"));
        return new SyndicatorData(characters, guilds, [.. context.Items.Values.OrderBy(item => item.Key, StringComparer.Ordinal)]);
    }

    /// <summary>
    /// Courrier ou enchères : une ligne par objet, quantités additionnées, échéance la plus proche.
    /// Syndicator garde les cases vides sous forme de tables vides ; elles sont ignorées.
    /// </summary>
    private static IReadOnlyList<HoldingPayload> Holdings(LuaValue? list, Context context)
    {
        var byKey = new Dictionary<string, HoldingPayload>(StringComparer.Ordinal);
        foreach (var (_, value) in list?.AsTable()?.Entries ?? [])
        {
            if (value.AsTable() is not { } entry || ReadEntry(entry, context) is not { } read) continue;
            var (key, count) = read;
            var expiresAt = AltBoardReader.Timestamp(entry.Get("expirationTime"));
            if (byKey.TryGetValue(key, out var known))
            {
                byKey[key] = known with
                {
                    Count = (int)Math.Min(int.MaxValue, (long)known.Count + count),
                    ExpiresAt = known.ExpiresAt is { } a && expiresAt is { } b ? Math.Min(a, b) : known.ExpiresAt ?? expiresAt,
                };
            }
            else if (byKey.Count < MaxEntries)
            {
                byKey[key] = new HoldingPayload(key, count, expiresAt);
            }
        }

        return [.. byKey.Values.OrderBy(holding => holding.Key, StringComparer.Ordinal)];
    }

    private static GuildBankPayload? ReadGuild(LuaKey key, LuaTable guild, Context context)
    {
        var details = guild.Get("details")?.AsTable();
        var fromKey = key.Kind == LuaKeyKind.String ? key.Text : null;
        var separator = fromKey?.LastIndexOf('-') ?? -1;
        var name = AltBoardReader.Text(details?.Get("guild"), AltBoardReader.MaxName) ?? (separator > 0 ? fromKey![..separator] : null);
        var realm = AltBoardReader.Text(details?.Get("realm"), AltBoardReader.MaxName) ?? (separator > 0 ? fromKey![(separator + 1)..] : null);
        if (name is null || string.IsNullOrEmpty(realm)) return null;

        var tabs = new List<GuildBankTabPayload>();
        var bankTabs = guild.Get("bank")?.AsTable()?.Entries ?? [];
        foreach (var (tabKey, value) in bankTabs.OrderBy(e => e.Key.AsInt64() ?? long.MaxValue))
        {
            if (tabKey.AsInt64() is not (>= 1 and <= MaxTabs) || value.AsTable() is not { } tab) continue;
            var counts = new Dictionary<string, int>(StringComparer.Ordinal);
            foreach (var (_, slot) in tab.Get("slots")?.AsTable()?.Entries ?? [])
            {
                if (slot.AsTable() is not { } entry || ReadEntry(entry, context) is not { } read) continue;
                var (itemKey, count) = read;
                if (counts.Count == MaxItemsPerTab && !counts.ContainsKey(itemKey)) continue;
                counts[itemKey] = (int)Math.Min(int.MaxValue, (long)counts.GetValueOrDefault(itemKey) + count);
            }

            tabs.Add(new GuildBankTabPayload(
                (int)tabKey.AsInt64()!.Value,
                AltBoardReader.Text(tab.Get("name"), MaxTabName),
                [.. counts.OrderBy(c => c.Key, StringComparer.Ordinal).Select(c => new ItemCountPayload(c.Key, c.Value))]));
        }

        var money = guild.Get("money")?.AsInt64() is >= 0 and <= MaxSafeInteger and var copper ? copper : (long?)null;
        // Banque jamais ouverte : rien à montrer.
        return tabs.Count == 0 && money is null or 0 ? null : new GuildBankPayload(name, realm, money, tabs);
    }

    /// <summary>Clé et quantité d'une case, et l'objet décrit au passage ; null pour une case vide ou illisible.</summary>
    private static (string Key, int Count)? ReadEntry(LuaTable entry, Context context)
    {
        var link = AltBoardReader.Text(entry.Get("itemLink"), MaxLink);
        var itemId = entry.Get("itemID")?.AsInt32();
        if (link is null && itemId is null) return null;
        var key = ItemKey(link, itemId);
        var count = entry.Get("itemCount")?.AsInt32() ?? 1;
        if (key is null || count < 1)
        {
            context.Ignored++;
            return null;
        }

        if (!context.Items.ContainsKey(key))
        {
            var separator = key.IndexOf(':');
            context.Items[key] = new ItemPayload(
                key,
                int.Parse(separator < 0 ? key : key[..separator], CultureInfo.InvariantCulture),
                separator < 0 ? null : int.Parse(key[(separator + 1)..], CultureInfo.InvariantCulture),
                link is not null && LinkNamePattern().Match(link) is { Success: true } name ? Truncate(name.Groups[1].Value, AltBoardReader.MaxName) : null,
                AltBoardReader.Small(entry.Get("quality")),
                entry.Get("iconTexture")?.AsInt32() is > 0 and var icon ? icon : null,
                link);
        }

        return (key, count);
    }

    /// <summary>« ID », ou « ID:suffixe » pour un objet à suffixe aléatoire (« de l'ours »), comme AltBoard.</summary>
    public static string? ItemKey(string? link, int? itemId)
    {
        if (link is not null && ItemStringPattern().Match(link) is { Success: true } match)
        {
            var fields = match.Groups[1].Value.Split(':');
            var suffix = fields.Length > 6 ? fields[6] : "";
            var key = suffix is "" or "0" ? fields[0] : $"{fields[0]}:{suffix}";
            if (ItemKeyPattern().IsMatch(key) && fields[0] != "0") return key;
        }

        return itemId is > 0 and <= 999_999_999 ? itemId.Value.ToString(CultureInfo.InvariantCulture) : null;
    }

    private static string? NameFromKey(LuaKey key)
    {
        if (key.Kind != LuaKeyKind.String || key.Text is not { } text) return null;
        var separator = text.LastIndexOf('-');
        return separator > 0 ? Truncate(text[..separator], AltBoardReader.MaxName) : null;
    }

    private static string Truncate(string text, int maxLength) =>
        text.Length <= maxLength ? text : text[..(char.IsHighSurrogate(text[maxLength - 1]) ? maxLength - 1 : maxLength)];

    private sealed class Context
    {
        public Dictionary<string, ItemPayload> Items { get; } = new(StringComparer.Ordinal);
        public int Ignored { get; set; }
    }
}
