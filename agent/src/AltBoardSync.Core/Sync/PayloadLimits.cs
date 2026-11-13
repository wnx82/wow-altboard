namespace AltBoardSync.Core.Sync;

/// <summary>
/// Limites du serveur (<c>web/src/lib/sync/schema.ts</c>) sur les textes informatifs, que l'agent
/// respecte de lui-même : un document qui les dépasse était refusé en entier, avec les données de
/// tous les comptes du PC. Depuis le site 0.25.0 le serveur raccourcit lui aussi ; les agents
/// antérieurs comptent sur lui.
/// </summary>
public static class PayloadLimits
{
    /// <summary>Avertissements par compte.</summary>
    public const int MaxWarnings = 50;

    public const int WarningLength = 400;

    public const int DisplayNameLength = 120;

    /// <summary>
    /// Au plus <see cref="MaxWarnings"/> avertissements non vides, chacun raccourci ; au-delà, le
    /// dernier dit combien n'ont pas été transmis.
    /// </summary>
    public static IReadOnlyList<string> Warnings(IEnumerable<string> warnings)
    {
        var kept = warnings.Where(warning => !string.IsNullOrWhiteSpace(warning)).Select(warning => Shorten(warning, WarningLength)).ToList();
        if (kept.Count <= MaxWarnings) return kept;
        var dropped = kept.Count - (MaxWarnings - 1);
        return [.. kept.Take(MaxWarnings - 1), $"{dropped} autres avertissements non transmis"];
    }

    /// <summary>Nom donné au PC : raccourci, et absent s'il est vide.</summary>
    public static string? DisplayName(string? name) => string.IsNullOrWhiteSpace(name) ? null : Shorten(name.Trim(), DisplayNameLength);

    /// <summary>
    /// Au plus <paramref name="max"/> unités UTF-16 (la mesure du serveur), « … » en dernier, sans
    /// couper un caractère en deux.
    /// </summary>
    public static string Shorten(string text, int max)
    {
        if (text.Length <= max) return text;
        var length = max - 1;
        if (char.IsHighSurrogate(text[length - 1])) length--;
        return string.Concat(text.AsSpan(0, length), "…");
    }
}
