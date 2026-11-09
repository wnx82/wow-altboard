import type { Metadata } from "next";
import Link from "next/link";
import { CharacterBrowser } from "@/components/character-browser";
import { Confidence, ItemName } from "@/components/economy";
import { ServerStatusTiles } from "@/components/server-status";
import { TrendChart, type TrendPoint } from "@/components/trend-chart";
import { Money, StatTile } from "@/components/ui";
import { WatchListPanel, type WatchAlert } from "@/components/watch-list";
import { getDatabase } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { buildGoldHistory, GOLD_HISTORY_DAYS } from "@/lib/dashboard/gold-history";
import { getOverview, listCharacters, listMoneySnapshots } from "@/lib/dashboard/queries";
import { buildWatchList, loadWatchFacts, loadWatchMachines } from "@/lib/dashboard/watch";
import { listAlerts } from "@/lib/economy/alerts";
import { loadItemNames } from "@/lib/economy/item-names";
import { itemLabel, itemQuality } from "@/lib/economy/load";
import { KIND_LABELS } from "@/lib/economy/opportunities";
import { latestOpportunities } from "@/lib/economy/runs";
import { formatCopperShort, formatDay, itemHref } from "@/lib/economy/view";
import { isConfigured } from "@/lib/status/config";
import { syncStatusRuntime } from "@/lib/status/runtime";
import { getServiceSummaries } from "@/lib/status/view";
import { formatDateTime, formatMoney, formatRelative } from "@/lib/wow/format";

export const metadata: Metadata = { title: "Mes personnages" };

const shortDate = new Intl.DateTimeFormat("fr-BE", { day: "numeric", month: "short", timeZone: "Europe/Brussels" });

export default async function CharactersPage() {
  await requireSession();
  const db = getDatabase();
  const now = new Date();
  const { config } = await syncStatusRuntime();
  const goldSince = new Date(now.getTime() - GOLD_HISTORY_DAYS * 24 * 3600 * 1000);
  const [characters, overview, servers, opportunities, moneySnapshots, machines, alerts] = await Promise.all([
    listCharacters(db),
    getOverview(db),
    // Sans serveur surveillé, ni requête ni miniature : il n'y aurait que de l'« Inconnu » à montrer.
    isConfigured(config) ? getServiceSummaries(db, config, now) : null,
    latestOpportunities(db),
    listMoneySnapshots(db, goldSince),
    loadWatchMachines(db),
    listAlerts(db),
  ]);
  const triggered = alerts.filter((alert) => alert.triggered);
  const [watchFacts, alertNames] = await Promise.all([
    loadWatchFacts(
      db,
      characters.map((character) => character.id),
    ),
    loadItemNames(
      db,
      triggered.map((alert) => alert.itemKey),
    ),
  ]);
  const watch = buildWatchList(characters, watchFacts, machines, now);
  const watchAlerts: WatchAlert[] = triggered.map((alert) => ({
    id: alert.id,
    label: itemLabel(alertNames, alert.itemKey),
    quality: itemQuality(alertNames, alert.itemKey),
    detail: `${formatCopperShort(alert.latest!.minCopper)} ${alert.direction === "below" ? "≤" : "≥"} ${formatCopperShort(alert.thresholdCopper)}`,
    href: itemHref(alert.itemKey, `?market=${alert.marketId}`),
  }));
  const goldPoints: TrendPoint[] = buildGoldHistory(moneySnapshots, goldSince, now).map((day) => ({
    at: `${day.day}T12:00:00Z`,
    value: day.copper / 10_000,
    label: `${formatMoney(day.copper)} (${day.characters} personnage${day.characters > 1 ? "s" : ""})`,
    dateLabel: shortDate.format(new Date(`${day.day}T12:00:00Z`)),
  }));

  const levels = characters.map((character) => character.level).filter((level): level is number => level !== null);
  const averageLevel = levels.length > 0 ? levels.reduce((total, level) => total + level, 0) / levels.length : null;
  const totalCopper = characters.reduce((total, character) => total + (character.moneyCopper ?? 0), 0);
  const professions = characters.reduce((total, character) => total + character.professions.length, 0);
  const distinctProfessions = new Set(characters.flatMap((character) => character.professions.map((profession) => profession.name))).size;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow text-gold">World of Warcraft</p>
          <h1 className="display mt-1 text-3xl font-bold sm:text-4xl">Mes personnages</h1>
        </div>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
          {characters.length > 0 && (
            // Lien de téléchargement : la route d'API n'est pas une page, d'où l'ancre simple.
            <a className="button" href={`${process.env.WOW_BASE_PATH ?? ""}/api/export/xlsx`} download>
              Exporter en Excel
            </a>
          )}
          {overview.lastSync ? (
            <>
              Dernière synchronisation{" "}
              <time dateTime={overview.lastSync.at} title={formatDateTime(overview.lastSync.at)} className="text-text">
                {formatRelative(overview.lastSync.at, now)}
              </time>{" "}
              depuis <span className="text-text">{overview.lastSync.machine}</span>
            </>
          ) : (
            "Aucune synchronisation reçue"
          )}
        </p>
      </div>

      {servers && (
        <section className="mb-6" aria-labelledby="servers-title">
          <p id="servers-title" className="eyebrow mb-2">
            Serveurs WoW Forever {config.label}
          </p>
          <ServerStatusTiles services={servers.filter((service) => service.targets > 0)} now={now} />
        </section>
      )}

      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Personnages" value={characters.length} />
        <StatTile label="Comptes" value={overview.accounts} />
        <StatTile label="PC" value={overview.machines} />
        <StatTile
          label="Niveau moyen"
          value={averageLevel === null ? "—" : new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(averageLevel)}
        />
        <StatTile label="Or cumulé" value={<Money copper={characters.length > 0 ? totalCopper : null} />} />
        <StatTile
          label="Métiers"
          value={professions}
          hint={professions > 0 ? `${distinctProfessions} différent${distinctProfessions > 1 ? "s" : ""}` : undefined}
        />
      </div>

      <WatchListPanel list={watch} alerts={watchAlerts} />

      {goldPoints.length > 1 && (
        <section className="mb-8" aria-label="Or cumulé">
          <TrendChart title={`Or cumulé de tous les personnages, ${GOLD_HISTORY_DAYS} derniers jours`} series="gold" points={goldPoints} />
        </section>
      )}

      {opportunities && opportunities.top.length > 0 && (
        <section className="mb-8" aria-labelledby="opportunities-title">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <p id="opportunities-title" className="eyebrow">
              Meilleures opportunités
            </p>
            <Link href="/opportunities" prefetch={false} className="text-xs text-gold hover:underline">
              Calcul du {formatDateTime(opportunities.run.computedAt)}, données au {formatDay(opportunities.run.dataThrough)} · tout voir
            </Link>
          </div>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {opportunities.top.map((opportunity, index) => (
              <li key={index} className="panel flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="min-w-0">
                  <span className="badge mr-2">{KIND_LABELS[opportunity.kind]}</span>
                  {opportunity.itemKey && <ItemName itemKey={opportunity.itemKey} names={opportunities.names} />}
                </span>
                <span className="flex flex-none items-center gap-2">
                  <Money copper={opportunity.valueCopper} />
                  <Confidence value={opportunity.confidence} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <CharacterBrowser characters={characters} now={now.toISOString()} />
    </>
  );
}
