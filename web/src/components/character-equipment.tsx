"use client";

import type { GearSpec } from "@/lib/wow/gear";
import { GameTooltip, ItemDetails, ItemThumb, TOOLTIP_ID, useItemTip } from "./item-slots";

// Équipement de la fiche d'un personnage : un tableau, et la même bulle que les inventaires au survol,
// au clavier ou d'un clic. La bulle d'un objet enchanté porte la ligne verte de son enchantement.

export type EquipmentRow = {
  slot: number;
  slotLabel: string;
  /** Clé de la bulle (« 2969 », ou « 2969e24 » quand l'objet est enchanté) ; null sans identifiant d'objet. */
  tipKey: string | null;
  name: string;
  quality: number | null;
  qualityLabel: string | undefined;
  icon: string | null;
  itemLevel: number | null;
  gear?: GearSpec;
};

/** enchants : effet de l'enchantement de chaque emplacement, rendu par le serveur (il arrive en différé). */
export function CharacterEquipment({ rows, enchants }: { rows: EquipmentRow[]; enchants: Record<number, React.ReactNode> }) {
  const { tip, events, close } = useItemTip();
  const tipRow = tip ? rows.find((row) => `equipment-${row.slot}` === tip.slotId) : undefined;

  return (
    <>
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Emplacement</th>
            <th scope="col">Objet</th>
            <th scope="col" className="num">
              Niveau
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const slotId = `equipment-${row.slot}`;
            const open = tip?.slotId === slotId;
            const label = (
              <>
                <ItemThumb icon={row.icon} quality={row.quality} />
                <span className="quality-text font-medium" title={row.qualityLabel}>
                  {row.name}
                </span>
              </>
            );
            return (
              <tr key={row.slot} data-quality={row.quality ?? undefined}>
                <td className="whitespace-nowrap text-muted">{row.slotLabel}</td>
                <td>
                  {row.tipKey === null ? (
                    <span className="item-link">{label}</span>
                  ) : (
                    <button
                      type="button"
                      className="item-link cursor-pointer text-left hover:underline"
                      aria-describedby={open ? TOOLTIP_ID : undefined}
                      aria-expanded={open && tip?.pinned === true}
                      {...events(slotId, row.tipKey)}
                    >
                      {label}
                    </button>
                  )}
                  {enchants[row.slot] !== undefined && <span className="block pl-[1.9rem] text-xs text-ok">{enchants[row.slot]}</span>}
                </td>
                <td className="num">{row.itemLevel ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {tip && tipRow && (
        <GameTooltip tip={tip} title={tipRow.name} quality={tipRow.quality} onClose={close}>
          <ItemDetails itemKey={tip.itemKey} gear={tipRow.gear} pinned={tip.pinned} />
        </GameTooltip>
      )}
    </>
  );
}
