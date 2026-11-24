using System.Text.RegularExpressions;
using AltBoardSync.Core.Lua;
using AltBoardSync.Core.Sync;

namespace AltBoardSync.Core.AltBoard;

public sealed class AltBoardFormatException(string message) : Exception(message);

public sealed record AltBoardDocument(
    int? Schema,
    IReadOnlyList<CharacterPayload> Characters,
    IReadOnlyList<ItemPayload> Items,
    IReadOnlyList<string> Warnings)
{
    /// <summary>Erreurs Lua gardées par l'addon (<c>errors</c>), les plus anciennes d'abord ; null si le fichier n'en a pas de liste.</summary>
    public IReadOnlyList<AddonErrorPayload>? AddonErrors { get; init; }
}

/// <summary>
/// Convertit <c>AltBoardDB</c> (structure documentée dans docs/ALTBOARD-DATA-MODEL.md) vers le modèle
/// de synchronisation. Tolérant : un champ absent, mal typé ou inconnu produit un avertissement,
/// jamais un échec ; seul un personnage sans identité exploitable est écarté.
/// </summary>
public static partial class AltBoardReader
{
    public const string GlobalName = "AltBoardDB";
    public const int SupportedSchema = 2;

    internal const int MaxName = 120;
    private const int MaxLink = 600;
    private const int MaxWarnings = 50;
    private const int MaxWarningLength = 300;

    private static readonly HashSet<string> KnownRootKeys =
        ["schema", "chars", "items", "errors", "order", "settings", "launcher", "window", "itemsWindow", "probe"];

    private static readonly HashSet<string> KnownCharacterKeys =
    [
        "name", "realm", "class", "race", "faction", "level", "xp", "xpMax", "rested", "guild", "zone", "money",
        "ilvl", "lastSeen", "hidden", "stats", "statsAt", "gear", "profs", "reps", "currency", "bags", "bagSlots",
        "bagsAt", "bank", "bankSlots", "bankAt",
    ];

    [GeneratedRegex(@"^[A-Za-z0-9-]{1,64}$")]
    private static partial Regex GuidPattern();

    [GeneratedRegex(@"^(\d{1,9})(?::(-?\d{1,9}))?$")]
    private static partial Regex ItemKeyPattern();

    // "item:ID:enchant:..." : le premier champ est l'objet, le deuxième l'enchantement.
    [GeneratedRegex(@"item:(\d{1,9}):(\d{0,9})")]
    private static partial Regex ItemLinkPattern();

    [GeneratedRegex(@"\p{Cc}+")]
    private static partial Regex ControlCharacters();

    // L'addon garde les 10 dernières erreurs, message limité à 400 caractères.
    private const int MaxAddonErrors = 10;
    private const int MaxErrorWhere = 80;
    private const int MaxErrorMessage = 400;
    private const int MaxErrorVersion = 40;

    public static AltBoardDocument Read(IReadOnlyDictionary<string, LuaValue> globals)
    {
        if (!globals.TryGetValue(GlobalName, out var root))
            throw new AltBoardFormatException($"{GlobalName} est absente du fichier");
        if (root is not LuaTable db)
            throw new AltBoardFormatException($"{GlobalName} n'est pas une table");

        var warnings = new Warnings();

        foreach (var (key, _) in db.Entries)
        {
            if (key.Kind != LuaKeyKind.String || !KnownRootKeys.Contains(key.Text!))
                warnings.Add($"clé racine inconnue ignorée : {key}");
        }

        var schema = db.Get("schema")?.AsInt32();
        if (schema is null) warnings.Add("version de schéma AltBoard absente");
        else if (schema != SupportedSchema) warnings.Add($"version de schéma AltBoard inconnue ({schema}) : lecture au mieux");

        var characters = new List<CharacterPayload>();
        if (db.Get("chars") is LuaTable chars)
        {
            foreach (var (key, value) in chars.Entries)
            {
                var character = ReadCharacter(key, value, warnings);
                if (character is not null) characters.Add(character);
            }
        }
        else if (db.Get("chars") is not null)
        {
            warnings.Add("chars n'est pas une table : aucun personnage lu");
        }

        var items = new List<ItemPayload>();
        if (db.Get("items") is LuaTable itemTable)
        {
            foreach (var (key, value) in itemTable.Entries)
            {
                var item = ReadItem(key, value, warnings);
                if (item is not null) items.Add(item);
            }
        }

        var addonErrors = ReadErrors(db.Get("errors"), warnings);

        // Ordre déterministe : le client réécrit ses tables dans un ordre variable.
        characters.Sort((a, b) => string.CompareOrdinal(a.Guid, b.Guid));
        items.Sort((a, b) => string.CompareOrdinal(a.Key, b.Key));
        return new AltBoardDocument(schema, characters, items, warnings.ToList()) { AddonErrors = addonErrors };
    }

