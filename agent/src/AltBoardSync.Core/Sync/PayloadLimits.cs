namespace AltBoardSync.Core.Sync;

/// <summary>
/// Limites du serveur (<c>web/src/lib/sync/schema.ts</c>) sur les textes informatifs, que l'agent
/// respecte de lui-même : un document qui les dépasse était refusé en entier, avec les données de
/// tous les comptes du PC. Depuis le site 0.25.0 le serveur raccourcit lui aussi ; les agents
/// antérieurs comptent sur lui. S'y ajoutent les bornes des montants et des horodatages.
/// </summary>
public static class PayloadLimits
{
    /// <summary>Avertissements par compte.</summary>
    public const int MaxWarnings = 50;

    public const int WarningLength = 400;

    public const int DisplayNameLength = 120;

    /// <summary>
    /// Horodatages d'EZAuctioneer, des erreurs d'AltBoard et des runs d'Allemano Ledger : du
    /// 2020-01-01 au 2100-01-01, en secondes Unix.
    /// </summary>
    public const long MinTimestamp = 1_577_836_800;
    public const long MaxTimestamp = 4_102_444_800;

    /// <summary>Montant le plus grand accepté, en pièces de cuivre (10¹³) ; un gain ou une perte reste dans ±10¹³.</summary>
    public const long MaxCopper = 10_000_000_000_000;

    /// <summary>Plus grand entier exact en JavaScript : borne des nombres et des identifiants.</summary>
    public const long MaxSafeInteger = 9_007_199_254_740_991;

    /// <summary>
    /// Montant arrondi à la pièce de cuivre (les addons en calculent parfois des fractions), à la
    /// demi-pièce la plus éloignée de zéro ; null hors de [<paramref name="min"/>, <paramref name="max"/>].
    /// </summary>
    public static long? Copper(double? value, long min, long max)
    {
        if (value is not { } amount || !double.IsFinite(amount)) return null;
        var rounded = Math.Round(amount, MidpointRounding.AwayFromZero);
        return rounded >= min && rounded <= max ? (long)rounded : null;
    }

    /// <summary>Horodatage en secondes Unix dans les bornes du serveur, ou null.</summary>
    public static long? Timestamp(long? value) => value is >= MinTimestamp and <= MaxTimestamp ? value : null;

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
