import Link from "next/link";
import { ScrollRegion } from "@/components/scroll-region";
import type { CharacterListItem } from "@/lib/dashboard/queries";
import { classKey, classLabel, formatDateTime, formatItemLevel, formatRelative, progressPercent } from "@/lib/wow/format";
import { ClassAvatar, FactionBadge, Meter, Money, ProfessionIcon, RankMedal } from "./ui";

// Les deux vues de la liste des personnages de l'accueil : cartes et tableau.

/** Place sur le podium de l'accueil, par identifiant de personnage. */
export type Ranks = Record<number, number>;

/** Étiquettes du carnet, en pastilles ; rien sans étiquette. */
export function TagList({ tags, className = "" }: { tags: string[]; className?: string }) {
  if (tags.length === 0) return null;
  return (
    <ul className={`flex flex-wrap gap-1 ${className}`} aria-label="Étiquettes">
      {tags.map((tag) => (
        <li key={tag} className="badge" data-tone="gold">
          {tag}
        </li>
      ))}
    </ul>
  );
}

const rankTitle = (rank: number) => (rank === 1 ? "Le plus haut niveau" : `${rank}e plus haut niveau`);

export function CharacterCard({ character, now, rank }: { character: CharacterListItem; now: Date; rank?: number }) {
  const professions = [...character.professions].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)).slice(0, 2);
  const others = character.professions.length - professions.length;

  return (
    <article className="panel character-card h-full p-5" data-class={classKey(character.class)}>
      <div className="flex items-start gap-4">
        <ClassAvatar name={character.name} classToken={character.class} level={character.level} />
        <div className="min-w-0 flex-1">
          <h3 className="display truncate text-lg font-bold leading-tight class-text" title={character.name}>
            <Link href={`/characters/${character.id}`} prefetch={false} className="after:absolute after:inset-0 after:z-10 focus-visible:outline-none">
              {character.name}
            </Link>
          </h3>
          <p className="mt-0.5 truncate text-sm text-text">
            {classLabel(character.class)}
            {character.level !== null && <span className="text-muted"> — Niveau {character.level}</span>}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted">{[character.race, character.realm].filter(Boolean).join(" • ")}</p>
          {character.guild && <p className="mt-0.5 truncate text-xs text-ok/85">&lt;{character.guild}&gt;</p>}
          <TagList tags={character.tags} className="mt-2" />
        </div>
        <div className="flex flex-none flex-col items-end gap-2">
          <FactionBadge faction={character.faction} />
          {rank !== undefined && (
            <span className="flex items-center gap-1.5 text-[0.7rem] font-semibold text-gold">
              <RankMedal rank={rank} size="sm" />
              <span className="sr-only">{rankTitle(rank)}</span>
              <span aria-hidden="true">Podium</span>
            </span>
          )}
        </div>
      </div>

      {character.xpMax !== null && character.xp !== null && (
        <div className="mt-4">
          <div className="mb-1 flex items-baseline justify-between text-xs text-muted">
            <span>Expérience</span>
            <span className="tabular-nums">{progressPercent(character.xp, character.xpMax)} %</span>
          </div>
          <Meter value={character.xp} max={character.xpMax} label="Progression du niveau" />
        </div>
      )}

      {character.goals.total > 0 && (
        <div className="mt-3">
          <div className="mb-1 flex items-baseline justify-between text-xs text-muted">
            <span>Objectifs</span>
            <span className="tabular-nums">
              {character.goals.done} / {character.goals.total}
            </span>
          </div>
          <Meter value={character.goals.done} max={character.goals.total} label={`Objectifs atteints de ${character.name}`} tone="gold" />
        </div>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="eyebrow">Niveau d&apos;objet</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">{formatItemLevel(character.itemLevel)}</dd>
        </div>
        <div>
          <dt className="eyebrow">Or</dt>
          <dd className="mt-0.5">
            <Money copper={character.moneyCopper} />
          </dd>
        </div>
      </dl>

      {professions.length > 0 && (
        <ul className="mt-4 space-y-2.5">
          {professions.map((profession) => (
            <li key={profession.skillLine}>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate text-text">
                  <ProfessionIcon skillLine={profession.skillLine} size={18} /> {profession.name}
                </span>
                <span className="tabular-nums text-muted">
                  {profession.rank ?? "—"} / {profession.maxRank ?? "—"}
                </span>
              </div>
              <Meter value={profession.rank} max={profession.maxRank} label={profession.name} tone="gold" />
            </li>
          ))}
          {others > 0 && <li className="text-xs text-faint">+ {others} autre{others > 1 ? "s" : ""} métier{others > 1 ? "s" : ""}</li>}
        </ul>
      )}

      {character.note && (
        <p className="mt-4 line-clamp-2 whitespace-pre-line text-xs italic text-muted" title={character.note}>
          <span className="sr-only">Note : </span>
          {character.note}
        </p>
      )}

      <p className="mt-4 flex items-baseline justify-between gap-3 border-t border-line pt-3 text-xs text-muted">
        <span className="flex-none" title={`Dernière donnée AltBoard connue : ${formatDateTime(character.sourceLastSeenAt)}`}>
          Vu en jeu {formatRelative(character.sourceLastSeenAt, now)}
        </span>
        {character.zone && (
          <span className="min-w-0 truncate text-faint" title={`Dernière zone connue : ${character.zone}`}>
            {character.zone}
          </span>
        )}
      </p>
      {character.hidden && <p className="mt-2 text-xs text-faint">Masqué dans l&apos;addon</p>}
    </article>
  );
}

export function CharacterTable({ characters, now, ranks }: { characters: CharacterListItem[]; now: Date; ranks: Ranks }) {
  return (
    <ScrollRegion className="panel overflow-x-auto" label="Personnages">
      <table className="data-table min-w-[1060px]">
        <caption className="sr-only">Personnages</caption>
        <thead>
          <tr>
            <th scope="col">Personnage</th>
            <th scope="col">Classe</th>
            <th scope="col" className="num">
              Niveau
            </th>
            <th scope="col" className="num">
              Niv. d&apos;objet
            </th>
            <th scope="col" className="num">
              Or
            </th>
            <th scope="col">Métiers</th>
            <th scope="col" className="num">
              Objectifs
            </th>
            <th scope="col">Royaume</th>
            <th scope="col">PC</th>
            <th scope="col">Vu en jeu</th>
          </tr>
        </thead>
        <tbody>
          {characters.map((character) => (
            <tr key={character.id} data-class={classKey(character.class)}>
              <th scope="row">
                <Link href={`/characters/${character.id}`} prefetch={false} className="flex items-center gap-3 font-semibold class-text hover:underline">
                  <ClassAvatar name={character.name} classToken={character.class} size="sm" />
                  <span className="max-w-56 truncate" title={character.name}>
                    {character.name}
                  </span>
                  {ranks[character.id] !== undefined && (
                    <>
                      <RankMedal rank={ranks[character.id]} size="sm" title={rankTitle(ranks[character.id])} />
                      <span className="sr-only">{rankTitle(ranks[character.id])}</span>
                    </>
                  )}
                </Link>
                <TagList tags={character.tags} className="mt-1.5 pl-11" />
              </th>
              <td>
                {classLabel(character.class)}
                {character.race && <span className="block text-xs text-muted">{character.race}</span>}
              </td>
              <td className="num">
                {character.level ?? "—"}
                {progressPercent(character.xp, character.xpMax) !== null && (
                  <span className="block text-xs text-muted">{progressPercent(character.xp, character.xpMax)} %</span>
                )}
              </td>
              <td className="num">{formatItemLevel(character.itemLevel)}</td>
              <td className="num">
                <Money copper={character.moneyCopper} />
              </td>
              <td className="text-xs text-muted">
                {character.professions.length === 0
                  ? "—"
                  : character.professions.map((p) => (
                      <span key={p.skillLine} className="mr-3 inline-block whitespace-nowrap">
                        <ProfessionIcon skillLine={p.skillLine} size={16} /> {p.name} {p.rank ?? "—"}/{p.maxRank ?? "—"}
                      </span>
                    ))}
              </td>
              <td className="num tabular-nums">{character.goals.total === 0 ? "—" : `${character.goals.done} / ${character.goals.total}`}</td>
              <td>
                {character.realm}
                <span className="block text-xs text-muted">{character.faction}</span>
              </td>
              <td className="text-muted">{character.machines.map((m) => m.label).join(", ") || "—"}</td>
              <td className="whitespace-nowrap text-muted" title={formatDateTime(character.sourceLastSeenAt)}>
                {formatRelative(character.sourceLastSeenAt, now)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}