    /// <summary>
    /// Erreurs Lua que l'addon garde (<c>{ t, where, msg, v }</c>), des plus anciennes aux plus récentes,
    /// les 10 dernières au plus. Liste vide si l'addon n'en garde aucune ; null si la liste est absente.
    /// </summary>
    private static List<AddonErrorPayload>? ReadErrors(LuaValue? value, Warnings warnings)
    {
        if (value is null) return null;
        if (value is not LuaTable table)
        {
            warnings.Add("errors n'est pas une table : erreurs de l'addon non transmises");
            return null;
        }

        var errors = new List<AddonErrorPayload>();
        var invalid = 0;
        foreach (var (_, entry) in table.Entries)
        {
            if (entry is not LuaTable error
                || PayloadLimits.Timestamp(error.Get("t")?.AsInt64()) is not { } at
                || ErrorText(error.Get("where"), MaxErrorWhere) is not { } where
                || ErrorText(error.Get("msg"), MaxErrorMessage) is not { } message)
            {
                invalid++;
                continue;
            }

            errors.Add(new AddonErrorPayload(at, where, message, ErrorText(error.Get("v"), MaxErrorVersion)));
        }

        if (invalid > 0) warnings.Add($"erreurs de l'addon : {invalid} entrées invalides ignorées");
        // OrderBy est stable : deux erreurs de la même seconde gardent l'ordre de l'addon.
        return errors.OrderBy(error => error.At).TakeLast(MaxAddonErrors).ToList();
    }

    /// <summary>
    /// Texte d'une erreur : caractères de contrôle (sauts de ligne d'une pile d'appels…) remplacés par
    /// une espace, bords rognés, raccourci ; null s'il ne reste rien.
    /// </summary>
    private static string? ErrorText(LuaValue? value, int maxLength)
    {
        if (value?.AsString() is not { } raw) return null;
        var text = ControlCharacters().Replace(raw, " ").Trim();
        return text.Length == 0 ? null : Truncate(text, maxLength).TrimEnd();
    }

