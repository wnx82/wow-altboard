namespace AltBoardSync.Core.Discovery;

/// <summary>Un fichier AltBoard.lua trouvé pour un compte WoW.</summary>
public sealed record AccountSource(string AccountFolder, string Flavor, string FlavorPath, string FilePath)
{
    /// <summary>Fichier de l'addon Allemano Ledger du même compte, s'il existe (temps de jeu par niveau).</summary>
    public string? LedgerFilePath { get; init; }

    /// <summary>Fichier de l'addon Auctionator du même compte, s'il existe (prix de l'hôtel des ventes).</summary>
    public string? AuctionatorFilePath { get; init; }

    /// <summary>Fichier de l'addon NaowhForever du même compte, s'il existe (recettes apprises).</summary>
    public string? RecipesFilePath { get; init; }

    /// <summary>Fichier de Syndicator (données de l'addon Baganator) du même compte, s'il existe (courrier, enchères, banques de guilde).</summary>
    public string? SyndicatorFilePath { get; init; }
}

/// <summary>
/// Découvre les comptes sous <c>WTF\Account\</c>. Lecture seule : rien n'est créé, modifié ni
/// supprimé dans le dossier de World of Warcraft.
/// </summary>
public static class AccountScanner
{
    /// <summary>Racine de l'installation : chaque client qu'elle contient (<c>_forever_</c>, <c>_classic_beta_</c>…) est lu.</summary>
    public const string DefaultWowPath = @"C:\Program Files (x86)\World of Warcraft";

    /// <summary>Client de la bêta, défaut de l'agent jusqu'à la version 0.4.0.</summary>
    public const string BetaFlavor = "_classic_beta_";

    public const string SavedVariablesFile = "AltBoard.lua";
    public const string LedgerFile = "AllemanoLedger.lua";
    public const string AuctionatorFile = "Auctionator.lua";
    public const string RecipesFile = "NaowhForever.lua";

    /// <summary>Baganator range ses données dans les SavedVariables de sa bibliothèque, Syndicator.</summary>
    public const string SyndicatorFile = "Syndicator.lua";

    private static string? Sibling(string accountPath, string fileName)
    {
        var path = Path.Combine(accountPath, "SavedVariables", fileName);
        return File.Exists(path) ? path : null;
    }

    /// <param name="wowPath">Dossier d'un client (<c>…\_forever_</c>) ou racine World of Warcraft contenant plusieurs clients.</param>
    public static IReadOnlyList<AccountSource> Scan(string wowPath)
    {
        if (!Directory.Exists(wowPath))
            throw new DirectoryNotFoundException($"Dossier World of Warcraft introuvable : {wowPath}");

        var sources = new List<AccountSource>();
        foreach (var flavorPath in FlavorPaths(wowPath))
        {
            var flavor = Path.GetFileName(Path.TrimEndingDirectorySeparator(flavorPath));
            foreach (var accountPath in Directory.EnumerateDirectories(Path.Combine(flavorPath, "WTF", "Account")))
            {
                // Seule la présence du fichier désigne un compte : WTF\Account contient aussi des
                // dossiers techniques, et un compte peut ne pas utiliser AltBoard.
                var file = Path.Combine(accountPath, "SavedVariables", SavedVariablesFile);
                if (!File.Exists(file)) continue;
                sources.Add(new AccountSource(Path.GetFileName(accountPath), flavor, flavorPath, file)
                {
                    LedgerFilePath = Sibling(accountPath, LedgerFile),
                    AuctionatorFilePath = Sibling(accountPath, AuctionatorFile),
                    RecipesFilePath = Sibling(accountPath, RecipesFile),
                    SyndicatorFilePath = Sibling(accountPath, SyndicatorFile),
                });
            }
        }

        sources.Sort((a, b) =>
        {
            var byFlavor = string.CompareOrdinal(a.Flavor, b.Flavor);
            return byFlavor != 0 ? byFlavor : string.Compare(a.AccountFolder, b.AccountFolder, StringComparison.OrdinalIgnoreCase);
        });
        return sources;
    }

    /// <summary>Dossiers <c>WTF\Account</c> de chaque client sous <paramref name="wowPath"/> : ce que surveille « watch ».</summary>
    public static IReadOnlyList<string> AccountRoots(string wowPath)
    {
        if (!Directory.Exists(wowPath))
            throw new DirectoryNotFoundException($"Dossier World of Warcraft introuvable : {wowPath}");
        return [.. FlavorPaths(wowPath).Select(flavorPath => Path.Combine(flavorPath, "WTF", "Account"))];
    }

    private static IEnumerable<string> FlavorPaths(string wowPath)
    {
        if (HasAccounts(wowPath))
        {
            yield return wowPath;
            yield break;
        }

        foreach (var candidate in Directory.EnumerateDirectories(wowPath, "_*_").Order(StringComparer.OrdinalIgnoreCase))
        {
            if (HasAccounts(candidate)) yield return candidate;
        }
    }

    private static bool HasAccounts(string flavorPath) => Directory.Exists(Path.Combine(flavorPath, "WTF", "Account"));

    /// <summary>Version de l'addon installé (ligne <c>## Version:</c> du .toc), absente du fichier de données.</summary>
    public static string? ReadAddonVersion(string flavorPath)
    {
        var toc = Path.Combine(flavorPath, "Interface", "AddOns", "AltBoard", "AltBoard.toc");
        try
        {
            if (!File.Exists(toc)) return null;
            foreach (var line in File.ReadLines(toc).Take(50))
            {
                const string prefix = "## Version:";
                if (!line.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) continue;
                var version = line[prefix.Length..].Trim();
                return version.Length is > 0 and <= 40 ? version : null;
            }
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            // Information facultative : son absence ne bloque pas la synchronisation.
        }

        return null;
    }
}
