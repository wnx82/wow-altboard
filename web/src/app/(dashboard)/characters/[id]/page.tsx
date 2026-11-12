import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { CharacterGoals } from "@/components/character-goals";
import { InventoryList } from "@/components/inventory-list";
import { LevelTimeChart, SessionXpChart } from "@/components/ledger-charts";
import { SectionNav, type SectionLink } from "@/components/section-nav";
import { TrendChart, type TrendPoint } from "@/components/trend-chart";
import { ClassAvatar, FactionBadge, GameIcon, Meter, Money, ProfessionIcon, SectionTitle, StatTile } from "@/components/ui";
import { getDatabase } from "@/db/client";
import { classIconUrl } from "@/lib/wow/icons";
import { requireSession } from "@/lib/auth/session";
import { buildHistory } from "@/lib/dashboard/history";
import { holdingNote } from "@/lib/dashboard/inventory-view";
import { buildLevelTimes, cumulativePlayedSeconds, fillLevelTimes, formatDuration, formatDurationToMinute } from "@/lib/dashboard/level-times";
import { buildSessions, sessionTagLabel, summarizeSessions } from "@/lib/dashboard/sessions";
import { getCharacterDetail, SESSIONS_SHOWN, type CharacterDetail } from "@/lib/dashboard/queries";
import { listCharacterGoals, listTemplates } from "@/lib/goals/store";
import {
  classKey,
  classLabel,
  formatDateTime,
  formatInteger,
  formatItemLevel,
  formatMoney,
  formatRelative,
  fractionalLevel,
  progressPercent,
  QUALITY_LABELS,
  REACTION_LABELS,
  SLOT_LABELS,
} from "@/lib/wow/format";

// L'identifiant vient de l'URL : seul un entier positif est accepté. Mis en cache le temps de la
// requête : les métadonnées et la page partagent une seule lecture.
const loadCharacter = cache(
  async (id: string): Promise<CharacterDetail | null> => (/^[1-9]\d{0,14}$/.test(id) ? getCharacterDetail(getDatabase(), Number(id)) : null),
);

async function load(params: Promise<{ id: string }>): Promise<CharacterDetail | null> {
  return loadCharacter((await params).id);
}

export async function generateMetadata({ params }: PageProps<"/characters/[id]">): Promise<Metadata> {
  // Le titre porte le nom du personnage : même contrôle que la page.
  await requireSession();
  const character = await load(params);
  return { title: character?.name ?? "Personnage introuvable" };
}

// Sommaire de la fiche : les identifiants sont ceux des titres de section, plus bas.
const SECTIONS: SectionLink[] = [
  { id: "goals", label: "Objectifs" },
  { id: "professions", label: "Métiers" },
  { id: "equipment", label: "Équipement" },
  { id: "stats", label: "Statistiques" },
  { id: "reputations", label: "Réputations" },
  { id: "inventory", label: "Inventaire" },
  { id: "level-times", label: "Temps par niveau" },
  { id: "sessions", label: "Sessions" },
  { id: "history", label: "Progression" },
];

const percentFormat = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percent = (value: number | null) => (value === null ? null : `${percentFormat.format(value)} %`);
const shortDate = new Intl.DateTimeFormat("fr-BE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" });
const levelFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });

