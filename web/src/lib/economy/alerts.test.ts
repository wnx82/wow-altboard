import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { eq } from "drizzle-orm";
import * as t from "@/db/schema";
import { countRows, openTestDatabase, type TestDatabase } from "@/db/testing";
import { createAgentToken } from "@/lib/agent-tokens";
import { writeSettings } from "@/lib/settings/store";
import { processSync } from "@/lib/sync/process";
import type { SyncPayload } from "@/lib/sync/schema";
import { consideredPrice, deleteAlert, isTriggered, listAlerts, MAX_ALERTS, saveItemAlerts } from "./alerts";

// Fixture : l'objet 2576 a pour dernier prix 100 pc, relevé le 2026-11-06.
const BASE: SyncPayload = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../../../tests/fixtures/payloads/economy-account.json"), "utf8"),
);
const NOW = new Date("2026-11-06T18:00:00Z");

let database: TestDatabase;
let marketId: number;

before(async () => {
  database = await openTestDatabase();
});

after(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.reset();
  const tokenId = (await createAgentToken(database.db, "PC de test")).id;
  await processSync(database.db, structuredClone(BASE), { tokenId, requestId: "test", now: NOW });
  [{ id: marketId }] = await database.db.select({ id: t.markets.id }).from(t.markets);
});

const save = (itemKey: string, below: number | null, above: number | null) => saveItemAlerts(database.db, { marketId, itemKey, below, above, now: NOW });

describe("règle de déclenchement", () => {
  test("seuil bas atteint au prix égal ou inférieur, seuil haut au prix égal ou supérieur", () => {
    const at = (minCopper: number) => ({ minCopper, day: "2026-11-06" });
    assert.equal(isTriggered("below", 100, at(100)), true);
    assert.equal(isTriggered("below", 100, at(101)), false);
    assert.equal(isTriggered("above", 100, at(100)), true);
    assert.equal(isTriggered("above", 100, at(99)), false);
    assert.equal(isTriggered("below", 100, null), false);
  });

  test("un prix antérieur au début de l'historique ne compte pas", () => {
    const latest = { minCopper: 50, day: "2026-11-03" };
    assert.equal(consideredPrice(latest, "2026-11-04"), null);
    assert.equal(consideredPrice(latest, "2026-11-03"), latest);
    assert.equal(consideredPrice(latest, null), latest);
  });
});

describe("alertes enregistrées", () => {
  test("pose, remplacement et retrait des seuils d'un objet", async () => {
    assert.deepEqual(await save("2576", 150, 500), { ok: true, saved: 2, removed: 0 });
    let alerts = await listAlerts(database.db, { marketId, itemKey: "2576" });
    // Dernier prix 100 pc : sous le seuil bas de 150, loin du seuil haut.
    assert.deepEqual(
      alerts.map((a) => [a.direction, a.thresholdCopper, a.latest, a.triggered]),
      [
        ["below", 150, { minCopper: 100, day: "2026-11-06" }, true],
        ["above", 500, { minCopper: 100, day: "2026-11-06" }, false],
      ],
    );

    assert.deepEqual(await save("2576", 80, null), { ok: true, saved: 1, removed: 1 });
    alerts = await listAlerts(database.db, { marketId, itemKey: "2576" });
    assert.deepEqual(
      alerts.map((a) => [a.direction, a.thresholdCopper, a.triggered]),
      [["below", 80, false]],
    );

    assert.deepEqual(await save("2576", null, null), { ok: true, saved: 0, removed: 1 });
    assert.equal(await countRows(database.db, t.priceAlerts), 0);
  });

  test("déclenchées en tête, tous marchés ; un objet sans prix reste en attente", async () => {
    await save("999999", null, 100);
    await save("10559", null, 1_000_000);
    await save("2576", null, 90);
    const alerts = await listAlerts(database.db);
    assert.deepEqual(
      alerts.map((a) => [a.itemKey, a.triggered, a.latest === null]),
      [
        ["2576", true, false],
        ["10559", false, false],
        ["999999", false, true],
      ],
    );
  });

  test("le début de l'historique s'applique aux prix comparés", async () => {
    await save("2576", 150, null);
    await writeSettings(database.db, { marketHistoryFrom: new Date("2026-11-10T12:00:00Z") }, NOW);
    const [alert] = await listAlerts(database.db, { marketId });
    assert.equal(alert.latest, null);
    assert.equal(alert.triggered, false);
  });

  test("saisies refusées : seuils inversés, objet ou marché inconnu, trop d'alertes", async () => {
    assert.deepEqual(await save("2576", 500, 500), { ok: false, error: "Le seuil bas doit être inférieur au seuil haut." });
    assert.deepEqual(await save("pas-un-objet", 100, null), { ok: false, error: "Objet inconnu." });
    assert.deepEqual(await saveItemAlerts(database.db, { marketId: marketId + 1000, itemKey: "2576", below: 1, above: null, now: NOW }), {
      ok: false,
      error: "Marché introuvable.",
    });

    await database.db.insert(t.priceAlerts).values(
      Array.from({ length: MAX_ALERTS - 1 }, (_, i) => ({ marketId, itemKey: String(100_000 + i), direction: "below", thresholdCopper: 1 })),
    );
    assert.deepEqual(await save("2576", 10, 20), { ok: false, error: `${MAX_ALERTS} alertes au plus : retirez-en d'abord.` });
    assert.equal((await save("2576", 10, null)).ok, true);
    // Remplacer un seuil existant ne compte pas comme une alerte de plus.
    assert.equal((await save("2576", 12, null)).ok, true);
    assert.equal(await countRows(database.db, t.priceAlerts), MAX_ALERTS);
  });

  test("retrait d'une alerte ; elles disparaissent avec leur marché", async () => {
    await save("2576", 150, 500);
    const [first] = await listAlerts(database.db, { marketId });
    assert.deepEqual(await deleteAlert(database.db, first.id), { marketId, itemKey: "2576" });
    assert.equal(await deleteAlert(database.db, first.id), null);

    await database.db.delete(t.markets).where(eq(t.markets.id, marketId));
    assert.equal(await countRows(database.db, t.priceAlerts), 0);
  });
});
