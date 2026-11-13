using System.Text.RegularExpressions;

namespace AltBoardSync.Core.App;

/// <summary>
/// Comparaison de versions SemVer « X.Y.Z », avec une éventuelle préversion (« 0.9.0-beta.1 »), comme
/// celle du site (<c>web/src/lib/versions.ts</c>).
/// </summary>
public static partial class AgentVersions
{
    [GeneratedRegex(@"^(\d{1,9})\.(\d{1,9})\.(\d{1,9})(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$")]
    private static partial Regex SemVer();

    /// <summary>
    /// Négatif si <paramref name="a"/> précède <paramref name="b"/>, positif s'il le suit, zéro à
    /// égalité ; null si l'une des deux n'est pas une version. Une préversion précède la version publiée.
    /// </summary>
    public static int? Compare(string? a, string? b)
    {
        if (Parse(a) is not { } left || Parse(b) is not { } right) return null;
        for (var i = 0; i < 3; i++)
        {
            if (left.Core[i] != right.Core[i]) return left.Core[i].CompareTo(right.Core[i]);
        }

        if (left.Prerelease == right.Prerelease) return 0;
        if (left.Prerelease is null) return 1;
        if (right.Prerelease is null) return -1;
        return string.CompareOrdinal(left.Prerelease, right.Prerelease) < 0 ? -1 : 1;
    }

    /// <summary>Vrai seulement si les deux versions sont lisibles et que <paramref name="candidate"/> suit <paramref name="current"/>.</summary>
    public static bool IsNewer(string? candidate, string? current) => Compare(candidate, current) > 0;

    private static (long[] Core, string? Prerelease)? Parse(string? version)
    {
        if (version is null) return null;
        var match = SemVer().Match(version.Trim());
        if (!match.Success) return null;
        return ([long.Parse(match.Groups[1].Value), long.Parse(match.Groups[2].Value), long.Parse(match.Groups[3].Value)],
            match.Groups[4].Success ? match.Groups[4].Value : null);
    }
}
