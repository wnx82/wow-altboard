"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ARMOR_TIER_COST,
  type Candidate,
  DEFAULT_PLANNER_PLACES,
  type EquippedItem,
  type GearPlannerData,
  MAX_LEVEL,
  planGear,
  type PlannerState,
  preferredArmor,
  readPlannerState,
  type SlotPick,
  type SlotPlan,
  writePlannerState,
} from "@/lib/dashboard/gear-planner";
import type { InventoryCharacter, InventoryGuild } from "@/lib/dashboard/inventory";
import { type Holding, PLACE_LABELS, PLACES, type InventoryPlace } from "@/lib/dashboard/inventory-view";
import { classKey, classLabel, formatInteger } from "@/lib/wow/format";
import { CLASSIC_CLASSES, gearLabel } from "@/lib/wow/gear";
import { classIconUrl } from "@/lib/wow/icons";
import { GameTooltip, ItemDetails, ItemSlot, ItemThumb, type SlotEvents, type Tip, useItemTip } from "./item-slots";
import { ClassAvatar, EmptyState, GameIcon } from "./ui";

const ARMOR_NAMES: Record<number, string> = { 1: "tissu", 2: "cuir", 3: "mailles", 4: "plaques" };
/** Détenteurs listés dans la bulle d'un objet. */
const TOOLTIP_HOLDERS = 8;

type Context = {
  characters: Map<number, InventoryCharacter>;
  guilds: Map<number, InventoryGuild>;
  tip: Tip | null;
  events: SlotEvents;
};

