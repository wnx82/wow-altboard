import Link from "next/link";
import type { CharacterListItem } from "@/lib/dashboard/queries";
import { classKey, classLabel, formatItemLevel, progressPercent } from "@/lib/wow/format";
import { classIconUrl } from "@/lib/wow/icons";
import { ClassAvatar, FactionBadge, GameIcon, Meter, Money, RankMedal, StarIcon } from "./ui";

const RANK_LABELS = ["Le plus haut niveau", "Deuxième", "Troisième"];

// Sur grand écran, la première place au centre, plus haute : 2 · 1 · 3. Sur téléphone, dans l'ordre.
const PODIUM_ORDER = ["lg:order-2", "lg:order-1", "lg:order-3"];
const COLUMNS: Record<number, string> = { 1: "lg:max-w-xl", 2: "lg:grid-cols-2", 3: "lg:grid-cols-3" };

/** Podium de l'accueil : les personnages les plus hauts, déjà classés (voir pickChampions). */
export function ChampionPodium({ champions }: { champions: CharacterListItem[] }) {
  if (champions.length === 0) return null;
  return (
    <section className="mb-8" aria-labelledby="podium-title">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="podium-title" className="eyebrow text-gold">
          Les plus hauts niveaux
        </h2>
        <p className="text-xs text-muted">Niveau, puis expérience, puis niveau d&apos;objet</p>
      </div>
      <ol className={`grid grid-cols-1 gap-4 lg:items-end ${COLUMNS[champions.length] ?? COLUMNS[3]}`}>
        {champions.map((character, index) => (
          <li key={character.id} className={champions.length === 3 ? PODIUM_ORDER[index] : undefined}>
            <ChampionCard character={character} rank={index + 1} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function ChampionCard({ character, rank }: { character: CharacterListItem; rank: number }) {
  const icon = classIconUrl(character.class);
  const percent = progressPercent(character.xp, character.xpMax);
  return (
    <article className="champion" data-class={classKey(character.class)} data-rank={rank}>
      {/* Grande icône floue en fond : la classe se lit d'un coup d'œil, sans style en ligne. */}
      {icon && <GameIcon src={icon} size={56} className="champion-backdrop" />}

      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <RankMedal rank={rank} />
          <span className="eyebrow">{RANK_LABELS[rank - 1]}</span>
        </span>
        <FactionBadge faction={character.faction} />
      </div>

      <div className="mt-4 flex items-center gap-4">
        <ClassAvatar name={character.name} classToken={character.class} size="lg" />
        <div className="min-w-0">
          <h3 className="champion-name display truncate font-bold leading-tight class-text" title={character.name}>
            <Link href={`/characters/${character.id}`} prefetch={false} className="after:absolute after:inset-0 after:z-10 focus-visible:outline-none">
              {character.name}
            </Link>
          </h3>
          <p className="mt-0.5 truncate text-sm text-text">
            {classLabel(character.class)}
            {character.race && <span className="text-muted"> · {character.race}</span>}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted">
            {character.guild ? <span className="text-ok/85">&lt;{character.guild}&gt; </span> : null}
            {character.realm}
          </p>
        </div>
      </div>

      <div className="mt-5 flex items-end gap-5">
        <p className="flex-none">
          <span className="eyebrow block">Niveau</span>
          <span className="champion-level">{character.level}</span>
        </p>
        {percent !== null && (
          <div className="min-w-0 flex-1 pb-2.5">
            <div className="mb-1 flex items-baseline justify-between gap-2 text-xs text-muted">
              <span>Vers le niveau {character.level! + 1}</span>
              <span className="tabular-nums text-text">{percent} %</span>
            </div>
            <Meter value={character.xp} max={character.xpMax} label={`Progression de ${character.name} vers le niveau suivant`} />
          </div>
        )}
      </div>

      {/* Sur téléphone, le compte prend sa ligne (une adresse ne tient pas en un tiers de carte) ; les
          deuxième et troisième places y gardent l'essentiel : ces chiffres sont aussi sur leur carte plus bas. */}
      <dl
        className={`mt-5 grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4 text-sm sm:grid-cols-[minmax(0,1.3fr)_auto_auto] ${rank === 1 ? "grid" : "hidden sm:grid"}`}
      >
        <div className="col-span-2 min-w-0 sm:col-span-1">
          <dt className="eyebrow">Compte</dt>
          <dd className="mt-0.5 flex items-center gap-1.5 truncate" title={character.account.label}>
            {character.account.featured && <StarIcon size={13} className="flex-none text-gold" />}
            <span className="truncate">{character.account.label}</span>
          </dd>
        </div>
        <div>
          <dt className="eyebrow">Niv. d&apos;objet</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">{formatItemLevel(character.itemLevel)}</dd>
        </div>
        <div>
          <dt className="eyebrow">Or</dt>
          <dd className="mt-0.5">
            <Money copper={character.moneyCopper} />
          </dd>
        </div>
      </dl>
    </article>
  );
}
