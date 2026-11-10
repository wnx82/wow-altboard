import Link from "next/link";
import { formatCheckTime, formatLatency, STATUS_HELP, STATUS_LABELS, STATUS_TONES, type Status } from "@/lib/status/status";
import type { Availability, HourCell, ServiceHistory, ServiceSummary, ServiceView, TransitionView } from "@/lib/status/view";
import { formatRelative } from "@/lib/wow/format";

// État des serveurs de jeu : briques d'affichage sans état, rendues côté serveur. Le statut n'est
// jamais porté par la couleur seule : chaque badge l'écrit, chaque case de la frise le dit en
// infobulle et la frise entière a un résumé lisible par un lecteur d'écran.

const STATUSES: Status[] = ["up", "degraded", "down", "unknown"];

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className="badge" data-tone={STATUS_TONES[status]} data-status={status} title={STATUS_HELP[status]}>
      <span className="status-dot" aria-hidden="true" />
      {STATUS_LABELS[status]}
    </span>
  );
}

export function ServerStatusTable({ services }: { services: ServiceView[] }) {
  return (
    <div className="panel overflow-x-auto">
      <table className="data-table min-w-[720px]">
        <thead>
          <tr>
            <th scope="col">Service</th>
            <th scope="col">Statut</th>
            <th scope="col" className="num">
              Latence
            </th>
            <th scope="col">Dernier contrôle</th>
            <th scope="col">Constat</th>
          </tr>
        </thead>
        <tbody>
          {services.map((service) => (
            <tr key={service.service}>
              <td className="whitespace-nowrap font-medium">{service.label}</td>
              <td>
                <StatusBadge status={service.status} />
              </td>
              <td className="num whitespace-nowrap">{formatLatency(service.latencyMs)}</td>
              <td className="whitespace-nowrap">
                {service.checkedAt ? <time dateTime={service.checkedAt}>{formatCheckTime(service.checkedAt)}</time> : "—"}
              </td>
              <td className="text-muted">
                {service.detail}
                {service.lastAnswer && (
                  <span className="block text-xs text-faint">
                    Dernière réponse : <time dateTime={service.lastAnswer.at}>{formatCheckTime(service.lastAnswer.at)}</time>
                    {service.lastAnswer.latencyMs !== null && ` (${formatLatency(service.lastAnswer.latencyMs)})`}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Signification des statuts, pour qui n'a pas d'infobulle (écran tactile, lecteur d'écran). */
export function StatusLegend() {
  return (
    <details className="mt-2 text-xs text-muted">
      <summary className="cursor-pointer hover:text-text">Signification des statuts</summary>
      <dl className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {STATUSES.map((status) => (
          <div key={status} className="flex items-start gap-2">
            <dt className="flex-none">
              <StatusBadge status={status} />
            </dt>
            <dd>{STATUS_HELP[status]}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

const WINDOW_LABELS = { "24h": "24 heures", "7d": "7 jours" } as const;

const percent = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** « 3 h 20 min », « 45 min », « 2 j 4 h ». */
export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
  return hours % 24 === 0 ? `${Math.floor(hours / 24)} j` : `${Math.floor(hours / 24)} j ${hours % 24} h`;
}

function AvailabilityTile({ availability }: { availability: Availability }) {
  return (
    <div>
      <dt className="eyebrow">Disponibilité sur {WINDOW_LABELS[availability.window]}</dt>
      {availability.percent === null ? (
        <dd className="mt-0.5 text-sm text-muted">Échantillon insuffisant</dd>
      ) : (
        <dd className="mt-0.5">
          <span className="text-lg font-semibold tabular-nums">{percent.format(availability.percent)} %</span>
          <span className="block text-xs text-faint">
            sur {formatDuration(availability.measuredSeconds)} mesurées
            {availability.downSeconds > 0 && `, dont ${formatDuration(availability.downSeconds)} hors ligne`}
          </span>
        </dd>
      )}
    </div>
  );
}

const hourOfDay = new Intl.DateTimeFormat("fr-BE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" });

function hourTitle(cell: HourCell): string {
  const start = new Date(cell.start);
  const range = `${hourOfDay.format(start)} – ${hourOfDay.format(new Date(start.getTime() + 3_600_000))}`;
  if (cell.status === null) return `${range} : aucune mesure`;
  const parts = [];
  if (cell.availableSeconds > 0) parts.push(`en ligne ${formatDuration(cell.availableSeconds)}`);
  if (cell.downSeconds > 0) parts.push(`hors ligne ${formatDuration(cell.downSeconds)}`);
  return `${range} : ${parts.join(", ")}${cell.status === "degraded" ? " (dégradé par moments)" : ""}`;
}

function stripSummary(hours: HourCell[]): string {
  const count = (status: HourCell["status"]) => hours.filter((cell) => cell.status === status).length;
  const parts = [
    [count("up"), "en ligne"],
    [count("degraded"), "avec dégradation"],
    [count("down"), "avec panne"],
    [count(null), "sans mesure"],
  ] as const;
  return `24 dernières heures : ${parts
    .filter(([hoursCount]) => hoursCount > 0)
    .map(([hoursCount, label]) => `${hoursCount} h ${label}`)
    .join(", ")}`;
}

export function ServiceHistoryPanel({ history }: { history: ServiceHistory }) {
  return (
    <div className="panel p-5">
      <h3 className="display text-base font-bold text-gold">{history.label}</h3>
      <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {history.availability.map((availability) => (
          <AvailabilityTile key={availability.window} availability={availability} />
        ))}
      </dl>
      <p className="eyebrow mt-4 mb-2">24 dernières heures</p>
      <div className="status-strip" role="img" aria-label={stripSummary(history.hours)}>
        {history.hours.map((cell) => (
          <span key={cell.start} className="status-cell" data-status={cell.status ?? undefined} title={hourTitle(cell)} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[0.7rem] text-faint">
        <span>{hourOfDay.format(new Date(history.hours[0].start))}</span>
        <span>maintenant</span>
      </div>
    </div>
  );
}

/**
 * Miniatures de l'accueil : une carte par service, qui mène tout entière à la page Serveurs. La
 * frise y est décorative : la disponibilité écrite en dessous en dit l'essentiel, le détail heure
 * par heure reste sur la page.
 */
/** État des serveurs en pastilles, pour l'en-tête de l'accueil : chacune mène à la page Serveurs. */
export function ServerStatusChips({ services }: { services: ServiceSummary[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {services.map((service) => (
        <li key={service.service}>
          <Link href="/servers" className="badge server-chip" data-tone={STATUS_TONES[service.status]} data-status={service.status} title={service.detail}>
            <span className="status-dot" aria-hidden="true" />
            <span className="text-text">{service.label}</span>
            {STATUS_LABELS[service.status]}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ServerStatusTiles({ services, now }: { services: ServiceSummary[]; now: Date }) {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {services.map((service) => (
        <li key={service.service}>
          <Link href="/servers" className="panel status-tile block px-4 py-3.5 sm:px-5" title={service.detail}>
            <span className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate font-medium">{service.label}</span>
              <StatusBadge status={service.status} />
            </span>
            <span className="mt-1 block text-xs text-muted">
              {service.checkedAt ? (
                <>
                  {service.latencyMs !== null && `${formatLatency(service.latencyMs)} · `}
                  contrôlé{" "}
                  <time dateTime={service.checkedAt} title={formatCheckTime(service.checkedAt)}>
                    {formatRelative(service.checkedAt, now)}
                  </time>
                </>
              ) : (
                "Aucun contrôle enregistré"
              )}
            </span>
            <span className="status-strip mt-3" data-size="sm" aria-hidden="true">
              {service.hours.map((cell) => (
                <span key={cell.start} className="status-cell" data-status={cell.status ?? undefined} />
              ))}
            </span>
            <span className="mt-1.5 block text-[0.7rem] text-faint">
              {service.availability.percent === null
                ? "24 heures : échantillon insuffisant"
                : `Disponibilité sur 24 heures : ${percent.format(service.availability.percent)} %`}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function TransitionsTable({ transitions }: { transitions: TransitionView[] }) {
  return (
    <div className="panel overflow-x-auto">
      <table className="data-table min-w-[720px]">
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Service</th>
            <th scope="col">Changement</th>
            <th scope="col">Constat</th>
          </tr>
        </thead>
        <tbody>
          {transitions.map((transition) => (
            <tr key={`${transition.service}-${transition.at}`}>
              <td className="whitespace-nowrap">
                <time dateTime={transition.at}>{formatCheckTime(transition.at)}</time>
              </td>
              <td className="whitespace-nowrap">{transition.label}</td>
              <td className="whitespace-nowrap">
                <StatusBadge status={transition.from} />
                <span className="mx-1.5 text-faint" aria-hidden="true">
                  →
                </span>
                <span className="sr-only">devient</span>
                <StatusBadge status={transition.to} />
              </td>
              <td className="text-muted">{transition.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
