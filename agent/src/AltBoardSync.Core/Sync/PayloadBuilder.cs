using System.Security.Cryptography;
using AltBoardSync.Core.AltBoard;
using AltBoardSync.Core.Discovery;
using AltBoardSync.Core.Economy;
using AltBoardSync.Core.Inventory;
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

/// <summary>
/// Lecture du cache de noms d'un client. FileHash : empreinte du fichier lu (null si la lecture a
/// échoué) ; Payload : les noms à envoyer, null si le fichier n'a pas changé depuis knownHash ou ne
/// contient aucun nom ; Error : la cause d'un échec.
/// </summary>
public sealed record ItemNamesReadResult(string Flavor, string? FileHash, ItemNamesPayload? Payload, string? Error);

public sealed class PayloadBuilder(StableFileReader reader)
{
    /// <summary>
    /// Préfixe de <see cref="AccountReadResult.Fingerprint"/>, à changer quand le document gagne un champ :
    /// les empreintes enregistrées par l'agent précédent ne correspondent plus, et chaque compte est
    /// renvoyé une fois sans attendre une modification des fichiers. 2 : nom complet du dossier (0.6.0).
    /// 3 : finances par jour d'Allemano Ledger (0.7.0). 4 : courrier, enchères et banques de guilde de
    /// Baganator (0.8.0).
    /// </summary>
    public const string PayloadFormat = "4";

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
            var (baganator, baganatorItems) = await ReadBaganatorAsync(source, characters, economyWarnings, cancellationToken).ConfigureAwait(false);
            var payload = new AccountPayload(
                AccountKey.Compute(source.AccountFolder),
                AccountKey.Hint(source.AccountFolder),
                source.Flavor,
                document.Schema,
                AccountScanner.ReadAddonVersion(source.FlavorPath),
                new SourceFilePayload(fileHash, snapshot.ModifiedAt, snapshot.Content.LongLength),
                characters,
                MergeItems(document.Items, baganatorItems),
                PayloadLimits.Warnings([.. document.Warnings, .. ledgerWarnings, .. economyWarnings.Take(MaxEconomyWarnings)]))
            {
                FolderName = AccountKey.FullName(source.AccountFolder),
                Auctionator = auctionator,
                Recipes = recipes,
                Baganator = baganator,
            };
            return new AccountReadResult(source, payload, null)
            {
                Fingerprint = $"{PayloadFormat}:{fileHash}:{ledgerHash ?? "-"}:{auctionator?.File.Hash ?? "-"}:{recipes?.File.Hash ?? "-"}:{baganator?.File.Hash ?? "-"}",
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
                .Select(c => ledger.TryGetValue(c.Guid, out var known)
                    ? c with
                    {
                        Playtime = known.Playtime,
                        Sessions = known.Sessions.Count > 0 ? known.Sessions : null,
                        Finances = known.Finances.Count > 0 ? known.Finances : null,
                    }
                    : c)
                .ToList();
            return (completed, warnings, Convert.ToHexStringLower(SHA256.HashData(snapshot.Content)));
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or InvalidDataException or LuaParseException)
        {
            var message = $"Allemano Ledger illisible, temps de jeu, sessions et finances non transmis : {e.Message}";
            return (characters, [message.Length > 300 ? message[..300] : message], null);
        }
    }

    /// <summary>
    /// Avertissements Auctionator, NaowhForever et Baganator retenus par compte, pour laisser de la place à
    /// ceux d'AltBoard ; le total reste borné par <see cref="PayloadLimits.Warnings"/>.
    /// </summary>
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

    /// <summary>
    /// Courrier, enchères en cours et banques de guilde relevés par Baganator (Syndicator.lua). Source
    /// facultative, comme Auctionator. Syndicator nomme les personnages sans GUID : chacun est rattaché
    /// au personnage d'AltBoard du même nom sur ce compte, le plus récemment vu quand il y en a plusieurs
    /// (un personnage de la bêta et son homonyme de WoW Forever, que Syndicator confond).
    /// </summary>
    private async Task<(BaganatorPayload? Payload, IReadOnlyList<ItemPayload> Items)> ReadBaganatorAsync(
        AccountSource source, IReadOnlyList<CharacterPayload> characters, List<string> warnings, CancellationToken cancellationToken)
    {
        if (source.SyndicatorFilePath is null) return (null, []);
        try
        {
            var snapshot = await reader.ReadAsync(source.SyndicatorFilePath, cancellationToken).ConfigureAwait(false);
            var data = SyndicatorReader.Read(SavedVariablesParser.Parse(snapshot.Content), warnings);
            if (data is null) return (null, []);

            var guidByName = characters
                .GroupBy(c => c.Name, StringComparer.Ordinal)
                .ToDictionary(g => g.Key, g => g.MaxBy(c => c.LastSeen)!.Guid, StringComparer.Ordinal);
            var held = new List<CharacterHoldingsPayload>();
            var unknown = 0;
            foreach (var character in data.Characters)
            {
                if (!guidByName.TryGetValue(character.Name, out var guid)) unknown++;
                else if (held.All(h => h.Guid != guid)) held.Add(new CharacterHoldingsPayload(guid, character.Mail, character.Auctions));
            }

            if (unknown > 0)
            {
                warnings.Add(unknown == 1
                    ? "Baganator : 1 personnage absent d'AltBoard sur ce compte, son courrier et ses enchères ne sont pas transmis."
                    : $"Baganator : {unknown} personnages absents d'AltBoard sur ce compte, leur courrier et leurs enchères ne sont pas transmis.");
            }
            if (held.Count == 0 && data.Guilds.Count == 0) return (null, []);
            held.Sort((a, b) => string.CompareOrdinal(a.Guid, b.Guid));
            return (new BaganatorPayload(FileOf(snapshot), held, data.Guilds), data.Items);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or InvalidDataException or LuaParseException)
        {
            warnings.Add(Truncate($"Baganator illisible, courrier, enchères et banques de guilde non transmis : {e.Message}"));
            return (null, []);
        }
    }

    /// <summary>Référentiel d'objets du compte : celui d'AltBoard d'abord, complété par les objets que lui seul ignore.</summary>
    private static IReadOnlyList<ItemPayload> MergeItems(IReadOnlyList<ItemPayload> altBoard, IReadOnlyList<ItemPayload> others)
    {
        if (others.Count == 0) return altBoard;
        var known = altBoard.Select(item => item.Key).ToHashSet(StringComparer.Ordinal);
        var merged = altBoard.Concat(others.Where(item => !known.Contains(item.Key))).ToList();
        merged.Sort((a, b) => string.CompareOrdinal(a.Key, b.Key));
        return merged;
    }

    /// <summary>
    /// Noms d'objets du cache local d'un client (<see cref="ItemNameCache"/>). Source facultative : null
    /// sans cache ; une lecture en échec ne fait jamais échouer la synchronisation. Le fichier n'est
    /// analysé que si son empreinte diffère de knownHash, celle du dernier envoi accepté.
    /// </summary>
    public async Task<ItemNamesReadResult?> ReadItemNamesAsync(string flavor, string flavorPath, string? knownHash, CancellationToken cancellationToken = default)
    {
        (string Path, string Locale)? found;
        try
        {
            found = ItemNameCache.Find(flavorPath);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            return new ItemNamesReadResult(flavor, null, null, Truncate($"cache du jeu introuvable : {e.Message}"));
        }

        if (found is not { } cache) return null;
        try
        {
            var snapshot = await reader.ReadAsync(cache.Path, cancellationToken).ConfigureAwait(false);
            var file = FileOf(snapshot);
            if (file.Hash == knownHash) return new ItemNamesReadResult(flavor, file.Hash, null, null);
            var data = ItemNameCache.Parse(snapshot.Content);
            return new ItemNamesReadResult(
                flavor,
                file.Hash,
                data.Names.Count == 0 ? null : new ItemNamesPayload(flavor, cache.Locale, data.Build, file, data.Names),
                null);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or InvalidDataException)
        {
            return new ItemNamesReadResult(flavor, null, null, Truncate($"cache du jeu illisible, noms des objets non transmis : {e.Message}"));
        }
    }

    /// <summary>Clients distincts des comptes trouvés, dans l'ordre de découverte.</summary>
    public static IReadOnlyList<(string Flavor, string FlavorPath)> Flavors(IEnumerable<AccountSource> sources) =>
        sources.Select(source => (source.Flavor, source.FlavorPath)).DistinctBy(entry => entry.Flavor, StringComparer.OrdinalIgnoreCase).ToList();

    private static SourceFilePayload FileOf(FileSnapshot snapshot) =>
        new(Convert.ToHexStringLower(SHA256.HashData(snapshot.Content)), snapshot.ModifiedAt, snapshot.Content.LongLength);

    private static string Truncate(string message) => message.Length > 300 ? message[..300] : message;

    public static SyncPayload Build(
        MachinePayload machine, IEnumerable<AccountPayload> accounts, string agentVersion, DateTimeOffset now, IReadOnlyList<ItemNamesPayload>? itemNames = null) =>
        new(SyncPayload.CurrentSchemaVersion, agentVersion, now, machine with { DisplayName = PayloadLimits.DisplayName(machine.DisplayName) }, accounts.ToList())
        {
            ItemNames = itemNames is { Count: > 0 } ? itemNames : null,
        };
}
