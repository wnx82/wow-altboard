import { LevelTimeChart, SessionXpChart } from "@/components/ledger-charts";
import { ScrollRegion } from "@/components/scroll-region";
import { Money, SectionTitle } from "@/components/ui";
import { buildLevelTimes, cumulativePlayedSeconds, fillLevelTimes } from "@/lib/dashboard/level-times";
import { RUNS_SHOWN, SESSIONS_SHOWN, type CharacterDetail } from "@/lib/dashboard/queries";
import { buildSessions, sessionTagLabel, summarizeSessions } from "@/lib/dashboard/sessions";
import { formatDateTime, formatDuration, formatDurationToMinute, formatInteger, formatMoney } from "@/lib/wow/format";

// Sections relevées par l'addon Allemano Ledger : temps par niveau, sessions de jeu et donjons.

export function LevelTimesSection({ character }: { character: CharacterDetail }) {
  const levelTimes = buildLevelTimes(character.levelTimes, character.playtime, character.level);
  // Le graphique ne trace que les niveaux relevés ; le tableau les liste tous.
  const allLevelTimes = fillLevelTimes(levelTimes, character.level);
  const cumulativePlayed = cumulativePlayedSeconds(allLevelTimes, character.playtime?.totalSeconds ?? null);
  return (
    <section aria-labelledby="level-times" className="mt-8">
      <SectionTitle aside="Source : addon Allemano Ledger">
        <span id="level-times">Temps par niveau</span>
      </SectionTitle>
      {levelTimes.length === 0 ? (
        <div className="panel p-5 text-sm text-muted">
          Aucun temps relevé pour ce personnage. L&apos;addon Allemano Ledger mesure le temps de jeu de chaque niveau à partir de son
          installation : connectez ce personnage, faites <code className="text-text">/reload</code>, puis synchronisez. Les niveaux gagnés
          avant l&apos;installation ne peuvent pas être reconstitués : le jeu ne donne que le total et le niveau en cours.
        </div>
      ) : (
        <>
          <LevelTimeChart levels={levelTimes} />
          <details open className="panel mt-4 overflow-hidden">
            <summary className="cursor-pointer px-5 py-3 text-sm text-muted hover:text-text">Tableau des temps par niveau</summary>
            <ScrollRegion className="overflow-x-auto" label="Temps par niveau">
              <table className="data-table">
                <caption className="sr-only">Temps par niveau</caption>
                <thead>
                  <tr>
                    <th scope="col">Niveau</th>
                    <th scope="col" className="num">
                      Temps de jeu
                    </th>
                    <th scope="col" className="num" title="Temps de jeu total à la fin du niveau">
                      Temps cumulé
                    </th>
                    <th scope="col" className="num">
                      Temps réel
                    </th>
                    <th scope="col">Terminé le</th>
                    <th scope="col">Zone</th>
                  </tr>
                </thead>
                <tbody>
                  {[...allLevelTimes].reverse().map((entry) => (
                    <tr key={entry.level} className={entry.playedSeconds === null && entry.wallSeconds === null ? "text-muted" : undefined}>
                      <th scope="row" className="whitespace-nowrap">
                        {entry.current ? `${entry.level} (en cours)` : `${entry.level} → ${entry.level + 1}`}
                      </th>
                      <td className="num">{entry.playedSeconds === null ? "non mesuré" : formatDuration(entry.playedSeconds)}</td>
                      <td className="num">{formatDurationToMinute(cumulativePlayed.get(entry.level) ?? null)}</td>
                      <td className="num">{formatDuration(entry.wallSeconds)}</td>
                      <td className="whitespace-nowrap">{formatDateTime(entry.reachedAt)}</td>
                      <td>{entry.zone ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          </details>
        </>
      )}
    </section>
  );
}

export function SessionsSection({ character }: { character: CharacterDetail }) {
  const sessions = buildSessions(character.sessions);
  const sessionTotals = summarizeSessions(sessions);
  return (
    <section aria-labelledby="sessions" className="mt-8">
      <SectionTitle
        aside={
          sessions.length === 0
            ? "Source : addon Allemano Ledger"
            : `${sessions.length >= SESSIONS_SHOWN ? `${SESSIONS_SHOWN} dernières sessions` : `${sessions.length} session${sessions.length > 1 ? "s" : ""}`} · ${formatInteger(sessionTotals.xpGained)} XP en ${formatDuration(sessionTotals.durationSeconds)}${
                sessionTotals.xpPerHour === null ? "" : ` · ${formatInteger(sessionTotals.xpPerHour)} XP/h`
              }`
        }
      >
        <span id="sessions">Sessions de jeu</span>
      </SectionTitle>
      {sessions.length === 0 ? (
        <div className="panel p-5 text-sm text-muted">
          Aucune session relevée pour ce personnage. L&apos;addon Allemano Ledger enregistre chaque session de jeu (durée, expérience
          gagnée) à partir de son installation : connectez ce personnage, faites <code className="text-text">/reload</code>, puis
          synchronisez.
        </div>
      ) : (
        <>
          <SessionXpChart sessions={sessions} />
          <details className="panel mt-4 overflow-hidden">
            <summary className="cursor-pointer px-5 py-3 text-sm text-muted hover:text-text">Tableau des sessions</summary>
            <ScrollRegion className="overflow-x-auto" label="Sessions de jeu">
              <table className="data-table">
                <caption className="sr-only">Sessions de jeu</caption>
                <thead>
                  <tr>
                    <th scope="col">Début</th>
                    <th scope="col" className="num">
                      Durée
                    </th>
                    <th scope="col" className="num">
                      XP gagnée
                    </th>
                    <th scope="col" className="num">
                      XP par heure
                    </th>
                    <th scope="col" className="num">
                      Niveaux
                    </th>
                    <th scope="col">Zone</th>
                    <th scope="col">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {[...sessions].reverse().map((session) => (
                    <tr key={session.startedAt}>
                      <th scope="row" className="whitespace-nowrap">
                        {formatDateTime(session.startedAt)}
                        {session.current && " (en cours)"}
                      </th>
                      <td className="num">{formatDuration(session.durationSeconds)}</td>
                      <td className="num">{formatInteger(session.xpGained)}</td>
                      <td className="num">{formatInteger(session.xpPerHour)}</td>
                      <td className="num">{session.levels ? `+${session.levels}` : "—"}</td>
                      <td>{session.zone ?? "—"}</td>
                      <td>{sessionTagLabel(session.tag) ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          </details>
        </>
      )}
    </section>
  );
}

/** Montant signé en texte : « −3 pa 20 pc ». */
const signedMoney = (copper: number) => `${copper < 0 ? "−" : ""}${formatMoney(Math.abs(copper))}`;

/** Donjons et autres runs d'instance d'Allemano Ledger : durée, expérience, or et butin de chacun. */
export function RunsSection({ character }: { character: CharacterDetail }) {
  const runs = character.runs;
  const net = runs.reduce((total, run) => total + (run.netCopper ?? 0), 0);
  const loot = runs.reduce((total, run) => total + (run.lootValueCopper ?? 0), 0);
  return (
    <section aria-labelledby="runs" className="mt-8">
      <SectionTitle
        aside={
          runs.length === 0
            ? "Source : addon Allemano Ledger"
            : `${runs.length >= RUNS_SHOWN ? `${RUNS_SHOWN} derniers` : `${runs.length} run${runs.length > 1 ? "s" : ""}`} · or net ${signedMoney(net)} · butin ${signedMoney(loot)}`
        }
      >
        <span id="runs">Donjons</span>
      </SectionTitle>
      {runs.length === 0 ? (
        <div className="panel p-5 text-sm text-muted">
          Aucun donjon relevé pour ce personnage. Allemano Ledger enregistre chaque passage en instance (durée, expérience, or et butin) ;
          l&apos;agent 0.11.0 les envoie au site.
        </div>
      ) : (
        <ScrollRegion className="panel overflow-x-auto" label="Donjons">
          <table className="data-table min-w-[760px]">
            <caption className="sr-only">Donjons et autres runs</caption>
            <thead>
              <tr>
                <th scope="col">Début</th>
                <th scope="col">Instance</th>
                <th scope="col" className="num">
                  Durée
                </th>
                <th scope="col" className="num">
                  XP gagnée
                </th>
                <th scope="col" className="num">
                  Or net
                </th>
                <th scope="col" className="num">
                  Butin estimé
                </th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.startedAt.getTime()}>
                  <th scope="row" className="whitespace-nowrap">
                    {formatDateTime(run.startedAt)}
                  </th>
                  <td>
                    {run.zone ?? "—"}
                    {run.tag && <span className="ml-2 text-xs text-muted">{sessionTagLabel(run.tag)}</span>}
                  </td>
                  <td className="num">{formatDuration(run.durationSeconds)}</td>
                  <td className="num">
                    {formatInteger(run.xpGained)}
                    {run.levels ? <span className="ml-1 text-xs text-muted">(+{run.levels} niv.)</span> : null}
                  </td>
                  <td className="num">
                    <Money copper={run.netCopper} />
                  </td>
                  <td className="num">
                    <Money copper={run.lootValueCopper} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      )}
      {runs.length > 0 && (
        <p className="mt-3 text-xs text-faint">
          Or net : or gagné moins or dépensé pendant le run. Butin estimé : valeur des objets ramassés selon l&apos;addon. Un run recoupe la
          session de jeu qui le contient : il n&apos;est pas compté deux fois dans le temps de jeu.
        </p>
      )}
    </section>
  );
}