    private static CharacterPayload? ReadCharacter(LuaKey key, LuaValue value, Warnings warnings)
    {
        if (key.Kind != LuaKeyKind.String || !GuidPattern().IsMatch(key.Text!))
        {
            warnings.Add("personnage ignoré : identifiant (GUID) invalide");
            return null;
        }

        var guid = key.Text!;
        if (value is not LuaTable c)
        {
            warnings.Add($"personnage {guid} ignoré : valeur inattendue");
            return null;
        }

        var name = Text(c.Get("name"), MaxName);
        // Depuis le build 71037 de WoW Forever (2026-11-21), le jeu ne donne plus le royaume : l'addon
        // enregistre "". Le personnage est transmis quand même, royaume vide ; le site le déduit du
        // GUID (serveur « Player-6947-… ») et des personnages qu'il connaît déjà.
        var realm = Text(c.Get("realm"), MaxName) ?? "";
        var lastSeen = Timestamp(c.Get("lastSeen"));
        if (name is null || lastSeen is null)
        {
            // L'addon lui-même ignore un personnage sans nom (entrée créée avant la première collecte).
            warnings.Add($"personnage {guid} ignoré : nom ou lastSeen absent");
            return null;
        }

        foreach (var (fieldKey, _) in c.Entries)
        {
            if (fieldKey.Kind != LuaKeyKind.String || !KnownCharacterKeys.Contains(fieldKey.Text!))
                warnings.Add($"champ de personnage inconnu ignoré : {fieldKey}");
        }

        return new CharacterPayload
        {
            Guid = guid,
            Name = name,
            Realm = realm,
            LastSeen = lastSeen.Value,
            Class = Text(c.Get("class"), MaxName),
            Race = Text(c.Get("race"), MaxName),
            Faction = Text(c.Get("faction"), MaxName),
            Level = Small(c.Get("level")),
            Xp = NonNegative(c.Get("xp")?.AsInt32()),
            XpMax = NonNegative(c.Get("xpMax")?.AsInt32()),
            RestedXp = NonNegative(c.Get("rested")?.AsInt32()),
            Guild = Text(c.Get("guild"), MaxName),
            Zone = Text(c.Get("zone"), MaxName),
            MoneyCopper = Money(c.Get("money")),
            ItemLevel = c.Get("ilvl")?.AsDouble(),
            Hidden = c.Get("hidden")?.AsBoolean() ?? false,
            Stats = ReadStats(c.Get("stats")?.AsTable()),
            StatsAt = Timestamp(c.Get("statsAt")),
            Gear = ReadGear(c.Get("gear")?.AsTable()),
            Professions = ReadProfessions(c.Get("profs")?.AsTable(), guid, warnings),
            Reputations = ReadReputations(c.Get("reps")?.AsTable()),
            Currencies = ReadCurrencies(c.Get("currency")?.AsTable()),
            Bags = ReadContainer(c, "bags", "bagSlots", "bagsAt"),
            Bank = ReadContainer(c, "bank", "bankSlots", "bankAt"),
        };
    }

    private static StatsPayload? ReadStats(LuaTable? s)
    {
        if (s is null) return null;
        var res = s.Get("res")?.AsTable();
        return new StatsPayload
        {
            Strength = s.Get("str")?.AsInt32(),
            Agility = s.Get("agi")?.AsInt32(),
            Stamina = s.Get("sta")?.AsInt32(),
            Intellect = s.Get("int")?.AsInt32(),
            Spirit = s.Get("spi")?.AsInt32(),
            Armor = s.Get("armor")?.AsInt32(),
            Health = s.Get("health")?.AsInt32(),
            Power = s.Get("power")?.AsInt32(),
            PowerType = Text(s.Get("powerType"), MaxName),
            AttackPower = s.Get("ap")?.AsInt32(),
            RangedAttackPower = s.Get("rap")?.AsInt32(),
            Crit = s.Get("crit")?.AsDouble(),
            RangedCrit = s.Get("rcrit")?.AsDouble(),
            Hit = s.Get("hit")?.AsDouble(),
            Dodge = s.Get("dodge")?.AsDouble(),
            Parry = s.Get("parry")?.AsDouble(),
            Block = s.Get("block")?.AsDouble(),
            Defense = s.Get("defense")?.AsInt32(),
            SpellPower = s.Get("sp")?.AsInt32(),
            SpellCrit = s.Get("scrit")?.AsDouble(),
            Healing = s.Get("heal")?.AsInt32(),
            SpellHit = s.Get("shit")?.AsDouble(),
            // Index 2 à 6 : feu, nature, givre, ombre, arcane (Data.lua de l'addon).
            ResFire = res?.Get(2)?.AsInt32(),
            ResNature = res?.Get(3)?.AsInt32(),
            ResFrost = res?.Get(4)?.AsInt32(),
            ResShadow = res?.Get(5)?.AsInt32(),
            ResArcane = res?.Get(6)?.AsInt32(),
        };
    }

