import { formatDuration, formatMoney } from "@/lib/wow/format";
import type { NotifyEventKey } from "./config";

// Événements envoyés au webhook, et leur texte en français. Pur, sans base ni réseau : n8n reçoit
// un document JSON prêt à transmettre (texte) et ses données (data) pour qui veut les retravailler.

export type NotificationEvent = {
  /** Réglage qui l'autorise ; « test » : l'essai de la page Paramètres, toujours envoyé. */
  key: NotifyEventKey | "test";
  /** Nom stable, pour les filtres de n8n. */
  event: string;
  text: string;
  data: Record<string, unknown>;
};

/** Document JSON envoyé. */
export function payloadOf(event: NotificationEvent, at: Date) {
  return { source: "wow-altboard", event: event.event, at: at.toISOString(), text: event.text, data: event.data };
}

export function levelEvent(character: { id: number; name: string }, from: number, to: number): NotificationEvent {
  const gained = to - from;
  return {
    key: "level",
    event: "level.gained",
    text: `${character.name} atteint le niveau ${to}${gained > 1 ? ` (${gained} niveaux gagnés)` : ""}.`,
    data: { characterId: character.id, character: character.name, from, to },
  };
}

export function goalEvent(goal: { id: number; label: string; achievedAt: Date }, character: { id: number; name: string }): NotificationEvent {
  return {
    key: "goal",
    event: "goal.reached",
    text: `${character.name} a atteint son objectif « ${goal.label} ».`,
    data: { goalId: goal.id, goal: goal.label, characterId: character.id, character: character.name, achievedAt: goal.achievedAt.toISOString() },
  };
}

export function serverEvent(check: { checkedAt: Date; status: string; latencyMs: number | null }, downSince: Date): NotificationEvent {
  return {
    key: "server",
    event: "server.online",
    text: `Le serveur de jeu répond de nouveau${check.status === "degraded" ? ", en partie" : ""}.`,
    data: { status: check.status, latencyMs: check.latencyMs, checkedAt: check.checkedAt.toISOString(), downSince: downSince.toISOString() },
  };
}

export function silentEvent(machine: { id: number; label: string; lastSeenAt: Date }, days: number): NotificationEvent {
  return {
    key: "silent",
    event: "machine.silent",
    text: `${machine.label} n'a rien synchronisé depuis ${days} jour${days > 1 ? "s" : ""}.`,
    data: { machineId: machine.id, machine: machine.label, lastSeenAt: machine.lastSeenAt.toISOString(), days },
  };
}

/**
 * PC à signaler : muets depuis au moins `days` jours et pas encore signalés pour ce silence (la
 * dernière synchronisation retenue a changé depuis). Renvoie aussi la liste à garder : un PC qui
 * a synchronisé de nouveau en sort, et sera signalé à son prochain silence.
 */
export function silentMachines(
  machines: readonly { id: number; label: string; lastSeenAt: Date }[],
  notified: Readonly<Record<string, string>>,
  days: number,
  now: Date,
): { silent: { id: number; label: string; lastSeenAt: Date; days: number }[]; notified: Record<string, string> } {
  const limit = now.getTime() - days * 24 * 3600 * 1000;
  const silent: { id: number; label: string; lastSeenAt: Date; days: number }[] = [];
  const kept: Record<string, string> = {};
  for (const machine of machines) {
    if (machine.lastSeenAt.getTime() > limit) continue;
    const seen = machine.lastSeenAt.toISOString();
    if (notified[String(machine.id)] !== seen) {
      silent.push({ ...machine, days: Math.floor((now.getTime() - machine.lastSeenAt.getTime()) / (24 * 3600 * 1000)) });
    }
    kept[String(machine.id)] = seen;
  }
  return { silent, notified: kept };
}

export type WeeklyFacts = {
  /** Lundi de la semaine résumée, AAAA-MM-JJ. */
  week: string;
  levels: { name: string; from: number; to: number }[];
  /** Or de tous les personnages au début et à la fin de la semaine, en pièces de cuivre. */
  goldStart: number;
  goldEnd: number;
  playedSeconds: number;
  sessions: number;
  goals: { character: string; label: string }[];
};

const weekLabel = new Intl.DateTimeFormat("fr-BE", { day: "numeric", month: "long", timeZone: "UTC" });

export function weeklyEvent(facts: WeeklyFacts): NotificationEvent {
  const levelsGained = facts.levels.reduce((sum, row) => sum + (row.to - row.from), 0);
  const goldDelta = facts.goldEnd - facts.goldStart;
  const lines = [
    `Semaine du ${weekLabel.format(new Date(`${facts.week}T00:00:00Z`))} :`,
    levelsGained === 0
      ? "aucun niveau gagné"
      : `${levelsGained} niveau${levelsGained > 1 ? "x" : ""} gagné${levelsGained > 1 ? "s" : ""} (${facts.levels.map((row) => `${row.name} ${row.from} → ${row.to}`).join(", ")})`,
    `or : ${goldDelta >= 0 ? "+" : "−"}${formatMoney(Math.abs(goldDelta))} (total ${formatMoney(facts.goldEnd)})`,
    facts.sessions === 0 ? "aucune session de jeu" : `temps joué : ${formatDuration(facts.playedSeconds)} en ${facts.sessions} session${facts.sessions > 1 ? "s" : ""}`,
    facts.goals.length === 0 ? "aucun objectif atteint" : `objectifs atteints : ${facts.goals.map((goal) => `${goal.character} « ${goal.label} »`).join(", ")}`,
  ];
  return {
    key: "weekly",
    event: "report.weekly",
    text: `${lines[0]} ${lines.slice(1).join(" ; ")}.`,
    data: { ...facts, levelsGained, goldDelta },
  };
}

export function testEvent(): NotificationEvent {
  return { key: "test", event: "test", text: "Essai de notification depuis WoW AltBoard : le webhook est bien joint.", data: {} };
}
