using AltBoardSync.Core.Lua;
using AltBoardSync.Core.Sync;

namespace AltBoardSync.Core.AltBoard;

/// <summary>Ce que Ledger sait d'un personnage : temps de jeu par niveau, sessions et finances par jour.</summary>
public sealed record LedgerCharacter(PlaytimePayload? Playtime, IReadOnlyList<SessionPayload> Sessions, IReadOnlyList<LedgerDayPayload> Finances);

/// <summary>
/// Lit ce qu'enregistre l'addon Allemano Ledger (structure documentée dans
/// docs/LEDGER-DATA-MODEL.md) : <c>AllemanoLedgerDB.chars[guid]</c>, mêmes GUID qu'AltBoard.
/// Sont lus <c>played</c>, <c>levelStart</c>, <c>levelLog</c> (temps de jeu), <c>history</c> et
/// <c>current</c> (sessions : dates, durée, expérience), et <c>days</c> (or gagné et dépensé par jour
/// et par source). Les « runs » d'instance, la réputation et les objets ramassés ne sont pas transmis.
/// </summary>
public static class LedgerReader
{
    public const string GlobalName = "AllemanoLedgerDB";

    private const int MaxLevels = 200;
    // L'addon garde 50 sessions par personnage, plus celle en cours.
    private const int MaxSessions = 60;
    private const int MaxTag = 40;
    // L'addon garde 800 jours par personnage.
    private const int MaxDays = 800;

    /// <summary>Sources de revenus de l'addon (<c>Ledger.IN</c>) ; une source inconnue est comptée dans « other ».</summary>
    public static readonly IReadOnlyList<string> IncomeSources = ["loot", "vendor", "quest", "ah", "mail", "trade", "other"];

    /// <summary>Sources de dépenses de l'addon (<c>Ledger.OUT</c>) ; une source inconnue est comptée dans « other ».</summary>
    public static readonly IReadOnlyList<string> ExpenseSources = ["repair", "vendor", "training", "travel", "ah", "mail", "trade", "other"];

    /// <summary>Données par GUID. Vide si l'addon n'a encore rien enregistré.</summary>
    public static IReadOnlyDictionary<string, LedgerCharacter> Read(IReadOnlyDictionary<string, LuaValue> globals, ICollection<string> warnings)
    {
        var result = new Dictionary<string, LedgerCharacter>(StringComparer.Ordinal);
        if (!globals.TryGetValue(GlobalName, out var root)) return result;
        if (root is not LuaTable db)
        {
            warnings.Add($"{GlobalName} n'est pas une table : temps de jeu non transmis");
            return result;
        }

        if (db.Get("chars") is not LuaTable chars) return result;
        foreach (var (key, value) in chars.Entries)
        {
            if (key.Kind != LuaKeyKind.String || value is not LuaTable character) continue;
            var playtime = ReadPlaytime(character);
            var sessions = ReadSessions(character);
            var finances = ReadDays(character);
            if (playtime is not null || sessions.Count > 0 || finances.Count > 0) result[key.Text!] = new LedgerCharacter(playtime, sessions, finances);
        }

        return result;
    }

    private static PlaytimePayload? ReadPlaytime(LuaTable character)
    {
        var played = character.Get("played")?.AsTable();
        var total = AltBoardReader.NonNegative(played?.Get("total")?.AsInt32());
        // Une mesure sans date n'est pas comparable à celle d'un autre PC : elle est écartée.
        var measuredAt = AltBoardReader.Timestamp(played?.Get("at"));
        if (measuredAt is null) total = null;

        CurrentLevelPayload? current = null;
        if (character.Get("levelStart") is LuaTable start && AltBoardReader.Small(start.Get("level")) is { } level)
        {
            current = new CurrentLevelPayload(
                level,
                AltBoardReader.NonNegative(start.Get("playedTotal")?.AsInt32()),
                AltBoardReader.Timestamp(start.Get("wallStart")));
        }

        var levels = new List<LevelTimePayload>();
        if (character.Get("levelLog") is LuaTable log)
        {
            foreach (var (key, value) in log.Entries)
            {
                // La clé est le niveau quitté : numérique, ou chaîne si le client l'a écrite ainsi.
                var logLevel = key.AsInt64() ?? (long.TryParse(key.Text, out var parsed) ? parsed : null);
                if (logLevel is null or < 0 or > short.MaxValue || value is not LuaTable entry) continue;
                levels.Add(new LevelTimePayload(
                    (int)logLevel.Value,
                    AltBoardReader.NonNegative(entry.Get("played")?.AsInt32()),
                    AltBoardReader.NonNegative(entry.Get("wall")?.AsInt32()),
                    AltBoardReader.Timestamp(entry.Get("reached")),
                    AltBoardReader.Text(entry.Get("zone"), AltBoardReader.MaxName)));
            }
        }

        levels.Sort((a, b) => a.Level.CompareTo(b.Level));
        if (levels.Count > MaxLevels) levels.RemoveRange(0, levels.Count - MaxLevels);

        if (total is null && current is null && levels.Count == 0) return null;
        return new PlaytimePayload(total, total is null ? null : measuredAt, current, levels);
    }