    private static List<GearPayload> ReadGear(LuaTable? gear)
    {
        var result = new List<GearPayload>();
        if (gear is null) return result;

        foreach (var (key, value) in gear.Entries)
        {
            // Emplacements d'inventaire 1 à 19 (tête … tabard).
            var slot = key.AsInt64();
            if (slot is null or < 1 or > 19 || value is not LuaTable g) continue;
            var link = Text(g.Get("link"), MaxLink);
            var (itemId, enchantId) = ParseItemLink(link);
            result.Add(new GearPayload(
                (int)slot.Value,
                itemId,
                enchantId,
                Text(g.Get("name"), MaxName),
                Small(g.Get("q")),
                g.Get("ilvl")?.AsInt32(),
                g.Get("icon")?.AsInt32(),
                link));
        }

        result.Sort((a, b) => a.Slot.CompareTo(b.Slot));
        return result;
    }

    private static List<ProfessionPayload> ReadProfessions(LuaTable? profs, string guid, Warnings warnings)
    {
        var result = new List<ProfessionPayload>();
        if (profs is null) return result;

        var seen = new HashSet<int>();
        foreach (var (_, value) in profs.Entries.OrderBy(e => e.Key.AsInt64() ?? long.MaxValue))
        {
            if (value is not LuaTable p) continue;
            var name = Text(p.Get("name"), MaxName);
            var skillLine = NonNegative(p.Get("skillLine")?.AsInt32());
            if (name is null || skillLine is null || !seen.Add(skillLine.Value))
            {
                warnings.Add($"métier ignoré pour {guid} : nom ou skillLine absent, ou doublon");
                continue;
            }

            result.Add(new ProfessionPayload(
                skillLine.Value,
                name,
                p.Get("rank")?.AsInt32(),
                p.Get("max")?.AsInt32(),
                p.Get("primary")?.AsBoolean() ?? false,
                p.Get("icon")?.AsInt32()));
        }

        return result;
    }

    private static List<ReputationPayload> ReadReputations(LuaTable? reps)
    {
        var result = new List<ReputationPayload>();
        if (reps is null) return result;

        foreach (var (key, value) in reps.Entries)
        {
            var factionId = key.AsInt64();
            if (factionId is null or <= 0 or > int.MaxValue || value is not LuaTable r) continue;
            var name = Text(r.Get("name"), MaxName);
            if (name is null) continue;
            result.Add(new ReputationPayload(
                (int)factionId.Value,
                name,
                Text(r.Get("group"), MaxName),
                Small(r.Get("reaction")),
                r.Get("cur")?.AsInt32(),
                r.Get("min")?.AsInt32(),
                r.Get("max")?.AsInt32()));
        }

        result.Sort((a, b) => a.FactionId.CompareTo(b.FactionId));
        return result;
    }

    private static List<CurrencyPayload> ReadCurrencies(LuaTable? currency)
    {
        var result = new List<CurrencyPayload>();
        if (currency is null) return result;

        foreach (var (key, value) in currency.Entries)
        {
            if (key.Kind != LuaKeyKind.String || value is not LuaTable cur) continue;
            var name = Truncate(key.Text!.Replace(" ", ""), MaxName);
            var quantity = NonNegative(cur.Get("qty")?.AsInt32());
            if (name.Length == 0 || quantity is null) continue;
            result.Add(new CurrencyPayload(name, quantity.Value, cur.Get("max")?.AsInt32(), cur.Get("icon")?.AsInt32()));
        }

        result.Sort((a, b) => string.CompareOrdinal(a.Name, b.Name));
        return result;
    }

