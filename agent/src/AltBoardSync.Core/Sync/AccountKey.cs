using System.Security.Cryptography;
using System.Text;

namespace AltBoardSync.Core.Sync;

/// <summary>
/// Identité d'un compte WoW. Le seul identifiant disponible est le nom du dossier
/// <c>WTF\Account\&lt;COMPTE&gt;</c> (« 123456789#1 »). Le serveur reçoit une empreinte stable (identique
/// sur tous les PC, pour qu'un compte vu depuis deux machines reste unique), un libellé masqué et,
/// depuis l'agent 0.6.0, le nom complet, affiché sur la page Comptes. Les journaux locaux n'écrivent
/// que le libellé masqué.
/// </summary>
public static partial class AccountKey
{
    private const string Namespace = "wow-altboard-account:";

    /// <summary>Longueur maximale du nom complet transmis ; même limite côté serveur.</summary>
    public const int MaxFolderNameLength = 64;

    public static string Compute(string accountFolder)
    {
        var normalized = Namespace + accountFolder.Trim().ToUpperInvariant();
        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(normalized)));
    }

    public static string Hint(string accountFolder)
    {
        var name = accountFolder.Trim();
        return name.Length <= 6 ? "…" : $"{name[..2]}…{name[^2..]}";
    }

    /// <summary>
    /// Nom complet du dossier, ou null s'il sort de l'ASCII imprimable sans espace (au-delà de
    /// <see cref="MaxFolderNameLength"/> caractères compris). Le serveur recalcule l'empreinte à partir de
    /// ce nom : hors ASCII, ses majuscules pourraient différer de celles de .NET.
    /// </summary>
    public static string? FullName(string accountFolder)
    {
        var name = accountFolder.Trim();
        return name.Length <= MaxFolderNameLength && PrintableAscii().IsMatch(name) ? name : null;
    }

    [System.Text.RegularExpressions.GeneratedRegex("^[!-~]+$")]
    private static partial System.Text.RegularExpressions.Regex PrintableAscii();
}
