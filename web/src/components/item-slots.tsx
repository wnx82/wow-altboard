"use client";

import { getImageProps } from "next/image";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { slotCount, type ExpiryFlag } from "@/lib/dashboard/inventory-view";
import { formatInteger } from "@/lib/wow/format";
import { allowedClassesLabel, bindingLabel, type GearSpec, gearSlotLabel, gearTypeLabel } from "@/lib/wow/gear";
import { itemIconUrl } from "@/lib/wow/icons";
import { Money } from "./ui";

// Cases d'objet et bulle à la manière du jeu, partagées par la page Inventaires et la fiche d'un
// personnage. La bulle est rendue hors de la grille (portail) et placée par le DOM : la CSP refuse
// les attributs style.

/** Ce qu'une case affiche d'un objet ; icon : nom de fichier de l'icône, null quand il est inconnu. */
export type SlotItem = { name: string | null; quality: number | null; icon: string | null; gear?: GearSpec };

export const TOOLTIP_ID = "item-tooltip";

export const itemName = (info: SlotItem | undefined, itemKey: string) => info?.name ?? `Objet n° ${itemKey}`;

/** Icône servie par l'optimiseur d'images ; une icône absente du CDN (propre à WoW Forever) devient le point d'interrogation du jeu. */
export function ItemIcon({ name, size = 56 }: { name: string | null; size?: number }) {
  const ref = useRef<HTMLImageElement>(null);
  const [failed, setFailed] = useState(false);
  // Une erreur survenue avant l'hydratation n'a déclenché aucun gestionnaire : elle se lit sur l'image.
  useEffect(() => {
    const image = ref.current;
    if (image && image.complete && image.naturalWidth === 0) setFailed(true);
  }, []);
  const { props } = getImageProps({ src: itemIconUrl(failed ? null : name), alt: "", width: size, height: size });
  // eslint-disable-next-line @next/next/no-img-element -- getImageProps fournit déjà src et srcSet optimisés
  return <img {...props} ref={ref} alt="" style={undefined} draggable={false} onError={failed ? undefined : () => setFailed(true)} />;
}

/** Petite case devant un nom d'objet : icône et liseré de qualité. Décorative, le nom est écrit à côté. */
export function ItemThumb({ icon, quality }: { icon: string | null | undefined; quality: number | null | undefined }) {
  return (
    <span className="item-thumb" data-quality={quality ?? undefined} aria-hidden="true">
      <ItemIcon name={icon ?? null} size={32} />
    </span>
  );
}

/**
 * Case dont la bulle est ouverte : survolée ou atteinte au clavier, ou épinglée d'un clic. slotId
 * distingue deux cases du même objet (sacs et banque d'un personnage).
 */
export type Tip = { slotId: string; itemKey: string; anchor: HTMLElement; pinned: boolean };

export type SlotEvents = (
  slotId: string,
  itemKey: string,
) => {
  onPointerEnter: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerLeave: (event: React.PointerEvent<HTMLElement>) => void;
  onFocus: (event: React.FocusEvent<HTMLElement>) => void;
  onBlur: () => void;
  onClick: (event: React.MouseEvent<HTMLElement>) => void;
};

/** Bulle ouverte et gestionnaires des cases : survol et clavier l'ouvrent, un clic l'épingle ou la referme. */
export function useItemTip() {
  const [tip, setTip] = useState<Tip | null>(null);
  // Survol et clavier ouvrent la bulle sans écraser une bulle épinglée.
  const events = useCallback<SlotEvents>(
    (slotId, itemKey) => ({
      onPointerEnter: (event) => {
        if (event.pointerType !== "mouse") return;
        const anchor = event.currentTarget;
        setTip((current) => (current?.pinned ? current : { slotId, itemKey, anchor, pinned: false }));
      },
      onPointerLeave: (event) => {
        if (event.pointerType !== "mouse") return;
        setTip((current) => (current?.pinned ? current : null));
      },
      // Le focus donné par un clic n'ouvre rien : le clic s'en charge ; seul le clavier compte ici.
      onFocus: (event) => {
        const anchor = event.currentTarget;
        if (!anchor.matches(":focus-visible")) return;
        setTip((current) => (current?.pinned ? current : { slotId, itemKey, anchor, pinned: false }));
      },
      onBlur: () => setTip((current) => (current?.pinned ? current : null)),
      onClick: (event) => {
        const anchor = event.currentTarget;
        setTip((current) => (current?.pinned && current.slotId === slotId ? null : { slotId, itemKey, anchor, pinned: true }));
      },
    }),
    [],
  );
  const close = useCallback(() => setTip(null), []);
  return { tip, events, close };
}

