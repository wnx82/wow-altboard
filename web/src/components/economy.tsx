import Link from "next/link";
import type { Holding, ItemName, MarketSummary } from "@/lib/economy/load";
import { itemLabel, itemQuality } from "@/lib/economy/load";
import { REASON_LABELS } from "@/lib/economy/opportunities";
import { holdingPlace } from "@/lib/economy/stock-view";
import { confidenceTone, formatChange, itemHref } from "@/lib/economy/view";
import { classKey, formatDateTime, formatInteger } from "@/lib/wow/format";

// Éléments partagés des pages de l'économie. Composants serveur : aucun état côté navigateur.

/** Choix de l'hôtel des ventes : affiché seulement quand plusieurs marchés existent. */
export function MarketSelector({ path, market, markets }: { path: string; market: MarketSummary; markets: MarketSummary[] }) {
  if (markets.length < 2) return null;
  return (
    <nav aria-label="Hôtel des ventes" className="mt-5 flex flex-wrap gap-2">
      {markets.map((entry, index) => (
        <Link
          key={entry.id}
          href={index === 0 ? path : `${path}?market=${entry.id}`}
          prefetch={false}
          className="button"
          aria-current={entry.id === market.id ? "true" : undefined}
        >
          {entry.label}
        </Link>
      ))}
    </nav>
  );
}

/** Nom d'un objet (couleur de sa qualité quand elle est connue), lié à sa fiche de marché. */
export function ItemName({ itemKey, names, query = "" }: { itemKey: string; names: ReadonlyMap<string, ItemName>; query?: string }) {
  const quality = itemQuality(names, itemKey);
  return (
    <Link href={itemHref(itemKey, query)} prefetch={false} className="font-semibold hover:underline" data-quality={quality ?? undefined}>
      <span className={quality === null ? undefined : "quality-text"}>{itemLabel(names, itemKey)}</span>
    </Link>
  );
}

/** Détenteurs d'un objet : personnage (couleur de classe, lien), quantité et emplacement. */
export function Holders({ holdings, limit = 3 }: { holdings: readonly Holding[]; limit?: number }) {
  const shown = holdings.slice(0, limit);
  const rest = holdings.length - shown.length;
  return (
    <span>
      {shown.map((holding, index) => (
        <span key={holding.characterId} data-class={classKey(holding.characterClass)}>
          {index > 0 && " · "}
          <Link href={`/characters/${holding.characterId}`} prefetch={false} className="class-text font-semibold hover:underline">
            {holding.characterName}
          </Link>{" "}
          <span className="tabular-nums">{formatInteger(holding.quantity)}</span>{" "}
          <span className="text-faint">({holdingPlace(holding, formatInteger)})</span>
        </span>
      ))}
      {rest > 0 && (
        <span className="text-faint">
          {" "}
          · {rest} autre{rest > 1 ? "s" : ""}
        </span>
      )}
    </span>
  );
}

/** Ce que vous détenez d'un objet à vendre ou à garder : quantité totale et détenteurs, au dernier relevé. */
export function OwnedStock({ holdings }: { holdings: readonly Holding[] }) {
  const total = holdings.reduce((sum, holding) => sum + holding.quantity, 0);
  // Des span, pas un paragraphe : le composant se place aussi dans une ligne de texte.
  if (total === 0) return <span className="block text-xs text-warn">Plus aucun en stock au dernier relevé : vendu ou utilisé depuis le calcul.</span>;
  return (
    <span className="block text-xs text-muted">
      Vous en avez <span className="font-semibold tabular-nums text-text">{formatInteger(total)}</span> : <Holders holdings={holdings} />
    </span>
  );
}

/** Score de confiance (0-100) : couleur doublée du nombre, jamais seule. */
export function Confidence({ value }: { value: number }) {
  return (
    <span className="badge tabular-nums" data-tone={confidenceTone(value)} title="Confiance du moteur, sur 100">
      {value}
    </span>
  );
}

export function Change({ value }: { value: number | null }) {
  if (value === null) return <span className="text-faint">—</span>;
  return <span className={value > 0 ? "text-ok" : value < 0 ? "text-danger" : "text-muted"}>{formatChange(value)}</span>;
}

export function Reasons({ codes }: { codes: readonly string[] }) {
  return (
    <ul className="flex flex-wrap gap-1">
      {codes.map((code) => (
        <li key={code} className="badge" title={code}>
          {REASON_LABELS[code] ?? code}
        </li>
      ))}
    </ul>
  );
}

/** Source des prix affichés : dernier relevé reçu. Toujours visible, une décision se juge à sa fraîcheur. */
export function MarketSource({ lastImport, lastDay }: { lastImport: { receivedAt: Date; fileModifiedAt: Date } | null; lastDay: string | null }) {
  if (!lastImport) return <span>Aucun relevé reçu.</span>;
  return (
    <span>
      Dernier relevé Auctionator du {lastDay ?? "—"}, fichier écrit le {formatDateTime(lastImport.fileModifiedAt)}, reçu le{" "}
      {formatDateTime(lastImport.receivedAt)}.
    </span>
  );
}