/** Page Équipement : pour une classe ou un personnage, le meilleur équipement en réserve, emplacement par emplacement. */
export function GearPlanner({ data, now: nowIso }: { data: GearPlannerData; now: string }) {
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const searchParams = useSearchParams();
  const [state, setState] = useState<PlannerState>(() => readPlannerState(searchParams));
  // Saisie du niveau en cours : un champ vidé reste vide jusqu'à un niveau valable ou la sortie du champ.
  const [levelDraft, setLevelDraft] = useState<string | null>(null);
  const { tip, events, close } = useItemTip();

  // replaceState : un réglage ne crée pas d'étape dans l'historique.
  useEffect(() => {
    const search = writePlannerState(state, window.location.search);
    if (search !== window.location.search) window.history.replaceState(null, "", `${window.location.pathname}${search}${window.location.hash}`);
  }, [state]);

  const update = (patch: Partial<PlannerState>) => {
    setState((current) => ({ ...current, ...patch }));
    close();
  };

  const characters = useMemo(() => new Map(data.characters.map((character) => [character.id, character])), [data.characters]);
  const guilds = useMemo(() => new Map(data.guilds.map((guild) => [guild.id, guild])), [data.guilds]);
  // Personnages de Classic, les plus avancés d'abord : les règles de port ne connaissent pas les autres classes.
  const choices = useMemo(
    () =>
      data.characters
        .filter((character) => character.class !== null && CLASSIC_CLASSES.includes(character.class))
        .sort((a, b) => (b.level ?? 0) - (a.level ?? 0) || a.name.localeCompare(b.name, "fr")),
    [data.characters],
  );
  const plan = useMemo(() => planGear(data, state, now), [data, state, now]);
  const candidates = useMemo(() => {
    const byKey = new Map<string, Candidate>();
    for (const slot of plan?.slots ?? []) for (const candidate of [...slot.picks, ...slot.others]) byKey.set(candidate.itemKey, candidate);
    return byKey;
  }, [plan]);
  const tipCandidate = tip ? candidates.get(tip.itemKey) : undefined;
  const available = useMemo(
    () => PLACES.filter((place) => (place === "guild" ? data.guilds.length > 0 : data.entries.some((entry) => entry.location === place))),
    [data],
  );

  const target = plan?.target ?? null;
  const character = target?.character ?? null;
  const level = target?.level ?? (state.level === "" ? MAX_LEVEL : Number(state.level));
  const lostCharacter = /^\d+$/.test(state.target) && !choices.some((choice) => String(choice.id) === state.target);
  const togglePlace = (place: InventoryPlace) => {
    const selected = state.places.includes(place) ? state.places.filter((candidate) => candidate !== place) : [...state.places, place];
    update({ places: selected.length === 0 ? [...DEFAULT_PLANNER_PLACES] : selected });
  };
  const context: Context = { characters, guilds, tip, events };

  return (
    <div className="mt-6 space-y-6">
      <section className="bag-window p-4 sm:p-5" aria-labelledby="gear-who">
        <h2 id="gear-who" className="bag-section-title">
          <span>Pour qui ?</span>
          <small>une classe, ou l&apos;un de vos personnages</small>
        </h2>
        <div className="class-picker" role="group" aria-label="Classe">
          {CLASSIC_CLASSES.map((token) => {
            const icon = classIconUrl(token);
            return (
              <button
                key={token}
                type="button"
                className="class-pick"
                data-class={token}
                aria-pressed={state.target === token}
                data-current={(state.target !== token && target?.classToken === token) || undefined}
                // Depuis un personnage, le niveau reste le sien.
                onClick={() => update({ target: token, upgrades: false, level: character ? String(level) : state.level })}
              >
                <span className="class-pick-icon" aria-hidden="true">
                  {icon && <GameIcon src={icon} size={48} />}
                </span>
                <span className="class-pick-name">{classLabel(token)}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-x-5 gap-y-3">
          <label className="flex min-w-56 flex-1 flex-col gap-1.5 text-xs font-medium text-muted sm:flex-none">
            Personnage
            <select
              className="field sm:w-72"
              value={/^\d+$/.test(state.target) ? state.target : ""}
              // « Aucun » garde la classe du personnage quitté.
              onChange={(event) =>
                event.target.value === ""
                  ? update({ target: target?.classToken ?? "", level: character ? String(level) : state.level, upgrades: false })
                  : update({ target: event.target.value, level: "" })
              }
            >
              <option value="">Aucun : la classe choisie</option>
              {lostCharacter && <option value={state.target}>Personnage introuvable</option>}
              {choices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.name} · {classLabel(choice.class)} {choice.level ?? "?"} ({choice.realm})
                </option>
              ))}
            </select>
          </label>
          <div className="flex min-w-60 flex-1 flex-col gap-1.5 text-xs font-medium text-muted">
            <span>
              <span id="gear-level-label">Niveau</span>
              {character && state.level !== "" && (
                <button type="button" className="ml-2 text-gold hover:underline" onClick={() => update({ level: "" })}>
                  revenir au niveau {character.level ?? MAX_LEVEL}
                </button>
              )}
            </span>
            <div className="flex items-center gap-3">
              <input
                type="range"
                className="level-range flex-1"
                min={1}
                max={MAX_LEVEL}
                value={level}
                aria-labelledby="gear-level-label"
                onChange={(event) => update({ level: event.target.value })}
              />
              <input
                type="number"
                inputMode="numeric"
                className="field w-[4.5rem] text-center font-semibold tabular-nums"
                min={1}
                max={MAX_LEVEL}
                value={levelDraft ?? level}
                aria-label="Niveau, en chiffres"
                onChange={(event) => {
                  const digits = event.target.value.replace(/\D/g, "").slice(0, 2);
                  setLevelDraft(digits);
                  const value = Number(digits);
                  if (value >= 1 && value <= MAX_LEVEL) update({ level: String(value) });
                }}
                onBlur={() => setLevelDraft(null)}
              />
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div role="group" aria-labelledby="gear-places-label" className="flex flex-wrap items-center gap-2">
            <span id="gear-places-label" className="mr-1 text-xs font-medium text-muted">
              Chercher dans
            </span>
            {available.map((place) => (
              <button key={place} type="button" className="button" aria-pressed={state.places.includes(place)} onClick={() => togglePlace(place)}>
                {PLACE_LABELS[place]}
              </button>
            ))}
          </div>
          <span className="hidden flex-1 sm:block" />
          {target && (
            <button
              type="button"
              className="button"
              aria-pressed={state.ownArmor}
              title="Écarte les armures d'un type plus léger que le meilleur que la classe porte à ce niveau"
              onClick={() => update({ ownArmor: !state.ownArmor })}
            >
              Armure en {ARMOR_NAMES[preferredArmor(target.classToken, level)]} seulement
            </button>
          )}
          {character && (
            <button type="button" className="button" aria-pressed={state.upgrades} onClick={() => update({ upgrades: !state.upgrades })}>
              Améliorations seulement
            </button>
          )}
        </div>
      </section>

      {plan === null ? (
        <EmptyState title="Choisissez une classe ou un personnage">
          L&apos;équipement que vos personnages gardent dans leurs sacs, leurs banques, leur courrier et les banques de guilde s&apos;affiche ici,
          emplacement par emplacement, comme sur la fiche du jeu : ce que la classe peut porter au niveau choisi, le plus fort d&apos;abord.
        </EmptyState>
      ) : (
        <section className="gear-doll" aria-label="Équipement proposé">
          <div className="gear-column" data-column="left">
            {plan.slots
              .filter((slot) => slot.slot.column === "left")
              .map((slot) => (
                <SlotCard key={slot.slot.id} slot={slot} hasCharacter={character !== null} context={context} />
              ))}
          </div>
          <aside className="gear-summary panel" data-class={classKey(plan.target.classToken)}>
            <Summary plan={plan} />
          </aside>
          <div className="gear-column" data-column="right">
            {plan.slots
              .filter((slot) => slot.slot.column === "right")
              .map((slot) => (
                <SlotCard key={slot.slot.id} slot={slot} hasCharacter={character !== null} context={context} />
              ))}
          </div>
          <div className="gear-weapons">
            {plan.slots
              .filter((slot) => slot.slot.column === "weapons")
              .map((slot) => (
                <SlotCard key={slot.slot.id} slot={slot} hasCharacter={character !== null} context={context} />
              ))}
          </div>
        </section>
      )}

      {tip && tipCandidate && (
        <GameTooltip tip={tip} title={tipCandidate.name ?? `Objet n° ${tipCandidate.itemKey}`} quality={tipCandidate.quality} onClose={close}>
          <ItemDetails itemKey={tipCandidate.itemKey} gear={tipCandidate.spec} pinned={tip.pinned} />
          <div className="tooltip-rule" />
          <ul className="space-y-0.5">
            {tipCandidate.holdings.slice(0, TOOLTIP_HOLDERS).map((holding) => (
              <li key={holdingKey(holding)} className="flex items-baseline justify-between gap-6">
                <span className="min-w-0 truncate">
                  <HolderLabel holding={holding} context={context} />
                </span>
                <span className="tabular-nums">{formatInteger(holding.quantity)}</span>
              </li>
            ))}
          </ul>
          {tipCandidate.holdings.length > TOOLTIP_HOLDERS && (
            <p className="mt-1 text-[0.72rem] text-[#8f9bb8]">et {formatInteger(tipCandidate.holdings.length - TOOLTIP_HOLDERS)} autres détenteurs</p>
          )}
        </GameTooltip>
      )}
    </div>
  );
}

const holdingKey = (holding: Holding) => (holding.kind === "guild" ? `g${holding.guildId}-${holding.tab}` : `c${holding.characterId}-${holding.location}`);

/** Qui détient l'objet, et où : « Élodie · Banque », ou « <Ordre> · Onglet 2 ». */
function HolderLabel({ holding, context }: { holding: Holding; context: Context }) {
  if (holding.kind === "guild") {
    const guild = context.guilds.get(holding.guildId);
    const tab = guild?.tabs.find((candidate) => candidate.index === holding.tab)?.name ?? `Onglet ${holding.tab}`;
    return (
      <>
        <span className="text-[#40ff40]">&lt;{guild?.name ?? "Guilde"}&gt;</span> <span className="text-muted">· {tab}</span>
      </>
    );
  }
  const character = context.characters.get(holding.characterId);
  return (
    <>
      <Link href={`/characters/${holding.characterId}`} className="class-text hover:underline" data-class={classKey(character?.class ?? null)}>
        {character?.name ?? "?"}
      </Link>{" "}
      <span className="text-muted">· {PLACE_LABELS[holding.location]}</span>
    </>
  );
}

/** Centre de la fiche : pour qui, à quel niveau, et ce que la recherche a trouvé. */
function Summary({ plan }: { plan: NonNullable<ReturnType<typeof planGear>> }) {
  const { target } = plan;
  const filled = plan.slots.filter((slot) => slot.picks.length > 0).length;
  const icon = classIconUrl(target.classToken);
  return (
    <div className="flex flex-col items-center gap-3 p-5 text-center">
      {target.character ? (
        <ClassAvatar name={target.character.name} classToken={target.classToken} size="lg" level={target.level} />
      ) : (
        <span className="avatar size-16" data-class={classKey(target.classToken)} aria-hidden="true">
          {icon && <GameIcon src={icon} size={64} />}
        </span>
      )}
      <div>
        {target.character ? (
          <Link href={`/characters/${target.character.id}`} className="display class-text text-xl font-bold hover:underline">
            {target.character.name}
          </Link>
        ) : (
          <p className="display class-text text-xl font-bold">{classLabel(target.classToken)}</p>
        )}
        <p className="mt-0.5 text-sm text-muted">
          {target.character ? `${classLabel(target.classToken)} · ` : ""}niveau {target.level}
          {target.character?.level != null && target.character.level !== target.level ? ` (actuellement ${target.character.level})` : ""}
        </p>
      </div>
      <dl className="grid w-full grid-cols-2 gap-2 text-left">
        <div className="gear-stat">
          <dt className="text-[0.7rem] text-muted">Emplacements garnis</dt>
          <dd>
            <strong>{filled}</strong> / {plan.slots.length}
          </dd>
        </div>
        {target.character ? (
          <div className="gear-stat">
            <dt className="text-[0.7rem] text-muted">Améliorations</dt>
            <dd>
              <strong className={plan.upgrades > 0 ? "text-ok" : undefined}>{plan.upgrades}</strong>
            </dd>
          </div>
        ) : (
          <div className="gear-stat">
            <dt className="text-[0.7rem] text-muted">Objets portables</dt>
            <dd>
              <strong>{formatInteger(plan.found)}</strong>
            </dd>
          </div>
        )}
      </dl>
      <p className="text-[0.72rem] leading-relaxed text-faint">
        Classés par niveau d&apos;objet ; une armure plus légère que celle de la classe perd {ARMOR_TIER_COST} niveaux par rang. Les
        caractéristiques (force, intelligence…) ne sont pas comparées : survolez un objet pour le détail. Un objet lié quand équipé que
        son détenteur a déjà porté lui reste lié : le relevé ne le dit pas.
      </p>
    </div>
  );
}

function SlotCard({ slot, hasCharacter, context }: { slot: SlotPlan; hasCharacter: boolean; context: Context }) {
  const upgrade = slot.picks.some((pick) => pick.delta !== null && pick.delta > 0);
  const titleId = `gear-slot-${slot.slot.id}`;
  return (
    <article className="gear-card" data-empty={slot.picks.length === 0 || undefined} data-upgrade={upgrade || undefined} aria-labelledby={titleId}>
      <h3 id={titleId} className="gear-card-label">
        <span>{slot.label}</span>
        {upgrade && <span className="text-ok">amélioration</span>}
      </h3>
      {slot.picks.length === 0 ? (
        <div className="flex items-center gap-3">
          <span className="gear-empty" aria-hidden="true" />
          <p className="text-xs text-faint">{hasCharacter && slot.equipped.length > 0 ? "Rien de mieux en réserve." : "Rien en réserve pour cet emplacement."}</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {/* Un anneau détenu en deux exemplaires peut occuper les deux places : la clé suit la place. */}
          {slot.picks.map((pick, index) => (
            <PickRow key={index} pick={pick} slotId={`${slot.slot.id}${index}`} context={context} />
          ))}
        </div>
      )}
      {hasCharacter && <Worn items={slot.equipped} count={slot.slot.count} />}
      {slot.others.length > 0 && (
        <details className="gear-others">
          <summary>
            {slot.others.length} autre{slot.others.length > 1 ? "s" : ""} choix
          </summary>
          <ul className="mt-1.5 space-y-1.5">
            {slot.others.map((other) => (
              <li key={other.itemKey} className="flex items-center gap-2 text-xs">
                <ItemThumb icon={other.icon} quality={other.quality} />
                <span className="min-w-0 flex-1">
                  <span className="quality-text block truncate font-medium" data-quality={other.quality ?? undefined}>
                    {other.name ?? `Objet n° ${other.itemKey}`}
                  </span>
                  <span className="block truncate text-faint">
                    {other.spec.itemLevel ?? "?"} · <HolderLabel holding={other.holdings[0]} context={context} />
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

function PickRow({ pick, slotId, context }: { pick: SlotPick; slotId: string; context: Context }) {
  const others = pick.holdings.length - 1;
  return (
    <div className="flex items-start gap-3">
      <div className="w-12 flex-none">
        <ItemSlot
          info={{ name: pick.name, quality: pick.quality, icon: pick.icon, gear: pick.spec }}
          itemKey={pick.itemKey}
          slotId={`${slotId}:${pick.itemKey}`}
          quantity={1}
          tip={context.tip}
          events={context.events}
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="quality-text truncate text-sm font-semibold" data-quality={pick.quality ?? undefined}>
          {pick.name ?? `Objet n° ${pick.itemKey}`}
        </p>
        <p className="truncate text-xs text-muted">
          {pick.spec.itemLevel === null ? (
            <span className="text-faint" title="Objet propre à WoW Forever, absent des tables de wago.tools : classé après les autres">
              niveau inconnu
            </span>
          ) : (
            <span className="font-semibold text-text tabular-nums">{pick.spec.itemLevel}</span>
          )}{" "}
          · {gearLabel(pick.spec)}
          {pick.spec.requiredLevel !== null && pick.spec.requiredLevel > 1 ? ` · niv. ${pick.spec.requiredLevel}` : ""}
          {pick.bound && <span className="ml-1.5 badge">lié</span>}
        </p>
        <p className="truncate text-xs">
          <HolderLabel holding={pick.holdings[0]} context={context} />
          {others > 0 && <span className="text-faint"> · +{others}</span>}
        </p>
      </div>
      {pick.delta !== null && (
        <span className="gear-delta" data-tone={pick.delta > 0 ? "up" : pick.delta < 0 ? "down" : "same"} title={`Écart de niveau d'objet avec l'objet porté ; une armure plus légère que celle de la classe compte ${ARMOR_TIER_COST} de moins par rang`}>
          {pick.delta > 0 ? `+${pick.delta}` : pick.delta === 0 ? "=" : pick.delta}
        </span>
      )}
    </div>
  );
}

/** Ce que le personnage porte à cet emplacement, pour comparer. */
function Worn({ items, count }: { items: EquippedItem[]; count: number }) {
  return (
    <p className="gear-worn">
      <span className="text-faint">Porté :</span>{" "}
      {items.length === 0
        ? "rien"
        : items.map((item, index) => (
            <span key={item.slot}>
              {index > 0 && ", "}
              <span className="quality-text" data-quality={item.quality ?? undefined}>
                {item.name ?? (item.itemId === null ? "objet inconnu" : `objet n° ${item.itemId}`)}
              </span>
              {item.itemLevel !== null && <span className="text-faint"> ({item.itemLevel})</span>}
            </span>
          ))}
      {count > 1 && items.length > 0 && items.length < count && <span className="text-faint">, un emplacement vide</span>}
    </p>
  );
}
