import Link from "next/link";
import { ClassAvatar, FactionBadge, GameIcon, Meter, Money, StatTile } from "@/components/ui";
import type { CharacterDetail, CharacterLink } from "@/lib/dashboard/queries";
import { classIconUrl } from "@/lib/wow/icons";
import { classKey, classLabel, formatDateTime, formatDuration, formatInteger, formatItemLevel, formatRelative, progressPercent } from "@/lib/wow/format";

// En-tête de la fiche : voisins, identité, dates et tuiles de la vue générale.

export function CharacterHero({ character, neighbors, now }: { character: CharacterDetail; neighbors: { previous: CharacterLink | null; next: CharacterLink | null }; now: Date }) {
  const classIcon = classIconUrl(character.class);
  return (
    <>
    <nav aria-label="Autres personnages" className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <Link href="/" className="page-eyebrow hover:underline">
        Tous les personnages
      </Link>
      <span className="flex flex-wrap gap-x-4 text-sm">
        <Link href={`/compare?c=${character.id}`} prefetch={false} className="text-muted hover:text-gold hover:underline">
          Comparer
        </Link>
        <NeighborLink character={neighbors.previous} direction="previous" />
        <NeighborLink character={neighbors.next} direction="next" />
      </span>
    </nav>

    <header className="panel character-card character-hero isolate mt-4 flex flex-wrap items-center gap-5 p-6 sm:p-7" data-class={classKey(character.class)}>
      {/* Grande icône de la classe, floue, en fond : la même signature que le podium de l'accueil. */}
      {classIcon && <GameIcon src={classIcon} size={56} className="champion-backdrop" />}
      <ClassAvatar name={character.name} classToken={character.class} size="lg" level={character.level} />
      {/* Base de 14 rem : sur téléphone, les dates passent sous le nom au lieu de l'écraser. */}
      <div className="min-w-0 flex-[1_1_14rem]">
        <h1 className="display break-words text-3xl font-bold leading-tight class-text sm:text-[2.6rem]">{character.name}</h1>
        <p className="mt-1 text-lg">
          {classLabel(character.class)}
          {character.level !== null && <span className="text-muted"> — Niveau {character.level}</span>}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
          {[character.race, character.realm].filter(Boolean).join(" • ")}
          <FactionBadge faction={character.faction} />
          {character.guild && <span className="badge">&lt;{character.guild}&gt;</span>}
          {character.hidden && <span className="badge">Masqué dans l&apos;addon</span>}
        </p>
      </div>
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_auto]">
        <dt className="text-muted">Dernière donnée AltBoard connue</dt>
        <dd title={formatDateTime(character.sourceLastSeenAt)}>{formatRelative(character.sourceLastSeenAt, now)}</dd>
        <dt className="text-muted">Dernière synchronisation</dt>
        <dd title={formatDateTime(character.lastSyncAt)}>
          {formatRelative(character.lastSyncAt, now)}
          {character.lastMachine && <span className="text-muted"> · {character.lastMachine}</span>}
        </dd>
        <dt className="text-muted">Compte</dt>
        <dd>{character.account.label}</dd>
        {character.zone && (
          <>
            <dt className="text-muted">Zone</dt>
            <dd>{character.zone}</dd>
          </>
        )}
      </dl>
    </header>
    </>
  );
}

export function OverviewTiles({ character, now }: { character: CharacterDetail; now: Date }) {
  const totalPlayed = character.playtime?.totalSeconds ?? null;
  return (
    <section
      aria-label="Vue générale"
      className={`mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 ${totalPlayed === null ? "xl:grid-cols-6" : "xl:grid-cols-7"}`}
    >
      <StatTile
        label="Niveau"
        value={character.level ?? "—"}
        hint={
          character.xp !== null && character.xpMax !== null ? (
            <>
              <Meter value={character.xp} max={character.xpMax} label="Progression du niveau" />
              <span className="mt-1 block">
                {formatInteger(character.xp)} / {formatInteger(character.xpMax)} XP ({progressPercent(character.xp, character.xpMax)} %)
              </span>
            </>
          ) : undefined
        }
      />
      <StatTile label="Niveau d'objet" value={formatItemLevel(character.itemLevel)} />
      <StatTile label="Or" value={<Money copper={character.moneyCopper} />} />
      <StatTile label="XP reposée" value={formatInteger(character.restedXp)} />
      {totalPlayed !== null && (
        <StatTile
          label="Temps de jeu"
          value={formatDuration(totalPlayed)}
          hint={character.playtime?.measuredAt ? `Relevé ${formatRelative(character.playtime.measuredAt, now)}` : undefined}
        />
      )}
      <StatTile
        label="Sacs"
        value={character.bagSlotsUsed === null ? "—" : `${character.bagSlotsUsed} / ${character.bagSlotsTotal ?? "—"}`}
        hint={character.bagsAt ? `Relevés ${formatRelative(character.bagsAt, now)}` : "Jamais relevés"}
      />
      <StatTile
        label="Banque"
        value={character.bankSlotsUsed === null ? "—" : `${character.bankSlotsUsed} / ${character.bankSlotsTotal ?? "—"}`}
        hint={character.bankAt ? `Relevée ${formatRelative(character.bankAt, now)}` : "Jamais relevée"}
      />
    </section>
  );
}

/** Personnage voisin dans l'ordre de l'accueil (niveau décroissant, puis nom). */
function NeighborLink({ character, direction }: { character: CharacterLink | null; direction: "previous" | "next" }) {
  if (!character) return null;
  const previous = direction === "previous";
  return (
    <Link href={`/characters/${character.id}`} prefetch={false} rel={previous ? "prev" : "next"} className="hover:underline" data-class={classKey(character.class)}>
      <span className="text-muted">{previous ? "← Précédent : " : "Suivant : "}</span>
      <span className="class-text font-semibold">{character.name}</span>
      {!previous && <span className="text-muted"> →</span>}
    </Link>
  );
}
