import type { Metadata } from "next";
import Link from "next/link";
import { Confidence, ItemName, MarketSelector, MarketSource, Reasons } from "@/components/economy";
import { FarmSessionControls, FarmStartForm } from "@/components/economy-forms";
import { Money, PageHeader, SectionTitle, StatTile } from "@/components/ui";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { formatDuration } from "@/lib/dashboard/level-times";
import { farmSessionAction } from "@/lib/economy/actions";
import { loadEconomy, realizableValueOf } from "@/lib/economy/load";
import { compareSessions, listFarmCharacters, listFarmSessions, MAX_LABEL_LENGTH, type FarmComparison } from "@/lib/economy/sessions";
import { formatChange, formatDay, formatPercent, marketParam, marketQuery } from "@/lib/economy/view";
import { classKey, formatDateTime, formatInteger } from "@/lib/wow/format";

export const metadata: Metadata = { title: "Farm" };

const SIGNALS_SHOWN = 30;

export default async function FarmingPage({ searchParams }: PageProps<"/farming">) {
  await requireSession();
  const params = await searchParams;
  const db = getDatabase();
  const context = await loadEconomy(db, { marketId: marketParam(params.market), now: new Date() });
  const keep = 1 - (context?.auctionCut ?? 0.05);
  const [sessions, characters] = await Promise.all([listFarmSessions(db, realizableValueOf(context)), listFarmCharacters(db)]);
  const open = sessions.filter((session) => session.endedAt === null);
  const done = sessions.filter((session) => session.valuation !== null);
  const byLabel = compareSessions(done, "label");
  const byCharacter = compareSessions(done, "character");
  const names = context?.names ?? new Map();
  const itemQuery = context ? marketQuery(context.market, context.markets) : "";
  const best = byLabel[0] ?? null;

  return (
    <>
      <PageHeader art="jungle" section="economy" title="Farm">
        Deux mesures distinctes. Le signal de marché dit quelles ressources sont chères et peu offertes aujourd&apos;hui : ce n&apos;est pas un
        rendement. Le po/h ne vient que de vos sessions, entre deux relevés réels de vos sacs et de votre banque.
      </PageHeader>
      {context && <MarketSelector path="/farming" market={context.market} markets={context.markets} />}

      <section aria-label="Vue générale" className="mt-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile label="Ressources suivies" value={formatInteger(context?.farmSignals.length ?? 0)} hint="composants de vos recettes, hors marchand" />
        <StatTile label="Sessions mesurées" value={formatInteger(done.length)} hint={open.length > 0 ? `${open.length} en cours` : "aucune en cours"} />
        <StatTile
          label="Meilleur farm mesuré"
          value={best?.perHour === null || !best ? "—" : <Money copper={best.perHour} />}
          hint={best ? `${best.label} · par heure, ${best.sessions} session${best.sessions > 1 ? "s" : ""}` : "aucune session terminée"}
        />
        <StatTile label="Temps mesuré" value={formatDuration(done.reduce((total, s) => total + (s.valuation?.durationSeconds ?? 0), 0))} hint="durée en jeu des sessions" />
      </section>

      <section aria-label="Signal de marché" className="mt-8">
        <SectionTitle aside={context ? <MarketSource lastImport={context.lastImport} lastDay={formatDay(context.lastImport?.lastDay ?? null)} /> : undefined}>
          Bon moment pour farmer ?
        </SectionTitle>
        {!context || context.farmSignals.length === 0 ? (
          <div className="panel p-5 text-sm text-muted">
            {context ? "Aucun composant de vos recettes connues n'a de prix relevé." : "Aucun prix reçu : le signal de marché attend un scan Auctionator."}
          </div>
        ) : (
          <div className="panel overflow-x-auto">
            <table className="data-table min-w-[960px]">
              <thead>
                <tr>
                  <th scope="col">Ressource</th>
                  <th scope="col" className="num">
                    Score
                  </th>
                  <th scope="col" className="num">
                    Prix vs médiane 30 j
                  </th>
                  <th scope="col" className="num">
                    Offre vs habitude
                  </th>
                  <th scope="col" className="num">
                    Valeur unitaire nette
                  </th>
                  <th scope="col" className="num">
                    Confiance
                  </th>
                  <th scope="col">Raisons</th>
                </tr>
              </thead>
              <tbody>
                {context.farmSignals.slice(0, SIGNALS_SHOWN).map((signal) => (
                  <tr key={signal.itemKey}>
                    <td>
                      <ItemName itemKey={signal.itemKey} names={names} query={itemQuery} />
                    </td>
                    <td className="num font-semibold">{signal.score}</td>
                    <td className="num">{formatChange(signal.premium)}</td>
                    <td className="num">{signal.supplyRatio === null ? "—" : formatPercent(signal.supplyRatio)}</td>
                    <td className="num">
                      <Money copper={Math.round(signal.unitValue * keep)} />
                    </td>
                    <td className="num">
                      <Confidence value={signal.confidence} />
                    </td>
                    <td className="max-w-[22rem]">
                      <Reasons codes={signal.reasons} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-faint">
          Score sur 100 : prix au-dessus de sa médiane (moitié du score), offre moins abondante que d&apos;habitude (un quart), marché stable (un
          quart). Offre : quantité en vente le dernier jour relevé, rapportée à sa médiane sur 30 jours.
        </p>
      </section>

      <section aria-label="Sessions" className="mt-8">
        <SectionTitle aside="durée mesurée entre deux relevés des sacs">Sessions de farm</SectionTitle>
        <div className="panel p-5">
          <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-muted">
            <li>Juste avant de farmer : /reload en jeu, puis synchronisez (l&apos;agent relève sacs, banque et argent).</li>
            <li>Démarrez la session ici : elle part de ce relevé.</li>
            <li>Après le farm : /reload ou déconnexion, synchronisez, puis terminez la session.</li>
          </ol>
          {characters.length === 0 ? (
            <p className="text-sm text-muted">Aucun personnage dont les sacs ont été relevés.</p>
          ) : (
            <FarmStartForm
              action={farmSessionAction}
              maxLabelLength={MAX_LABEL_LENGTH}
              characters={characters.map((character) => ({
                id: character.id,
                zone: character.zone,
                label: `${character.name}${character.level !== null ? ` (${character.level})` : ""}${character.zone ? ` — ${character.zone}` : ""} · sacs du ${formatDateTime(character.bagsAt)}`,
              }))}
            />
          )}
        </div>

        {open.length > 0 && (
          <ul className="mt-4 space-y-3">
            {open.map((session) => (
              <li key={session.id} className="panel flex flex-wrap items-center justify-between gap-3 p-4 text-sm" data-class={classKey(session.character.class)}>
                <span>
                  <span className="badge mr-2" data-tone="warn">
                    en cours
                  </span>
                  <span className="font-semibold">{session.label ?? "Sans libellé"}</span> ·{" "}
                  <Link href={`/characters/${session.character.id}`} prefetch={false} className="class-text hover:underline">
                    {session.character.name}
                  </Link>{" "}
                  <span className="text-muted">· départ sur le relevé des sacs du {formatDateTime(session.startSourceAt)}</span>
                </span>
                <FarmSessionControls action={farmSessionAction} sessionId={session.id} />
              </li>
            ))}
          </ul>
        )}

        {done.length > 0 && (
          <div className="panel mt-4 overflow-x-auto">
            <table className="data-table min-w-[980px]">
              <thead>
                <tr>
                  <th scope="col">Session</th>
                  <th scope="col" className="num">
                    Durée en jeu
                  </th>
                  <th scope="col" className="num">
                    Argent
                  </th>
                  <th scope="col" className="num">
                    Objets
                  </th>
                  <th scope="col" className="num">
                    Total
                  </th>
                  <th scope="col" className="num">
                    Par heure
                  </th>
                </tr>
              </thead>
              <tbody>
                {done.map((session) => {
                  const valuation = session.valuation!;
                  return (
                    <tr key={session.id}>
                      <td data-class={classKey(session.character.class)}>
                        <span className="font-semibold">{session.label ?? "Sans libellé"}</span> ·{" "}
                        <span className="class-text">{session.character.name}</span>
                        <div className="text-xs text-muted">
                          du {formatDateTime(session.startSourceAt)} au {formatDateTime(session.endSourceAt)}
                        </div>
                        <details className="mt-1 text-xs text-muted">
                          <summary className="cursor-pointer">
                            {valuation.items.length} objet{valuation.items.length > 1 ? "s" : ""} gagné{valuation.items.length > 1 ? "s" : ""} ou perdu
                            {valuation.items.length > 1 ? "s" : ""}
                            {valuation.unvaluedItems > 0 && `, ${valuation.unvaluedItems} sans prix`}
                          </summary>
                          <ul className="mt-1 space-y-0.5">
                            {valuation.items.map((item) => (
                              <li key={item.itemKey}>
                                {item.delta > 0 ? "+" : ""}
                                {formatInteger(item.delta)} × <ItemName itemKey={item.itemKey} names={names} query={itemQuery} />{" "}
                                {item.value === null ? "(sans prix)" : <Money copper={item.value} />}
                              </li>
                            ))}
                          </ul>
                        </details>
                      </td>
                      <td className="num">{formatDuration(valuation.durationSeconds)}</td>
                      <td className="num">
                        <Money copper={valuation.moneyDelta} />
                      </td>
                      <td className="num">
                        <Money copper={valuation.itemsValue} />
                      </td>
                      <td className="num font-semibold">
                        <Money copper={valuation.totalValue} />
                      </td>
                      <td className="num">
                        <Money copper={valuation.perHour} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-faint">
          Sacs et banque comptés ensemble : un objet déposé à la banque n&apos;est ni gagné ni perdu. Objets valorisés à la valeur de marché
          actuelle, commission déduite ; un objet sans prix est listé, jamais valorisé. Durée : écart entre les deux relevés des sacs, temps de
          trajet et pauses compris.
        </p>
      </section>

      {done.length > 0 && (
        <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Comparison title="Par libellé" rows={byLabel} />
          <Comparison title="Par personnage" rows={byCharacter} />
        </div>
      )}
    </>
  );
}

function Comparison({ title, rows }: { title: string; rows: FarmComparison[] }) {
  return (
    <section aria-label={title}>
      <SectionTitle>{title}</SectionTitle>
      <div className="panel overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">{title === "Par libellé" ? "Libellé" : "Personnage"}</th>
              <th scope="col" className="num">
                Sessions
              </th>
              <th scope="col" className="num">
                Durée
              </th>
              <th scope="col" className="num">
                Par heure
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="font-semibold">{row.label}</td>
                <td className="num">{row.sessions}</td>
                <td className="num">{formatDuration(row.seconds)}</td>
                <td className="num">
                  <Money copper={row.perHour} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
