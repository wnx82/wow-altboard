import { brusselsDay } from "@/lib/wow/format";
import { buildHistory, type Change, type SnapshotLike } from "./history";
import { matchesRoster, type RosterFilter } from "./roster-filter";

export type ActivityCharacter = { id: number; name: string; class: string | null; accountId: number; account: string };
export type ActivitySnapshot = SnapshotLike & { character: ActivityCharacter };
export type ActivityEntry = { at: Date; character: ActivityCharacter; changes: Change[] };
export type ActivityDay = { day: string; entries: ActivityEntry[] };

/**
 * Changements de tous les personnages depuis `since`, du plus récent au plus ancien, regroupés
 * par jour (heure de Bruxelles). Un relevé antérieur à `since` ne sert que de point de
 * comparaison au premier relevé de la période.
 */
export function buildActivity(snapshots: ActivitySnapshot[], since: Date): ActivityDay[] {
  const entries: ActivityEntry[] = [];
  for (const rows of Map.groupBy(snapshots, (snapshot) => snapshot.character.id).values()) {
    const ordered = rows.toSorted((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
    for (const entry of buildHistory(ordered)) {
      if (entry.at >= since) entries.push({ ...entry, character: ordered[0].character });
    }
  }
  entries.sort((a, b) => b.at.getTime() - a.at.getTime() || a.character.name.localeCompare(b.character.name, "fr"));

  return [...Map.groupBy(entries, (entry) => brusselsDay(entry.at))].map(([day, dayEntries]) => ({ day, entries: dayEntries }));
}

export const CHANGE_KIND_LABELS: Record<Change["kind"], string> = {
  level: "Niveaux",
  money: "Or",
  itemLevel: "Niveau d'objet",
  profession: "Métiers",
  reputation: "Réputations",
  guild: "Guilde",
};

export const isChangeKind = (value: string): value is Change["kind"] => Object.hasOwn(CHANGE_KIND_LABELS, value);

/**
 * Journées réduites aux personnages du filtre et, si `kind` est donné, aux changements de ce type.
 * Un relevé sans changement retenu disparaît, une journée vide aussi.
 */
export function filterActivity(days: ActivityDay[], filter: RosterFilter, kind: Change["kind"] | null): ActivityDay[] {
  return days
    .map(({ day, entries }) => ({
      day,
      entries: entries
        .filter((entry) => matchesRoster(entry.character, filter))
        .map((entry) => (kind === null ? entry : { ...entry, changes: entry.changes.filter((change) => change.kind === kind) }))
        .filter((entry) => entry.changes.length > 0),
    }))
    .filter((day) => day.entries.length > 0);
}
