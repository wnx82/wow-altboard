import { Money, SectionTitle } from "@/components/ui";
import { ScrollRegion } from "@/components/scroll-region";
import { TrendChart, type TrendPoint } from "@/components/trend-chart";
import { buildHistory } from "@/lib/dashboard/history";
import type { CharacterDetail } from "@/lib/dashboard/queries";
import { formatDateTime, formatInteger, formatItemLevel, formatMoney, fractionalLevel, PLAYER_TIME_ZONE, progressPercent } from "@/lib/wow/format";

// Progression : courbes du niveau et de l'or, derniers changements, tableau des relevés.

const shortDate = new Intl.DateTimeFormat("fr-BE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: PLAYER_TIME_ZONE });
const levelFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });

export function HistorySection({ character }: { character: CharacterDetail }) {
  const history = buildHistory(character.snapshots);
  // Niveau et part d'expérience acquise sur une même échelle : la courbe monte aussi entre deux niveaux.
  const levelPoints: TrendPoint[] = character.snapshots
    .filter((snapshot) => snapshot.level !== null)
    .map((snapshot) => {
      const value = fractionalLevel(snapshot.level!, snapshot.xp, snapshot.xpMax);
      const percentOfLevel = progressPercent(snapshot.xp, snapshot.xpMax);
      return {
        at: snapshot.capturedAt.toISOString(),
        value,
        label: percentOfLevel === null ? `Niveau ${snapshot.level}` : `Niveau ${snapshot.level} · ${Math.min(percentOfLevel, 99)} %`,
        valueLabel: levelFormat.format(value),
        dateLabel: shortDate.format(snapshot.capturedAt),
      };
    });
  const goldPoints: TrendPoint[] = character.snapshots
    .filter((snapshot) => snapshot.moneyCopper !== null)
    .map((snapshot) => ({
      at: snapshot.capturedAt.toISOString(),
      value: snapshot.moneyCopper! / 10_000,
      label: formatMoney(snapshot.moneyCopper),
      dateLabel: shortDate.format(snapshot.capturedAt),
    }));
  return (
    <section aria-labelledby="history" className="mt-8">
      <SectionTitle aside={`${character.snapshots.length} relevé${character.snapshots.length > 1 ? "s" : ""} conservé${character.snapshots.length > 1 ? "s" : ""}`}>
        <span id="history">Progression</span>
      </SectionTitle>
      {character.snapshots.length < 2 ? (
        <div className="panel p-5 text-sm text-muted">
          Un seul relevé pour l&apos;instant. L&apos;historique se construit à chaque synchronisation qui suit une progression en jeu (niveau, or,
          métiers, équipement, réputations).
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {levelPoints.length > 1 && <TrendChart title="Niveau et expérience" series="level" points={levelPoints} />}
          {goldPoints.length > 1 && <TrendChart title="Or" series="gold" points={goldPoints} />}
          <div className="panel p-5">
            <h3 className="eyebrow mb-3">Derniers changements</h3>
            {history.length === 0 ? (
              <p className="text-sm text-muted">Aucun changement lisible entre les relevés.</p>
            ) : (
              <ol className="max-h-72 space-y-3 overflow-y-auto pr-1 text-sm">
                {history.slice(0, 30).map((entry) => (
                  <li key={entry.at.toISOString()}>
                    <time className="text-xs text-faint" dateTime={entry.at.toISOString()}>
                      {formatDateTime(entry.at)}
                    </time>
                    <ul className="mt-0.5">
                      {entry.changes.map((change) => (
                        <li key={change.text}>{change.text}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
      {character.snapshots.length > 0 && (
        <details className="panel mt-4 overflow-hidden">
          <summary className="cursor-pointer px-5 py-3 text-sm text-muted hover:text-text">Tableau des relevés</summary>
          <ScrollRegion className="overflow-x-auto" label="Derniers changements">
            <table className="data-table">
              <caption className="sr-only">Derniers changements</caption>
              <thead>
                <tr>
                  <th scope="col">Relevé en jeu</th>
                  <th scope="col" className="num">
                    Niveau
                  </th>
                  <th scope="col" className="num">
                    XP
                  </th>
                  <th scope="col" className="num">
                    Or
                  </th>
                  <th scope="col" className="num">
                    Niv. d&apos;objet
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...character.snapshots].reverse().map((snapshot) => (
                  <tr key={snapshot.id}>
                    <th scope="row" className="whitespace-nowrap">{formatDateTime(snapshot.capturedAt)}</th>
                    <td className="num">{snapshot.level ?? "—"}</td>
                    <td className="num">{formatInteger(snapshot.xp)}</td>
                    <td className="num">
                      <Money copper={snapshot.moneyCopper} />
                    </td>
                    <td className="num">{formatItemLevel(snapshot.itemLevel)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        </details>
      )}
    </section>
  );
}
