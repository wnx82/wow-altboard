import type { Metadata } from "next";
import Link from "next/link";
import { ScrollRegion } from "@/components/scroll-region";
import { EmptyState, PageHeader, SectionTitle, StatTile } from "@/components/ui";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { hourlyHeatmap, PLAYTIME_WEEKS, playtimeByAccount, playtimeByCharacter, weeklySummary } from "@/lib/dashboard/playtime";
import { listPlaytimeRows, listSessionFacts } from "@/lib/dashboard/queries";
import { sessionTagLabel } from "@/lib/dashboard/sessions";
import { classKey, formatDateTime, formatDuration, formatInteger } from "@/lib/wow/format";

export const metadata: Metadata = { title: "Temps de jeu" };

const weekLabel = new Intl.DateTimeFormat("fr-BE", { day: "numeric", month: "short", timeZone: "UTC" });
const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

export default async function PlaytimePage() {
  await requireSession();
  const db = getDatabase();
  const now = new Date();
  // Début de la plus ancienne semaine résumée : la carte couvre exactement les mêmes semaines.
  const weeksAgo = new Date(now.getTime() - PLAYTIME_WEEKS * 7 * 24 * 3600 * 1000);
  const [playtime, sessions] = await Promise.all([listPlaytimeRows(db), listSessionFacts(db, weeksAgo)]);
  const accounts = playtimeByAccount(playtime);
  const perCharacter = playtimeByCharacter(playtime, sessions);
  const weeks = weeklySummary(sessions, now);
  // La carte couvre les mêmes semaines que le tableau.
  const since = new Date(`${weeks.at(-1)!.week}T00:00:00Z`);
  const heatmap = hourlyHeatmap(sessions, since);
  const peak = Math.max(...heatmap.flat());

  const total = accounts.reduce((sum, account) => sum + account.seconds, 0);
  const measured = playtime.filter((row) => row.totalSeconds !== null).length;
  const recent = weeks.reduce((sum, week) => sum + week.seconds, 0);

  return (
    <>
      <PageHeader art="glade" section="characters" title="Temps de jeu">
        D&apos;après l&apos;addon Allemano Ledger : le dernier <code className="text-text">/played</code> connu de chaque personnage, et les
        sessions de jeu des {PLAYTIME_WEEKS} dernières semaines. Chaque PC ne connaît que les sessions jouées chez lui.
      </PageHeader>

      {measured === 0 && sessions.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="Aucun temps de jeu connu">
            Installez l&apos;addon Allemano Ledger en jeu : le temps de jeu apparaît après la synchronisation suivante.
          </EmptyState>
        </div>
      ) : (
        <div className="mt-6 space-y-10">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="Temps total" value={formatDuration(total)} hint={`${measured} personnage${measured > 1 ? "s" : ""} mesuré${measured > 1 ? "s" : ""}`} />
            <StatTile
              label="Cette semaine"
              value={weeks[0].seconds > 0 ? formatDuration(weeks[0].seconds) : "—"}
              hint={weeks[0].sessions === 0 ? "aucune session" : `${weeks[0].sessions} session${weeks[0].sessions > 1 ? "s" : ""}`}
            />
            <StatTile label={`${PLAYTIME_WEEKS} dernières semaines`} value={recent > 0 ? formatDuration(recent) : "—"} />
            <StatTile label="XP sur la période" value={formatInteger(weeks.reduce((sum, week) => sum + week.xp, 0))} />
          </div>

          <section aria-label="Par compte">
            <SectionTitle>Par compte</SectionTitle>
            <ScrollRegion className="panel overflow-x-auto" label="Temps de jeu par compte">
              <table className="data-table">
                <caption className="sr-only">Temps de jeu par compte</caption>
                <thead>
                  <tr>
                    <th scope="col">Compte</th>
                    <th scope="col" className="num">
                      Personnages
                    </th>
                    <th scope="col" className="num">
                      Temps de jeu
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((account) => (
                    <tr key={account.accountId}>
                      <th scope="row" className="text-left font-semibold">
                        {account.label}
                      </th>
                      <td className="num">
                        {account.characters}
                        {account.unmeasured > 0 && <span className="block text-xs text-muted">dont {account.unmeasured} sans mesure</span>}
                      </td>
                      <td className="num tabular-nums">{account.seconds > 0 ? formatDuration(account.seconds) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          </section>

          <section aria-label="Par personnage">
            <SectionTitle aside={`/played et sessions des ${PLAYTIME_WEEKS} dernières semaines`}>Par personnage</SectionTitle>
            <ScrollRegion className="panel overflow-x-auto" label="Temps de jeu par personnage">
              <table className="data-table min-w-[720px]">
                <caption className="sr-only">Temps de jeu par personnage</caption>
                <thead>
                  <tr>
                    <th scope="col">Personnage</th>
                    <th scope="col" className="num">
                      Niveau
                    </th>
                    <th scope="col" className="num">
                      Temps de jeu
                    </th>
                    <th scope="col" className="num">
                      {PLAYTIME_WEEKS} semaines
                    </th>
                    <th scope="col" className="num">
                      Sessions
                    </th>
                    <th scope="col">Dernière session</th>
                  </tr>
                </thead>
                <tbody>
                  {perCharacter.map((character) => (
                    <tr key={character.characterId} data-class={classKey(character.class)}>
                      <th scope="row" className="text-left">
                        <Link href={`/characters/${character.characterId}`} prefetch={false} className="font-semibold class-text hover:underline">
                          {character.name}
                        </Link>
                        <span className="block text-xs font-normal text-muted">{character.accountLabel}</span>
                      </th>
                      <td className="num tabular-nums">{character.level ?? "—"}</td>
                      <td className="num tabular-nums">{character.totalSeconds === null ? "—" : formatDuration(character.totalSeconds)}</td>
                      <td className="num tabular-nums">{character.recentSeconds > 0 ? formatDuration(character.recentSeconds) : "—"}</td>
                      <td className="num tabular-nums">{character.sessions || "—"}</td>
                      <td className="whitespace-nowrap text-muted">{character.lastSessionAt ? formatDateTime(character.lastSessionAt) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          </section>

          <section aria-label="Par semaine">
            <SectionTitle aside="Durée connectée, pauses exclues">Par semaine</SectionTitle>
            <ScrollRegion className="panel overflow-x-auto" label="Temps de jeu par semaine">
              <table className="data-table min-w-[720px]">
                <caption className="sr-only">Temps de jeu par semaine</caption>
                <thead>
                  <tr>
                    <th scope="col">Semaine du</th>
                    <th scope="col" className="num">
                      Temps
                    </th>
                    <th scope="col" className="num">
                      Sessions
                    </th>
                    <th scope="col" className="num">
                      XP
                    </th>
                    <th scope="col" className="num">
                      Niveaux
                    </th>
                    <th scope="col">Répartition</th>
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((week) => (
                    <tr key={week.week}>
                      <th scope="row" className="whitespace-nowrap text-left font-normal">
                        {weekLabel.format(new Date(`${week.week}T00:00:00Z`))}
                      </th>
                      <td className="num tabular-nums">{week.seconds > 0 ? formatDuration(week.seconds) : "—"}</td>
                      <td className="num tabular-nums">{week.sessions || "—"}</td>
                      <td className="num tabular-nums">{week.xp > 0 ? formatInteger(week.xp) : "—"}</td>
                      <td className="num tabular-nums">{week.levels || "—"}</td>
                      <td className="text-xs text-muted">
                        {[...week.byTag.entries()]
                          .filter(([, seconds]) => seconds > 0)
                          .sort(([, a], [, b]) => b - a)
                          .map(([tag, seconds]) => (
                            <span key={tag ?? "none"} className="mr-3 inline-block whitespace-nowrap">
                              {sessionTagLabel(tag) ?? "Sans étiquette"} {formatDuration(seconds)}
                            </span>
                          ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          </section>

          <section aria-label="Jour et heure">
            <SectionTitle aside={`${PLAYTIME_WEEKS} dernières semaines, heure de Bruxelles`}>Quand je joue</SectionTitle>
            {peak === 0 ? (
              <p className="panel px-5 py-4 text-sm text-muted">Aucune session sur la période.</p>
            ) : (
              <ScrollRegion className="panel overflow-x-auto p-4" label="Quand je joue : temps de jeu par jour de la semaine et par heure">
                <table className="heatmap min-w-[640px]">
                  <caption className="sr-only">Temps de jeu par jour de la semaine et par heure</caption>
                  <thead>
                    <tr>
                      <td />
                      {Array.from({ length: 24 }, (_, hour) => (
                        <th key={hour} scope="col" className="text-[10px] font-normal text-muted">
                          {hour % 3 === 0 ? `${hour} h` : ""}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {heatmap.map((hours, day) => (
                      <tr key={day}>
                        <th scope="row" className="pr-2 text-left text-xs font-normal text-muted">
                          {DAYS[day].slice(0, 3)}
                        </th>
                        {hours.map((seconds, hour) => (
                          <td
                            key={hour}
                            className="heatmap-cell"
                            // Paliers fixes plutôt qu'un style en ligne, que la CSP refuse.
                            data-level={seconds === 0 ? 0 : Math.max(1, Math.ceil((seconds / peak) * 5))}
                            title={`${DAYS[day]}, ${hour} h : ${seconds > 0 ? formatDuration(seconds) : "rien"}`}
                          >
                            <span className="sr-only">{seconds > 0 ? formatDuration(seconds) : "rien"}</span>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-faint">
                  Le temps connecté de chaque session est compté d&apos;un seul tenant à partir de son début : l&apos;addon ne date pas les pauses.
                </p>
              </ScrollRegion>
            )}
          </section>
        </div>
      )}
    </>
  );
}
