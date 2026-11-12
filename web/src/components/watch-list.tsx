import Link from "next/link";
import { SOON_DAYS } from "@/lib/dashboard/inventory-view";
import { EQUIPMENT_MIN_LEVEL, SILENT_MACHINE_DAYS, STALE_CHARACTER_DAYS, watchCount, type WatchEntry, type WatchList } from "@/lib/dashboard/watch";
import { classKey } from "@/lib/wow/format";

/** Personnages affichés par ligne avant « et N autres » : le bloc reste court. */
const SHOWN = 8;

/** Alerte de prix déclenchée, prête à afficher : nom de l'objet, prix et seuil, lien vers sa fiche. */
export type WatchAlert = { id: number; label: string; quality: number | null; detail: string; href: string };

function CharacterChips({ entries }: { entries: WatchEntry[] }) {
  const shown = entries.slice(0, SHOWN);
  return (
    <>
      {shown.map(({ character, detail, href }) => (
        <li key={`${character.id}-${detail}`} data-class={classKey(character.class)}>
          <Link href={href ?? `/characters/${character.id}`} prefetch={false} className="badge gap-1.5 hover:border-gold/60">
            <span className="font-semibold class-text">{character.name}</span>
            <span className="text-muted">{detail}</span>
          </Link>
        </li>
      ))}
      {entries.length > SHOWN && <li className="self-center text-xs text-muted">et {entries.length - SHOWN} autres</li>}
    </>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-x-4 gap-y-1.5 px-5 py-3 sm:grid-cols-[13rem_1fr]">
      <p className="text-sm font-semibold text-text">
        {label}
        {hint && <span className="block text-xs font-normal text-muted">{hint}</span>}
      </p>
      <ul className="flex flex-wrap gap-1.5">{children}</ul>
    </div>
  );
}

/** Bloc « À surveiller » de l'accueil ; rien n'est affiché quand il n'y a rien à signaler. */
export function WatchListPanel({ list, alerts = [] }: { list: WatchList; alerts?: WatchAlert[] }) {
  const count = watchCount(list) + alerts.length;
  if (count === 0) return null;
  return (
    <section className="mb-8" aria-labelledby="watch-title">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p id="watch-title" className="eyebrow">
          À surveiller
        </p>
        <p className="text-xs text-muted">D&apos;après les derniers relevés</p>
      </div>
      <div className="panel divide-y divide-line">
        {alerts.length > 0 && (
          <Row label="Alertes de prix" hint="Dernier prix relevé à l'hôtel des ventes">
            {alerts.slice(0, SHOWN).map((alert) => (
              <li key={alert.id}>
                <Link href={alert.href} prefetch={false} className="badge gap-1.5 hover:border-gold/60" data-tone="warn">
                  <span className="font-semibold" data-quality={alert.quality ?? undefined}>
                    <span className={alert.quality === null ? undefined : "quality-text"}>{alert.label}</span>
                  </span>
                  <span>{alert.detail}</span>
                </Link>
              </li>
            ))}
            {alerts.length > SHOWN && (
              <li className="self-center text-xs text-muted">
                <Link href="/market" prefetch={false} className="hover:underline">
                  et {alerts.length - SHOWN} autres
                </Link>
              </li>
            )}
          </Row>
        )}
        {list.mail.length > 0 && (
          <Row label="Courrier à récupérer" hint={`Expire dans les ${SOON_DAYS} jours : renvoyé ou supprimé ensuite`}>
            <CharacterChips entries={list.mail} />
          </Row>
        )}
        {list.silentMachines.length > 0 && (
          <Row label="PC muets" hint={`Aucun envoi depuis ${SILENT_MACHINE_DAYS} jours ou plus`}>
            {list.silentMachines.map(({ machine, days }) => (
              <li key={machine.id}>
                <Link href="/machines" prefetch={false} className="badge gap-1.5 hover:border-gold/60" data-tone="warn">
                  <span className="font-semibold">{machine.label}</span>
                  <span>{days} jours</span>
                </Link>
              </li>
            ))}
          </Row>
        )}
        {list.bags.length > 0 && (
          <Row label="Sacs pleins">
            <CharacterChips entries={list.bags} />
          </Row>
        )}
        {list.professions.length > 0 && (
          <Row label="Métiers à former" hint="Rang maximum du palier atteint">
            <CharacterChips entries={list.professions} />
          </Row>
        )}
        {list.emptySlots.length > 0 && (
          <Row label="Équipement incomplet" hint={`Emplacements vides à partir du niveau ${EQUIPMENT_MIN_LEVEL}, sans chemise, tabard, main gauche ni arme à distance`}>
            <CharacterChips entries={list.emptySlots} />
          </Row>
        )}
        {list.stale.length > 0 && (
          <Row label="Pas vus en jeu" hint={`Depuis ${STALE_CHARACTER_DAYS} jours ou plus`}>
            <CharacterChips entries={list.stale} />
          </Row>
        )}
        {list.bank.length > 0 && (
          <Row label="Banque jamais relevée" hint="Ouvrir la banque en jeu une fois">
            <CharacterChips entries={list.bank} />
          </Row>
        )}
      </div>
    </section>
  );
}
