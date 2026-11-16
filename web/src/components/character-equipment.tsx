"use client";

import { classKey, classLabel, formatItemLevel, QUALITY_LABELS, SLOT_LABELS } from "@/lib/wow/format";
import type { GearSpec } from "@/lib/wow/gear";
import { classIconUrl } from "@/lib/wow/icons";
import { countByQuality, filledSlots, layoutPaperdoll, type PaperdollCell, type PaperdollColumn } from "@/lib/wow/paperdoll";
import { GameTooltip, ItemDetails, ItemIcon, type SlotEvents, type Tip, TOOLTIP_ID, useItemTip } from "./item-slots";
import { GameIcon } from "./ui";

// Équipement de la fiche d'un personnage, à la manière de la fenêtre Personnage du jeu : armure à gauche
// et à droite, armes en bas, la classe au centre. Même bulle que les inventaires au survol, au clavier
// ou d'un clic ; celle d'un objet enchanté porte la ligne verte de son enchantement.

export type EquipmentRow = {
  slot: number;
  /** Clé de la bulle (« 2969 », ou « 2969e24 » quand l'objet est enchanté) ; null sans identifiant d'objet. */
  tipKey: string | null;
  name: string;
  quality: number | null;
  qualityLabel: string | undefined;
  icon: string | null;
  itemLevel: number | null;
  gear?: GearSpec;
};

/** Le personnage, au centre de la fiche. itemLevel : niveau d'objet moyen relevé par l'addon. */
export type EquipmentHero = { name: string; classToken: string | null; level: number | null; itemLevel: number | null };

const COLUMNS: readonly { column: PaperdollColumn; label: string }[] = [
  { column: "left", label: "Armure, côté gauche" },
  { column: "right", label: "Armure, côté droit" },
  { column: "weapons", label: "Armes" },
];

/** enchants : effet de l'enchantement de chaque emplacement, rendu par le serveur (il arrive en différé). */
export function CharacterEquipment({
  rows,
  enchants,
  hero,
}: {
  rows: EquipmentRow[];
  enchants: Record<number, React.ReactNode>;
  hero: EquipmentHero;
}) {
  const { tip, events, close } = useItemTip();
  const tipRow = tip ? rows.find((row) => `equipment-${row.slot}` === tip.slotId) : undefined;
  const sheet = layoutPaperdoll(rows);

  return (
    <>
      <div className="paperdoll" data-class={classKey(hero.classToken)}>
        <Summary rows={rows} enchanted={rows.filter((row) => enchants[row.slot] !== undefined).length} hero={hero} />
        {COLUMNS.map(({ column, label }) => (
          <ul key={column} className="paperdoll-column" data-column={column} aria-label={label}>
            {sheet[column].map((cell) => (
              <li key={cell.slot}>
                <EquipmentSlot cell={cell} enchant={enchants[cell.slot]} tip={tip} events={events} />
              </li>
            ))}
          </ul>
        ))}
      </div>
      {tip && tipRow && (
        <GameTooltip tip={tip} title={tipRow.name} quality={tipRow.quality} onClose={close}>
          <ItemDetails itemKey={tip.itemKey} gear={tipRow.gear} pinned={tip.pinned} />
        </GameTooltip>
      )}
    </>
  );
}

/** Centre de la fiche : la classe en médaillon, le niveau d'objet, puis ce que le personnage porte. */
function Summary({ rows, enchanted, hero }: { rows: EquipmentRow[]; enchanted: number; hero: EquipmentHero }) {
  const icon = classIconUrl(hero.classToken);
  const { filled, total } = filledSlots(rows);
  const qualities = countByQuality(rows);
  return (
    <div className="paperdoll-center">
      <span className="paperdoll-medallion" aria-hidden="true">
        {icon && <GameIcon src={icon} size={96} />}
      </span>
      <div>
        <p className="display class-text text-xl font-bold leading-tight">{hero.name}</p>
        <p className="mt-0.5 text-sm text-muted">
          {classLabel(hero.classToken)}
          {hero.level !== null && ` · niveau ${hero.level}`}
        </p>
      </div>
      <p className="paperdoll-ilvl">
        <span>Niveau d&apos;objet</span>
        <strong>{formatItemLevel(hero.itemLevel)}</strong>
      </p>
      <dl className="grid w-full grid-cols-2 gap-2 text-left">
        <div className="gear-stat">
          <dt className="text-[0.7rem] text-muted">Emplacements</dt>
          <dd title="Chemise et tabard mis à part">
            <strong>{filled}</strong> / {total}
          </dd>
        </div>
        <div className="gear-stat">
          <dt className="text-[0.7rem] text-muted">Enchantés</dt>
          <dd>
            <strong>{enchanted}</strong>
          </dd>
        </div>
      </dl>
      {qualities.length > 0 && (
        <ul className="paperdoll-qualities" aria-label="Objets portés par qualité">
          {qualities.map(({ quality, count }) => (
            <li key={quality} data-quality={quality}>
              <span className="quality-text">{QUALITY_LABELS[quality] ?? `Qualité ${quality}`}</span>
              <strong>{count}</strong>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Un emplacement : case d'icône au liseré de qualité, nom, niveau d'objet et enchantement ; vide, son nom seul. */
function EquipmentSlot({
  cell,
  enchant,
  tip,
  events,
}: {
  cell: PaperdollCell<EquipmentRow>;
  enchant: React.ReactNode | undefined;
  tip: Tip | null;
  events: SlotEvents;
}) {
  const row = cell.item;
  const label = SLOT_LABELS[cell.slot] ?? `Emplacement ${cell.slot}`;
  if (row === null) {
    return (
      <div className="paperdoll-slot" data-empty="">
        <span className="gear-empty paperdoll-icon" aria-hidden="true" />
        <span className="paperdoll-text">
          <span className="paperdoll-label">{label}</span>
          <span className="paperdoll-none">Vide</span>
        </span>
      </div>
    );
  }
  const slotId = `equipment-${row.slot}`;
  const open = tip?.slotId === slotId;
  const content = (
    <>
      <span className="item-slot paperdoll-icon" data-quality={row.quality ?? undefined} aria-hidden="true">
        <ItemIcon name={row.icon} size={48} />
      </span>
      <span className="paperdoll-text">
        <span className="paperdoll-label">
          {label}
          {row.itemLevel !== null && <span className="paperdoll-level"> · niv. {row.itemLevel}</span>}
        </span>
        <span className="paperdoll-name quality-text" title={row.qualityLabel}>
          {row.name}
        </span>
        {enchant !== undefined && <span className="paperdoll-enchant">{enchant}</span>}
      </span>
    </>
  );
  if (row.tipKey === null) {
    return (
      <div className="paperdoll-slot" data-quality={row.quality ?? undefined}>
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      className="paperdoll-slot"
      data-quality={row.quality ?? undefined}
      aria-describedby={open ? TOOLTIP_ID : undefined}
      aria-expanded={open && tip?.pinned === true}
      {...events(slotId, row.tipKey)}
    >
      {content}
    </button>
  );
}