    /// <summary>Sessions terminées (<c>history</c>) puis session en cours (<c>current</c>), de la plus ancienne à la plus récente.</summary>
    private static List<SessionPayload> ReadSessions(LuaTable character)
    {
        // Le début identifie la session : il ne change pas quand la session en cours est archivée.
        var sessions = new Dictionary<long, SessionPayload>();
        if (character.Get("history") is LuaTable history)
        {
            foreach (var (_, value) in history.Entries)
            {
                // Un « run » d'instance recoupe la session qui le contient : le compter doublerait l'expérience.
                if (value is not LuaTable entry || entry.Get("kind")?.AsString() == "run") continue;
                if (AltBoardReader.Timestamp(entry.Get("start")) is not { } start) continue;
                sessions[start] = new SessionPayload(
                    start,
                    AltBoardReader.Timestamp(entry.Get("stop")),
                    AltBoardReader.NonNegative(entry.Get("duration")?.AsInt32()),
                    AltBoardReader.NonNegative(entry.Get("xpGained")?.AsInt32()),
                    AltBoardReader.Small(entry.Get("levels")),
                    AltBoardReader.Text(entry.Get("zone"), AltBoardReader.MaxName),
                    AltBoardReader.Text(entry.Get("tag"), MaxTag),
                    InProgress: false);
            }
        }

        if (character.Get("current") is LuaTable current && AltBoardReader.Timestamp(current.Get("start")) is { } currentStart)
        {
            var lastSeen = AltBoardReader.Timestamp(current.Get("lastSeen"));
            // Une session terminée de même début fait foi : l'addon l'a déjà close.
            sessions.TryAdd(currentStart, new SessionPayload(
                currentStart,
                lastSeen,
                OnlineSeconds(current, currentStart, lastSeen),
                AltBoardReader.NonNegative(current.Get("xpGained")?.AsInt32()),
                AltBoardReader.Small(current.Get("level")) is { } level && AltBoardReader.Small(current.Get("startLevel")) is { } startLevel && level >= startLevel
                    ? level - startLevel
                    : null,
                AltBoardReader.Text(current.Get("zone"), AltBoardReader.MaxName),
                AltBoardReader.Text(current.Get("tag"), MaxTag) ?? AltBoardReader.Text(current.Get("autoTag"), MaxTag),
                InProgress: true));
        }

        var ordered = sessions.Values.OrderBy(session => session.StartedAt).ToList();
        if (ordered.Count > MaxSessions) ordered.RemoveRange(0, ordered.Count - MaxSessions);
        return ordered;
    }

    /// <summary>
    /// Journées de <c>days["AAAA-MM-JJ"]</c>, de la plus ancienne à la plus récente. Une clé qui n'est
    /// pas une date, ou une journée sans aucun mouvement ni temps de jeu, est ignorée.
    /// </summary>
    private static List<LedgerDayPayload> ReadDays(LuaTable character)
    {
        var days = new List<LedgerDayPayload>();
        if (character.Get("days") is not LuaTable table) return days;
        foreach (var (key, value) in table.Entries)
        {
            if (key.Kind != LuaKeyKind.String || value is not LuaTable day) continue;
            if (!DateOnly.TryParseExact(key.Text, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out _)) continue;

            var income = Amounts(day.Get("inc") as LuaTable, IncomeSources);
            var expense = Amounts(day.Get("exp") as LuaTable, ExpenseSources);
            var transferIn = Copper(day.Get("xferIn")) ?? 0;
            var transferOut = Copper(day.Get("xferOut")) ?? 0;
            var loot = Copper(day.Get("loot"));
            var played = AltBoardReader.NonNegative(day.Get("time")?.AsInt32());
            if (income.Count == 0 && expense.Count == 0 && transferIn == 0 && transferOut == 0 && (loot ?? 0) == 0 && (played ?? 0) == 0) continue;

            days.Add(new LedgerDayPayload(key.Text!, income, expense, transferIn, transferOut, loot, Copper(day.Get("gold")), played));
        }

        days.Sort((a, b) => string.CompareOrdinal(a.Day, b.Day));
        if (days.Count > MaxDays) days.RemoveRange(0, days.Count - MaxDays);
        return days;
    }

    /// <summary>Montants strictement positifs par source connue ; une source inconnue s'ajoute à « other ».</summary>
    private static Dictionary<string, long> Amounts(LuaTable? table, IReadOnlyList<string> sources)
    {
        var amounts = new Dictionary<string, long>(StringComparer.Ordinal);
        if (table is null) return amounts;
        foreach (var (key, value) in table.Entries)
        {
            if (key.Kind != LuaKeyKind.String || Copper(value) is not { } amount || amount == 0) continue;
            var source = sources.Contains(key.Text!) ? key.Text! : "other";
            amounts[source] = amounts.GetValueOrDefault(source) + amount;
        }

        return amounts;
    }

    /// <summary>Montant en pièces de cuivre : entier positif ou nul, jusqu'à 10¹³ (au-delà, valeur écartée).</summary>
    private static long? Copper(LuaValue? value) => value?.AsInt64() is { } copper and >= 0 and <= 10_000_000_000_000 ? copper : null;

    /// <summary>
    /// Temps connecté d'une session en cours, comme le calcule l'addon : les connexions précédentes
    /// (<c>active</c>) plus la connexion courante, figée pendant une pause.
    /// </summary>
    private static int? OnlineSeconds(LuaTable current, long start, long? lastSeen)
    {
        var active = AltBoardReader.NonNegative(current.Get("active")?.AsInt32()) ?? 0;
        if (current.Get("paused")?.AsBoolean() == true) return active;
        if (lastSeen is null) return null;
        var stintStart = AltBoardReader.Timestamp(current.Get("stintStart")) ?? start;
        var seconds = active + Math.Max(0, lastSeen.Value - stintStart);
        return seconds <= int.MaxValue ? (int)seconds : null;
    }
}