export default async function CharacterPage({ params }: PageProps<"/characters/[id]">) {
  await requireSession();
  const character = await load(params);
  if (!character) notFound();
  const db = getDatabase();
  const [goals, templates] = await Promise.all([listCharacterGoals(db, character.id), listTemplates(db)]);

  const now = new Date();
  const stats = character.stats;
  const history = buildHistory(character.snapshots);
  const levelTimes = buildLevelTimes(character.levelTimes, character.playtime, character.level);
  // Le graphique ne trace que les niveaux relevés ; le tableau les liste tous.
  const allLevelTimes = fillLevelTimes(levelTimes, character.level);
  const totalPlayed = character.playtime?.totalSeconds ?? null;
  const cumulativePlayed = cumulativePlayedSeconds(allLevelTimes, totalPlayed);
  const sessions = buildSessions(character.sessions);
  const sessionTotals = summarizeSessions(sessions);
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
  const reputationGroups = Map.groupBy(character.reputations, (reputation) => reputation.groupName ?? "Autres");

  const statRows: [string, string | null][] = stats
    ? [
        ["Force", stats.strength?.toString() ?? null],
        ["Agilité", stats.agility?.toString() ?? null],
        ["Endurance", stats.stamina?.toString() ?? null],
        ["Intelligence", stats.intellect?.toString() ?? null],
        ["Esprit", stats.spirit?.toString() ?? null],
        ["Armure", formatNullable(stats.armor)],
        ["Points de vie", formatNullable(stats.health)],
        [stats.powerType ? `Ressource (${stats.powerType})` : "Ressource", formatNullable(stats.power)],
        ["Puissance d'attaque", formatNullable(stats.attackPower)],
        ["Puissance d'attaque à distance", formatNullable(stats.rangedAttackPower)],
        ["Critique", percent(stats.crit)],
        ["Critique à distance", percent(stats.rangedCrit)],
        ["Toucher", percent(stats.hit)],
        ["Esquive", percent(stats.dodge)],
        ["Parade", percent(stats.parry)],
        ["Blocage", percent(stats.block)],
        ["Défense", formatNullable(stats.defense)],
        ["Puissance des sorts", formatNullable(stats.spellPower)],
        ["Critique des sorts", percent(stats.spellCrit)],
        ["Soins", formatNullable(stats.healing)],
        ["Toucher des sorts", percent(stats.spellHit)],
        ["Résistance au feu", formatNullable(stats.resFire)],
        ["Résistance à la nature", formatNullable(stats.resNature)],
        ["Résistance au givre", formatNullable(stats.resFrost)],
        ["Résistance à l'ombre", formatNullable(stats.resShadow)],
        ["Résistance aux arcanes", formatNullable(stats.resArcane)],
      ]
    : [];

  const classIcon = classIconUrl(character.class);

  return (
    <div data-class={classKey(character.class)}>
      <Link href="/" className="page-eyebrow hover:underline">
        Tous les personnages
      </Link>

      <header className="panel character-card character-hero isolate mt-4 flex flex-wrap items-center gap-5 p-6 sm:p-7" data-class={classKey(character.class)}>
        {/* Grande icône de la classe, floue, en fond : la même signature que le podium de l'accueil. */}
        {classIcon && <GameIcon src={classIcon} size={56} className="champion-backdrop" />}
        <ClassAvatar name={character.name} classToken={character.class} size="lg" level={character.level} />
        <div className="min-w-0 flex-1">
          <h1 className="display break-words text-3xl font-bold leading-tight class-text sm:text-[2.6rem]">{character.name}</h1>
          <p className="mt-1 text-lg">
            {classLabel(character.class)}
            {character.level !== null && <span className="text-muted"> — Niveau {character.level}</span>}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            {[character.race, character.realm].filter(Boolean).join(" • ")}
            <FactionBadge faction={character.faction} />
            {character.guild && <span className="badge">&lt;{character.guild}&gt;</span>}
            {character.hidden && <span className="badge">Masqué dans l&apos;addon</span>}
          </p>
        </div>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_auto]">
          <dt className="text-muted">Dernière donnée AltBoard connue</dt>
          <dd title={formatDateTime(character.sourceLastSeenAt)}>{formatRelative(character.sourceLastSeenAt, now)}</dd>
          <dt className="text-muted">Dernière synchronisation</dt>
          <dd title={formatDateTime(character.lastSyncAt)}>
            {formatRelative(character.lastSyncAt, now)}
            {character.lastMachine && <span className="text-muted"> · {character.lastMachine}</span>}
          </dd>
          <dt className="text-muted">Compte</dt>
          <dd>{character.account.label}</dd>
          {character.zone && (
            <>
              <dt className="text-muted">Zone</dt>
              <dd>{character.zone}</dd>
            </>
          )}
        </dl>
      </header>

      <section
        aria-label="Vue générale"
        className={`mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 ${totalPlayed === null ? "xl:grid-cols-6" : "xl:grid-cols-7"}`}
      >
        <StatTile
          label="Niveau"
          value={character.level ?? "—"}
          hint={
            character.xp !== null && character.xpMax !== null ? (
              <>
                <Meter value={character.xp} max={character.xpMax} label="Progression du niveau" />
                <span className="mt-1 block">
                  {formatInteger(character.xp)} / {formatInteger(character.xpMax)} XP ({progressPercent(character.xp, character.xpMax)} %)
                </span>
              </>
            ) : undefined
          }
        />
        <StatTile label="Niveau d'objet" value={formatItemLevel(character.itemLevel)} />
        <StatTile label="Or" value={<Money copper={character.moneyCopper} />} />
        <StatTile label="XP reposée" value={formatInteger(character.restedXp)} />
        {totalPlayed !== null && (
          <StatTile
            label="Temps de jeu"
            value={formatDuration(totalPlayed)}
            hint={character.playtime?.measuredAt ? `Relevé ${formatRelative(character.playtime.measuredAt, now)}` : undefined}
          />
        )}
        <StatTile
          label="Sacs"
          value={character.bagSlotsUsed === null ? "—" : `${character.bagSlotsUsed} / ${character.bagSlotsTotal ?? "—"}`}
          hint={character.bagsAt ? `Relevés ${formatRelative(character.bagsAt, now)}` : "Jamais relevés"}
        />
        <StatTile
          label="Banque"
          value={character.bankSlotsUsed === null ? "—" : `${character.bankSlotsUsed} / ${character.bankSlotsTotal ?? "—"}`}
          hint={character.bankAt ? `Relevée ${formatRelative(character.bankAt, now)}` : "Jamais relevée"}
        />
      </section>

      <SectionNav label="Sections de la fiche" items={SECTIONS} />

      <CharacterGoals
        characterId={character.id}
        goals={goals}
        templates={templates}
        suggestions={{
          professions: character.professions.map((profession) => profession.name),
          factions: character.reputations.map((reputation) => reputation.name),
          currencies: character.currencies.map((currency) => currency.name),
        }}
      />

      <div className="mt-8 grid grid-cols-1 gap-8 xl:grid-cols-2">
        <section aria-labelledby="professions">
          <SectionTitle>
            <span id="professions">Métiers</span>
          </SectionTitle>
          <div className="panel p-5">
            {character.professions.length === 0 ? (
              <p className="text-sm text-muted">Aucun métier appris.</p>
            ) : (
              <ul className="space-y-4">
                {character.professions.map((profession) => (
                  <li key={profession.skillLine}>
                    <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                      <span className="font-medium">
                        <ProfessionIcon skillLine={profession.skillLine} size={22} /> {profession.name}
                        {profession.isPrimary && <span className="badge ml-2">Principal</span>}
                      </span>
                      <span className="tabular-nums text-muted">
                        {profession.rank ?? "—"} / {profession.maxRank ?? "—"}
                        {progressPercent(profession.rank, profession.maxRank) !== null && (
                          <span className="ml-2 text-text">{progressPercent(profession.rank, profession.maxRank)} %</span>
                        )}
                      </span>
                    </div>
                    <Meter value={profession.rank} max={profession.maxRank} label={profession.name} tone="gold" />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section aria-labelledby="currencies">
          <SectionTitle>
            <span id="currencies">Monnaies</span>
          </SectionTitle>
          <div className="panel p-5">
            {character.currencies.length === 0 ? (
              <p className="text-sm text-muted">Aucune monnaie détenue.</p>
            ) : (
              <ul className="divide-y divide-white/5 text-sm">
                {character.currencies.map((currency) => (
                  <li key={currency.name} className="flex items-baseline justify-between gap-3 py-2">
                    <span>{currency.name}</span>
                    <span className="tabular-nums">
                      {formatInteger(currency.quantity)}
                      {currency.maxQuantity !== null && currency.maxQuantity > 0 && (
                        <span className="text-muted"> / {formatInteger(currency.maxQuantity)}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section aria-labelledby="equipment">
          <SectionTitle aside={`${character.equipment.length} emplacement${character.equipment.length > 1 ? "s" : ""} équipé${character.equipment.length > 1 ? "s" : ""}`}>
            <span id="equipment">Équipement</span>
          </SectionTitle>
          <div className="panel overflow-x-auto">
            {character.equipment.length === 0 ? (
              <p className="p-5 text-sm text-muted">Aucun objet équipé relevé.</p>
            ) : (
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
                  {character.equipment.map((item) => (
                    <tr key={item.slot} data-quality={item.quality ?? undefined}>
                      <td className="whitespace-nowrap text-muted">{SLOT_LABELS[item.slot] ?? `Emplacement ${item.slot}`}</td>
                      <td>
                        <span className="quality-text font-medium" title={item.quality === null ? undefined : QUALITY_LABELS[item.quality]}>
                          {item.name ?? (item.itemId === null ? "Objet inconnu" : `Objet n° ${item.itemId}`)}
                        </span>
                        {item.enchantId !== null && <span className="block text-xs text-ok">Enchantement n° {item.enchantId}</span>}
                      </td>
                      <td className="num">{item.itemLevel ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section aria-labelledby="stats">
          <SectionTitle aside={character.statsAt ? `Relevées ${formatRelative(character.statsAt, now)}, améliorations actives incluses` : undefined}>
            <span id="stats">Statistiques</span>
          </SectionTitle>
          <div className="panel p-5">
            {statRows.every(([, value]) => value === null) ? (
              <p className="text-sm text-muted">Aucune statistique relevée.</p>
            ) : (
              <dl className="grid grid-cols-1 gap-x-8 text-sm sm:grid-cols-2">
                {statRows
                  .filter(([, value]) => value !== null)
                  .map(([label, value]) => (
                    <div key={label} className="flex items-baseline justify-between gap-3 border-b border-white/5 py-1.5">
                      <dt className="text-muted">{label}</dt>
                      <dd className="font-medium tabular-nums">{value}</dd>
                    </div>
                  ))}
              </dl>
            )}
          </div>
        </section>
      </div>

      <section aria-labelledby="reputations" className="mt-8">
        <SectionTitle aside={`${character.reputations.length} faction${character.reputations.length > 1 ? "s" : ""}`}>
          <span id="reputations">Réputations</span>
        </SectionTitle>
        {character.reputations.length === 0 ? (
          <div className="panel p-5 text-sm text-muted">Aucune réputation relevée.</div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[...reputationGroups.entries()].map(([group, reputations]) => (
              <div key={group} className="panel p-5">
                <h3 className="eyebrow mb-3">{group}</h3>
                <ul className="space-y-3">
                  {reputations.map((reputation) => {
                    const span = reputation.minValue !== null && reputation.maxValue !== null ? reputation.maxValue - reputation.minValue : null;
                    const progress = reputation.currentValue !== null && reputation.minValue !== null ? reputation.currentValue - reputation.minValue : null;
                    return (
                      <li key={reputation.factionId}>
                        <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                          <span className="min-w-0 truncate">{reputation.name}</span>
                          <span className="whitespace-nowrap text-xs text-muted">
                            {reputation.reaction === null ? "—" : (REACTION_LABELS[reputation.reaction] ?? `Palier ${reputation.reaction}`)}
                            {progress !== null && span !== null && span > 0 && (
                              <span className="ml-2 tabular-nums text-text">
                                {formatInteger(progress)} / {formatInteger(span)}
                              </span>
                            )}
                          </span>
                        </div>
                        <Meter value={progress} max={span} label={reputation.name} />
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="inventory" className="mt-8">
        <SectionTitle>
          <span id="inventory">Inventaire</span>
        </SectionTitle>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="panel p-5">
            <h3 className="eyebrow mb-3">Sacs</h3>
            {character.bagsAt ? (
              <InventoryList items={character.bags} label="les sacs" />
            ) : (
              <p className="text-sm text-muted">Sacs jamais relevés par l&apos;addon.</p>
            )}
          </div>
          <div className="panel p-5">
            <h3 className="eyebrow mb-3">Banque</h3>
            {character.bankAt ? (
              <InventoryList items={character.bank} label="la banque" />
            ) : (
              <p className="text-sm text-muted">
                Banque jamais relevée : l&apos;addon ne la lit que lorsqu&apos;elle est ouverte en jeu avec ce personnage.
              </p>
            )}
          </div>
          {/* Relevés par Baganator : absents tant que l'agent 0.8.0 n'a rien envoyé pour ce personnage. */}
          {character.holdingsAt && (
            <>
              <div className="panel p-5">
                <h3 className="eyebrow mb-3">Courrier</h3>
                <InventoryList items={character.mail.map((item) => ({ ...item, note: holdingNote(item.expiresAt, now) }))} label="le courrier" />
              </div>
              <div className="panel p-5">
                <h3 className="eyebrow mb-3">Enchères en cours</h3>
                <InventoryList items={character.auctions.map((item) => ({ ...item, note: holdingNote(item.expiresAt, now) }))} label="les enchères" />
              </div>
            </>
          )}
        </div>
        {character.holdingsAt && (
          <p className="mt-3 text-xs text-faint">
            Courrier et enchères relevés par Baganator ({formatRelative(character.holdingsAt, now)}) : le courrier à la dernière ouverture
            de la boîte aux lettres, les enchères à leur mise en vente.
          </p>
        )}
      </section>

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
              <div className="overflow-x-auto">
                <table className="data-table">
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
                        <td className="whitespace-nowrap">
                          {entry.current ? `${entry.level} (en cours)` : `${entry.level} → ${entry.level + 1}`}
                        </td>
                        <td className="num">{entry.playedSeconds === null ? "non mesuré" : formatDuration(entry.playedSeconds)}</td>
                        <td className="num">{formatDurationToMinute(cumulativePlayed.get(entry.level) ?? null)}</td>
                        <td className="num">{formatDuration(entry.wallSeconds)}</td>
                        <td className="whitespace-nowrap">{formatDateTime(entry.reachedAt)}</td>
                        <td>{entry.zone ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </section>

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
              <div className="overflow-x-auto">
                <table className="data-table">
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
                        <td className="whitespace-nowrap">
                          {formatDateTime(session.startedAt)}
                          {session.current && " (en cours)"}
                        </td>
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
              </div>
            </details>
          </>
        )}
      </section>

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
            <div className="overflow-x-auto">
              <table className="data-table">
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
                      <td className="whitespace-nowrap">{formatDateTime(snapshot.capturedAt)}</td>
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
            </div>
          </details>
        )}
      </section>
    </div>
  );
}

function formatNullable(value: number | null | undefined): string | null {
  return value === null || value === undefined ? null : formatInteger(value);
}