    /// <summary>Sacs ou banque. Absent tant que l'addon n'a jamais daté ce bloc (banque jamais ouverte).</summary>
    private static ContainerPayload? ReadContainer(LuaTable c, string itemsKey, string slotsKey, string atKey)
    {
        var at = Timestamp(c.Get(atKey));
        if (at is null || c.Get(itemsKey) is not LuaTable counts) return null;

        var items = new List<ItemCountPayload>();
        foreach (var (key, value) in counts.Entries)
        {
            var itemKey = key.ToString();
            var count = NonNegative(value.AsInt32());
            if (!ItemKeyPattern().IsMatch(itemKey) || count is null) continue;
            items.Add(new ItemCountPayload(itemKey, count.Value));
        }

        items.Sort((a, b) => string.CompareOrdinal(a.Key, b.Key));
        var slots = c.Get(slotsKey)?.AsTable();
        return new ContainerPayload(at.Value, Small(slots?.Get("used")), Small(slots?.Get("total")), items);
    }

    private static ItemPayload? ReadItem(LuaKey key, LuaValue value, Warnings warnings)
    {
        var itemKey = key.ToString();
        var match = ItemKeyPattern().Match(itemKey);
        if (!match.Success || value is not LuaTable item)
        {
            warnings.Add("objet du référentiel ignoré : clé ou valeur inattendue");
            return null;
        }

        return new ItemPayload(
            itemKey,
            int.Parse(match.Groups[1].ValueSpan),
            match.Groups[2].Success ? int.Parse(match.Groups[2].ValueSpan) : null,
            Text(item.Get("n"), MaxName),
            Small(item.Get("q")),
            item.Get("i")?.AsInt32(),
            Text(item.Get("l"), MaxLink));
    }

    internal static (int? ItemId, int? EnchantId) ParseItemLink(string? link)
    {
        if (link is null) return (null, null);
        var match = ItemLinkPattern().Match(link);
        if (!match.Success) return (null, null);
        var itemId = int.Parse(match.Groups[1].ValueSpan);
        var enchantId = match.Groups[2].Length > 0 ? int.Parse(match.Groups[2].ValueSpan) : 0;
        return (itemId, enchantId > 0 ? enchantId : null);
    }

    internal static string? Text(LuaValue? value, int maxLength)
    {
        // PostgreSQL refuse l'octet nul dans un texte.
        var text = value?.AsString()?.Replace(" ", "");
        if (string.IsNullOrWhiteSpace(text)) return null;
        return Truncate(text, maxLength);
    }

    private static string Truncate(string text, int maxLength)
    {
        if (text.Length <= maxLength) return text;
        // Ne pas couper une paire de substitution UTF-16 en deux.
        var length = char.IsHighSurrogate(text[maxLength - 1]) ? maxLength - 1 : maxLength;
        return text[..length];
    }

    internal static int? NonNegative(int? value) => value is >= 0 ? value : null;

    // Bornes identiques à celles du serveur (web/src/lib/sync/schema.ts) : une valeur aberrante est
    // écartée ici plutôt que de faire refuser tout le document.
    private const long MaxTimestamp = 32_503_680_000; // an 3000
    private const long MaxSafeInteger = 9_007_199_254_740_991;

    internal static long? Timestamp(LuaValue? value) => value?.AsInt64() is > 0 and <= MaxTimestamp and var seconds ? seconds : null;

    private static long? Money(LuaValue? value) => value?.AsInt64() is >= 0 and <= MaxSafeInteger and var copper ? copper : null;

    internal static int? Small(LuaValue? value) => value?.AsInt32() is >= 0 and <= short.MaxValue and var small ? small : null;

    private sealed class Warnings
    {
        private readonly List<string> _list = [];
        private readonly HashSet<string> _seen = [];

        public void Add(string message)
        {
            if (message.Length > MaxWarningLength) message = message[..MaxWarningLength];
            if (_list.Count < MaxWarnings && _seen.Add(message)) _list.Add(message);
        }

        public List<string> ToList() => _list;
    }
}
