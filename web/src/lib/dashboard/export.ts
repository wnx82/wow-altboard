import { asc, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import * as t from "@/db/schema";
import { classLabel, progressPercent, QUALITY_LABELS, REACTION_LABELS, SLOT_LABELS } from "@/lib/wow/format";
import { buildWorkbook, type Sheet } from "@/lib/xlsx/workbook";
import { getOverview, listAccounts, listCharacters, listMachines } from "./queries";

// L'export est une photographie de la base : PostgreSQL reste la source, pas le classeur.

const gold = (copper: number | null) => (copper === null ? null : copper / 10_000);

export function exportFileName(now: Date): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels" }).format(now);
  return `AltBoard-export-${day}.xlsx`;
}

export async function buildExport(db: Database, now: Date): Promise<Buffer> {
  const characterRef = { character: t.characters.name, realm: t.realms.name };

  const [characters, overview, accounts, machines, equipment, currencies, reputations] = await Promise.all([
    listCharacters(db),
    getOverview(db),
    listAccounts(db),
    listMachines(db),
    db
      .select({ ...characterRef, slot: t.characterEquipment.slot, name: t.characterEquipment.name, quality: t.characterEquipment.quality, itemLevel: t.characterEquipment.itemLevel, itemId: t.characterEquipment.itemId, enchantId: t.characterEquipment.enchantId })
      .from(t.characterEquipment)
      .innerJoin(t.characters, eq(t.characters.id, t.characterEquipment.characterId))
      .innerJoin(t.realms, eq(t.realms.id, t.characters.realmId))
      .orderBy(asc(t.characters.name), asc(t.characterEquipment.slot)),
    db
      .select({ ...characterRef, name: t.characterCurrencies.name, quantity: t.characterCurrencies.quantity, max: t.characterCurrencies.maxQuantity })
      .from(t.characterCurrencies)
      .innerJoin(t.characters, eq(t.characters.id, t.characterCurrencies.characterId))
      .innerJoin(t.realms, eq(t.realms.id, t.characters.realmId))
      .orderBy(asc(t.characters.name), asc(t.characterCurrencies.name)),
    db
      .select({ ...characterRef, group: t.characterReputations.groupName, name: t.characterReputations.name, reaction: t.characterReputations.reaction, current: t.characterReputations.currentValue, min: t.characterReputations.minValue, max: t.characterReputations.maxValue })
      .from(t.characterReputations)
      .innerJoin(t.characters, eq(t.characters.id, t.characterReputations.characterId))
      .innerJoin(t.realms, eq(t.realms.id, t.characters.realmId))
      .orderBy(asc(t.characters.name), asc(t.characterReputations.groupName), asc(t.characterReputations.name)),
  ]);

  const levels = characters.map((c) => c.level).filter((level): level is number => level !== null);
  const totalCopper = characters.reduce((total, c) => total + (c.moneyCopper ?? 0), 0);

  const sheets: Sheet[] = [
    {
      name: "Résumé",
      columns: [{ header: "Indicateur", width: 34 }, { header: "Valeur", width: 26 }],
      rows: [
        ["Date de l'export", now],
        ["Personnages", characters.length],
        ["Comptes", overview.accounts],
        ["Machines", overview.machines],
        ["Niveau moyen", levels.length > 0 ? Math.round((levels.reduce((a, b) => a + b, 0) / levels.length) * 10) / 10 : null],
        ["Or cumulé (po)", gold(totalCopper)],
        ["Métiers", characters.reduce((total, c) => total + c.professions.length, 0)],
        ["Dernière synchronisation", overview.lastSync ? new Date(overview.lastSync.at) : null],
        ["Machine de la dernière synchronisation", overview.lastSync?.machine ?? null],
      ],
    },
    {
      name: "Personnages",
      columns: [
        { header: "Nom", width: 28 }, { header: "Royaume", width: 20 }, { header: "Faction", width: 12 }, { header: "Classe", width: 20 },
        { header: "Race", width: 26 }, { header: "Niveau", width: 9 }, { header: "XP", width: 11 }, { header: "XP du niveau", width: 13 },
        { header: "Niveau d'objet", width: 14 }, { header: "Or (po)", width: 12 }, { header: "Or (cuivre)", width: 13 }, { header: "Guilde", width: 26 },
        { header: "Zone", width: 28 }, { header: "Compte", width: 20 }, { header: "PC", width: 22 }, { header: "Dernière donnée AltBoard", width: 24 },
        { header: "Dernière synchronisation", width: 24 }, { header: "Masqué dans l'addon", width: 20 },
      ],
      rows: characters.map((c) => [
        c.name, c.realm, c.faction, classLabel(c.class), c.race, c.level, c.xp, c.xpMax, c.itemLevel, gold(c.moneyCopper), c.moneyCopper, c.guild, c.zone,
        c.account.label, c.machines.map((m) => m.label).join(", "), new Date(c.sourceLastSeenAt), new Date(c.lastSyncAt), c.hidden ? "oui" : "non",
      ]),
    },
    {
      name: "Métiers",
      columns: [{ header: "Personnage", width: 28 }, { header: "Royaume", width: 20 }, { header: "Métier", width: 24 }, { header: "Niveau", width: 9 }, { header: "Maximum", width: 10 }, { header: "Progression (%)", width: 16 }, { header: "Principal", width: 11 }],
      rows: characters.flatMap((c) => c.professions.map((p) => [c.name, c.realm, p.name, p.rank, p.maxRank, progressPercent(p.rank, p.maxRank), p.isPrimary ? "oui" : "non"])),
    },
    {
      name: "Équipement",
      columns: [{ header: "Personnage", width: 28 }, { header: "Royaume", width: 20 }, { header: "Emplacement", width: 16 }, { header: "Objet", width: 40 }, { header: "Qualité", width: 14 }, { header: "Niveau d'objet", width: 14 }, { header: "ID objet", width: 11 }, { header: "ID enchantement", width: 16 }],
      rows: equipment.map((e) => [e.character, e.realm, SLOT_LABELS[e.slot] ?? `Emplacement ${e.slot}`, e.name, e.quality === null ? null : (QUALITY_LABELS[e.quality] ?? String(e.quality)), e.itemLevel, e.itemId, e.enchantId]),
    },
    {
      name: "Monnaies",
      columns: [{ header: "Personnage", width: 28 }, { header: "Royaume", width: 20 }, { header: "Monnaie", width: 30 }, { header: "Quantité", width: 11 }, { header: "Maximum", width: 11 }],
      rows: currencies.map((c) => [c.character, c.realm, c.name, c.quantity, c.max && c.max > 0 ? c.max : null]),
    },
    {
      name: "Réputations",
      columns: [{ header: "Personnage", width: 28 }, { header: "Royaume", width: 20 }, { header: "Groupe", width: 24 }, { header: "Faction", width: 36 }, { header: "Palier", width: 12 }, { header: "Valeur", width: 10 }, { header: "Minimum du palier", width: 18 }, { header: "Maximum du palier", width: 18 }],
      rows: reputations.map((r) => [r.character, r.realm, r.group, r.name, r.reaction === null ? null : (REACTION_LABELS[r.reaction] ?? String(r.reaction)), r.current, r.min, r.max]),
    },
    {
      name: "Comptes",
      columns: [{ header: "Compte", width: 24 }, { header: "Référence", width: 18 }, { header: "Personnages", width: 13 }, { header: "Niveau maximum", width: 16 }, { header: "Or cumulé (po)", width: 16 }, { header: "Vu depuis", width: 30 }, { header: "Dernière synchronisation", width: 24 }],
      rows: accounts.map((a) => [a.label, a.folderName ?? a.folderHint, a.characters, a.maxLevel, gold(a.totalCopper), a.machines.map((m) => m.label).join(", "), a.lastSyncAt]),
    },
    {
      name: "Machines",
      columns: [{ header: "Machine", width: 24 }, { header: "Nom d'hôte", width: 20 }, { header: "Version de l'agent", width: 18 }, { header: "Comptes", width: 10 }, { header: "Personnages", width: 13 }, { header: "Première synchronisation", width: 24 }, { header: "Dernière synchronisation", width: 24 }],
      rows: machines.machines.map((m) => [m.label, m.hostname, m.agentVersion, m.accounts, m.characters, m.firstSeenAt, m.lastSeenAt]),
    },
  ];

  return buildWorkbook(sheets);
}
