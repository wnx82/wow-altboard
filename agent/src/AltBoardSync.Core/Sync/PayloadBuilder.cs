using System.Security.Cryptography;
using AltBoardSync.Core.AltBoard;
using AltBoardSync.Core.Discovery;
using AltBoardSync.Core.Economy;
using AltBoardSync.Core.IO;
using AltBoardSync.Core.Lua;

namespace AltBoardSync.Core.Sync;

/// <summary>Résultat de la lecture d'un compte : un document prêt à envoyer, ou l'erreur rencontrée.</summary>
public sealed record AccountReadResult(AccountSource Source, AccountPayload? Payload, string? Error)
{
    public bool Succeeded => Payload is not null;

    /// <summary>
    /// Empreinte de tout ce qui a été lu pour le compte, Allemano Ledger compris : « watch » ne
    /// renvoie un compte que si elle a changé. Absente quand la lecture a échoué.
    /// </summary>
    public string? Fingerprint { get; init; }
}

public sealed class PayloadBuilder(StableFileReader reader)
{
    /// <summary>
    /// Préfixe de <see cref="AccountReadResult.Fingerprint"/>, à changer quand le document gagne un champ :
    /// les empreintes enregistrées par l'agent précédent ne correspondent plus, et chaque compte est
    /// renvoyé une fois sans attendre une modification des fichiers. 2 : nom complet du dossier (0.6.0).
    /// </summary>
    public const string PayloadFormat = "2";

    /// <summary>Lit un compte. Une erreur sur un compte n'empêche jamais la lecture des autres.</summary>
    public async Task<AccountReadResult> ReadAccountAsync(AccountSource source, CancellationToken cancellationToken = default)
    {
        try
        {
            var snapshot = await reader.ReadAsync(source.FilePath, cancellationToken).ConfigureAwait(false);
            var document = AltBoardReader.Read(SavedVariablesParser.Parse(snapshot.Content));
            var fileHash = Convert.ToHexStringLower(SHA256.HashData(snapshot.Content));
            var (characters, ledgerWarnings, ledgerHash) = await AttachLedgerAsync(source, document.Characters, cancellationToken).ConfigureAwait(false);
            var economyWarnings = new List<string>();
            var auctionator = await ReadAuctionatorAsync(source, economyWarnings, cancellationToken).ConfigureAwait(false);
            var recipes = await ReadRecipesAsync(source, economyWarnings, cancellationToken).ConfigureAwait(false);
            var payload = new AccountPayload(
                AccountKey.Compute(source.AccountFolder),
                AccountKey.Hint(source.AccountFolder),
                source.Flavor,
                document.Schema,
                AccountScanner.ReadAddonVersion(source.FlavorPath),
                new SourceFilePayload(fileHash, snapshot.ModifiedAt, snapshot.Content.LongLength),
                characters,
                document.Items,
                [.. document.Warnings, .. ledgerWarnings, .. economyWarnings.Take(MaxEconomyWarnings)])
            {
                FolderName = AccountKey.FullName(source.AccountFolder),
                Auctionator = auctionator,
                Recipes = recipes,
            };
            return new AccountReadResult(source, payload, null)
            {
                Fingerprint = $"{PayloadFormat}:{fileHash}:{ledgerHash ?? "-"}:{auctionator?.File.Hash ?? "-"}:{recipes?.File.Hash ?? "-"}",
            };
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or InvalidDataException or LuaParseException or AltBoardFormatException)
        {
            return new AccountReadResult(source, null, e.Message);
        }
    }

    /// <summary>
    /// Complète les personnages avec le temps de jeu et les sessions d'Allemano Ledger, quand son fichier existe.
    /// Source facultative : illisible ou absente, elle ne fait jamais échouer la synchronisation.
    /// </summary>
    private async Task<(IReadOnlyList<CharacterPayload> Characters, IReadOnlyList<string> Warnings, string? FileHash)> AttachLedgerAsync(
        AccountSource source, IReadOnlyList<CharacterPayload> characters, CancellationToken cancellationToken)
    {
        if (source.LedgerFilePath is null) return (characters, [], null);
        try
        {
            var snapshot = await reader.ReadAsync(source.LedgerFilePath, cancellationToken).ConfigureAwait(false);
            var warnings = new List<string>();
            var ledger = LedgerReader.Read(SavedVariablesParser.Parse(snapshot.Content), warnings);
            var completed = characters
                .Select(c => ledger.TryGetValue(c.Guid, out var known) ? c with { Playtime = known.Playtime, Sessions = known.Sessions.Count > 0 ? known.Sessions : null } : c)
                .ToList();
            return (completed, warnings, Convert.ToHexStringLower(SHA256.HashData(snapshot.Content)));
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or InvalidDataException or LuaParseException)
        {
            var message = $"Allemano Ledger illisible, temps de jeu et sessions non transmis : {e.Message}";
            return (characters, [message.Length > 300 ? message[..300] : message], null);
        }
    }

    /// <summary>Avertissements Auctionator et NaowhForever retenus par compte : le serveur en accepte 50 au total.</summary>
    private const int MaxEconomyWarnings = 10;

    /// <summary>
    /// Prix de l'hôtel des ventes relevés par Auctionator. Source facultative : illisible ou absente,
    /// elle ne fait jamais échouer la synchronisation du compte.
    /// </summary>
    private async Task<AuctionatorPayload?> ReadAuctionatorAsync(AccountSource source, List<string> warnings, CancellationToken cancellationToken)
    {
        if (source.AuctionatorFilePath is null) return null;
        try
        {
            var snapshot = await reader.ReadAsync(source.AuctionatorFilePath, cancellationToken).ConfigureAwait(false);
            // La base de prix est du CBOR dans des chaînes Lua : lecture octet par octet.
            var data = AuctionatorReader.Read(SavedVariablesParser.ParseBinary(snapshot.Content), warnings);
            if (data is null) return null;
            return new AuctionatorPayload(FileOf(snapshot), data.DbVersion, data.Markets, data.VendorPrices);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or InvalidDataException or LuaParseException)
        {
            warnings.Add(Truncate($"Auctionator illisible, prix non transmis : {e.Message}"));
            return null;
        }
    }

    /// <summary>Recettes apprises relevées par NaowhForever. Source facultative, comme Auctionator.</summary>
    private async Task<RecipesPayload?> ReadRecipesAsync(AccountSource source, List<string> warnings, CancellationToken cancellationToken)
    {
        if (source.RecipesFilePath is null) return null;
        try
        {
            var snapshot = await reader.ReadAsync(source.RecipesFilePath, cancellationToken).ConfigureAwait(false);
            var characters = RecipeReader.Read(SavedVariablesParser.Parse(snapshot.Content), warnings);
            return characters.Count == 0 ? null : new RecipesPayload(FileOf(snapshot), characters);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or InvalidDataException or LuaParseException)
        {
            warnings.Add(Truncate($"NaowhForever illisible, recettes non transmises : {e.Message}"));
            return null;
        }
    }

    private static SourceFilePayload FileOf(FileSnapshot snapshot) =>
        new(Convert.ToHexStringLower(SHA256.HashData(snapshot.Content)), snapshot.ModifiedAt, snapshot.Content.LongLength);

    private static string Truncate(string message) => message.Length > 300 ? message[..300] : message;

    public static SyncPayload Build(MachinePayload machine, IEnumerable<AccountPayload> accounts, string agentVersion, DateTimeOffset now) =>
        new(SyncPayload.CurrentSchemaVersion, agentVersion, now, machine, accounts.ToList());
}