/** Case d'objet : icône, liseré de qualité, quantité au coin, échéance proche ou passée ; la bulle donne le détail. */
export function ItemSlot({
  info,
  itemKey,
  slotId,
  quantity,
  flag,
  tip,
  events,
}: {
  info: SlotItem | undefined;
  itemKey: string;
  slotId: string;
  quantity: number;
  flag?: ExpiryFlag | null;
  tip: Tip | null;
  events: SlotEvents;
}) {
  const open = tip?.slotId === slotId;
  return (
    <MemoSlot
      info={info}
      itemKey={itemKey}
      slotId={slotId}
      quantity={quantity}
      flagText={flag?.text ?? null}
      flagTone={flag?.tone ?? null}
      events={events}
      open={open}
      pinned={open && tip?.pinned === true}
    />
  );
}

// Mémorisée : survoler une case ne redessine que la case quittée et la case atteinte, pas la grille.
const MemoSlot = memo(function SlotButton({
  info,
  itemKey,
  slotId,
  quantity,
  flagText,
  flagTone,
  events,
  open,
  pinned,
}: {
  info: SlotItem | undefined;
  itemKey: string;
  slotId: string;
  quantity: number;
  flagText: string | null;
  flagTone: ExpiryFlag["tone"] | null;
  events: SlotEvents;
  open: boolean;
  pinned: boolean;
}) {
  const expired = flagTone === "expired";
  const note = flagTone === null ? "" : expired ? ", échu" : `, expire dans ${flagText}`;
  return (
    <button
      type="button"
      className="item-slot"
      data-quality={info?.quality ?? undefined}
      data-expired={expired || undefined}
      aria-label={`${itemName(info, itemKey)}, ${formatInteger(quantity)}${note}`}
      aria-describedby={open ? TOOLTIP_ID : undefined}
      aria-expanded={pinned}
      {...events(slotId, itemKey)}
    >
      <ItemIcon name={info?.icon ?? null} />
      {flagText !== null && (
        <span className="item-flag" data-tone={flagTone ?? undefined}>
          {flagText}
        </span>
      )}
      {quantity > 1 && <span className="item-count">{slotCount(quantity)}</span>}
    </button>
  );
});

/** Place la bulle à droite de la case, sinon à gauche, sinon dessous ou dessus, toujours dans la fenêtre. */
function placeTooltip(tooltip: HTMLElement, anchor: HTMLElement) {
  const margin = 8;
  const gap = 10;
  const box = anchor.getBoundingClientRect();
  const width = tooltip.offsetWidth;
  const height = tooltip.offsetHeight;
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight;
  let left = box.right + gap;
  let top = box.top;
  if (left + width > viewportWidth - margin) left = box.left - gap - width;
  if (left < margin) {
    left = Math.min(Math.max(margin, box.left + box.width / 2 - width / 2), viewportWidth - margin - width);
    top = box.bottom + gap;
    if (top + height > viewportHeight - margin) top = box.top - gap - height;
  }
  top = Math.min(Math.max(margin, top), viewportHeight - margin - height);
  // Propriétés posées par le DOM, pas d'attribut style : la CSP refuse les styles en ligne.
  tooltip.style.left = `${Math.round(Math.max(margin, left))}px`;
  tooltip.style.top = `${Math.round(top)}px`;
  tooltip.dataset.placed = "";
}

/**
 * Bulle d'objet à la manière du jeu : nom à la couleur de la qualité, puis le contenu donné. Échap la
 * referme ; épinglée, un clic ailleurs aussi, et le focus revient alors à la case.
 */
export function GameTooltip({
  tip,
  title,
  quality,
  onClose,
  children,
}: {
  tip: Tip;
  title: string;
  quality: number | null | undefined;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Fermée depuis l'intérieur de la bulle (bouton, lien atteint au clavier) : le focus revient à la case.
  const close = useCallback(() => {
    const focusInside = ref.current?.contains(document.activeElement) === true;
    onClose();
    if (focusInside && tip.anchor.isConnected) tip.anchor.focus({ preventScroll: true });
  }, [onClose, tip]);

  useLayoutEffect(() => {
    const tooltip = ref.current;
    if (!tooltip) return;
    const place = () => {
      if (!tip.anchor.isConnected) return onClose();
      placeTooltip(tooltip, tip.anchor);
    };
    place();
    window.addEventListener("scroll", place, { capture: true, passive: true });
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, { capture: true });
      window.removeEventListener("resize", place);
    };
  }, [tip, title, onClose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target) || tip.anchor.contains(target)) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    if (tip.pinned) document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [tip, onClose, close]);

  return createPortal(
    <div ref={ref} id={TOOLTIP_ID} role="tooltip" className="game-tooltip" data-quality={quality ?? undefined} data-pinned={tip.pinned || undefined}>
      <div className="flex items-start justify-between gap-4">
        <p className="tooltip-name">{title}</p>
        {tip.pinned && (
          <button type="button" className="-mr-1 -mt-0.5 rounded px-1 text-[#8f9bb8] hover:text-white" aria-label="Fermer" onClick={close}>
            ×
          </button>
        )}
      </div>
      {children}
      {!tip.pinned && <p className="tooltip-hint">Clic : garder la bulle ouverte</p>}
    </div>,
    document.body,
  );
}

/** Lignes d'équipement d'une bulle, comme en jeu : liaison, emplacement et type, niveaux, classes autorisées. */
export function TooltipGear({ gear }: { gear: GearSpec | undefined }) {
  if (!gear) return null;
  const slot = gearSlotLabel(gear);
  const type = gearTypeLabel(gear);
  const classes = allowedClassesLabel(gear);
  const binding = bindingLabel(gear);
  return (
    <div className="mt-1 space-y-0.5">
      {binding && <p>{binding}</p>}
      {(slot || type) && (
        <p className="flex items-baseline justify-between gap-6">
          <span>{slot}</span>
          <span>{type}</span>
        </p>
      )}
      {classes && <p>Classes : {classes}</p>}
      {gear.requiredLevel !== null && gear.requiredLevel > 1 && <p>Niveau {gear.requiredLevel} requis</p>}
      {gear.itemLevel !== null && <p className="text-[0.72rem] text-[#8f9bb8]">Niveau d&apos;objet {gear.itemLevel}</p>}
    </div>
  );
}

/** Lignes de prix d'une bulle : valeur d'une unité, puis de la pile quand il y en a plusieurs. */
export function TooltipPrice({ unit, quantity }: { unit: number | null; quantity: number }) {
  if (unit === null) return <p className="mt-1 text-[0.72rem] text-[#8f9bb8]">Pas de prix relevé à l&apos;hôtel des ventes</p>;
  return (
    <div className="mt-1 space-y-0.5">
      <p className="flex items-baseline justify-between gap-6">
        <span className="text-[#8f9bb8]">Prix unitaire</span>
        <Money copper={unit} />
      </p>
      {quantity > 1 && (
        <p className="flex items-baseline justify-between gap-6">
          <span className="text-[#8f9bb8]">Valeur ×&nbsp;{formatInteger(quantity)}</span>
          <Money copper={unit * quantity} />
        </p>
      )}
    </div>
  );
}

const goldFormat = new Intl.NumberFormat("fr-FR");

/** Valeur estimée d'un ensemble, arrondie à la pièce d'or au-delà d'une ; exemplaires sans prix signalés. */
export function ValueEstimate({ copper, unpriced }: { copper: number; unpriced: number }) {
  const without = unpriced > 0 ? `${formatInteger(unpriced)} exemplaire${unpriced > 1 ? "s" : ""} sans prix connu, non compté${unpriced > 1 ? "s" : ""}` : undefined;
  if (copper === 0 && unpriced > 0) return <span className="text-faint" title={without}>valeur inconnue</span>;
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap" title={without}>
      <span className="text-faint">≈</span>
      {copper >= 10_000 ? (
        <span className="coin-gold font-semibold tabular-nums">
          {goldFormat.format(Math.round(copper / 10_000))}
          <span className="ml-0.5 text-[0.7em] font-medium opacity-80">po</span>
        </span>
      ) : (
        <Money copper={copper} />
      )}
    </span>
  );
}
