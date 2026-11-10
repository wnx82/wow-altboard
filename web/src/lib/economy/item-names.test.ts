import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { asc } from "drizzle-orm";
import * as t from "@/db/schema";
import { openTestDatabase, type TestDatabase } from "@/db/testing";
import { createAgentToken } from "@/lib/agent-tokens";
import { processSync } from "@/lib/sync/process";
import type { SyncPayload } from "@/lib/sync/schema";
import { BUILD_URL, catalogSummary, catalogUrl, fillCatalogNames, importItemNames, loadItemNames, MAX_CATALOG_BYTES, parseCsv, parseItemSparse } from "./item-names";
import { runItemNamesImport } from "./item-names-runtime";
import { itemLabel, itemQuality, loadEconomy, type ItemName } from "./load";

const BASE: SyncPayload = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../../../tests/fixtures/payloads/economy-account.json"), "utf8"),
);
const NOW = new Date("2026-11-06T18:00:00Z");
const LATER = new Date("2026-11-20T18:00:00Z");

const HEADER = "ID,Description_lang,Display3_lang,Display2_lang,Display1_lang,Display_lang,ExpansionID,OverallQualityID";
const csv = (...rows: string[]) => [HEADER, ...rows].join("\n") + "\n";
const CATALOG = csv(
  '2576,,,,,"Chemise blanche",0,1',
  '10559,,,,,"Etoffe de tisse-mage",0,1',
  '236,"Une ""vieille"" relique",,,,"Cuir, renforcé",0,2',
  '14585,,,,,"Brassards du gardien",0,3',
);

/** Faux wago.tools : la version, puis le fichier de cette version ; les appels sont consignés. */
function fakeWago(options: { build?: string; body?: string; status?: number; fail?: Error } = {}) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (options.fail) throw options.fail;
    if (url === BUILD_URL) return new Response(JSON.stringify({ product: "wowf", version: options.build ?? "1.60.1.70862" }), { status: 200 });
    if (url === catalogUrl(options.build ?? "1.60.1.70862")) return new Response(options.body ?? CATALOG, { status: options.status ?? 200 });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

let database: TestDatabase;

before(async () => {
  database = await openTestDatabase();
});

after(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.reset();
});

describe("lecture de la table ItemSparse", () => {
  test("CSV : guillemets doublés, virgules et saut de ligne dans un champ, fins de ligne Windows", () => {
    assert.deepEqual(parseCsv('a,"b ""c"", d",e\r\n"x\ny",,z'), [
      ["a", 'b "c", d', "e"],
      ["x\ny", "", "z"],
    ]);
  });

  test("identifiant, nom et qualité ; lignes illisibles ignorées", () => {
    const parsed = parseItemSparse(csv(...CATALOG.trim().split("\n").slice(1), ',,,,,"Sans identifiant",0,1', '99,,,,,"",0,1', '2576,,,,,"Doublon",0,1', '77,,,,,"Qualité inconnue",0,'));
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.value, [
      { itemId: 2576, name: "Chemise blanche", quality: 1 },
      { itemId: 10559, name: "Etoffe de tisse-mage", quality: 1 },
      { itemId: 236, name: "Cuir, renforcé", quality: 2 },
      { itemId: 14585, name: "Brassards du gardien", quality: 3 },
      { itemId: 77, name: "Qualité inconnue", quality: null },
    ]);
  });

  test("un fichier sans les colonnes attendues, ou sans aucun nom, est refusé", () => {
    assert.equal(parseItemSparse("ID,Name\n1,Épée\n").ok, false);
    assert.equal(parseItemSparse(csv()).ok, false);
    assert.equal(parseItemSparse("").ok, false);
  });
});

describe("import des noms depuis wago.tools", () => {
  test("version la plus récente, puis son fichier ; un nouvel import remplace l'ancien", async () => {
    const wago = fakeWago();
    const first = await importItemNames(database.db, { now: NOW, fetch: wago.fetchImpl });
    assert.deepEqual(first, { ok: true, build: "1.60.1.70862", count: 4, removed: 0 });
    assert.deepEqual(wago.calls, [BUILD_URL, "https://wago.tools/db2/ItemSparse/csv?build=1.60.1.70862&locale=frFR"]);

    // Version suivante : un nom change, un objet disparaît, un autre apparaît.
    const next = fakeWago({ build: "1.60.2.71000", body: csv('2576,,,,,"Chemise blanche de lin",0,1', '10559,,,,,"Etoffe de tisse-mage",0,1', '236,,,,,"Cuir, renforcé",0,2', '4306,,,,,"Etoffe de soie",0,1') });
    const second = await importItemNames(database.db, { now: LATER, fetch: next.fetchImpl });
    assert.deepEqual(second, { ok: true, build: "1.60.2.71000", count: 4, removed: 1 });

    const rows = await database.db.select().from(t.itemNames).orderBy(asc(t.itemNames.itemId));
    assert.deepEqual(
      rows.map((row) => [row.itemId, row.name, row.build]),
      [
        [236, "Cuir, renforcé", "1.60.2.71000"],
        [2576, "Chemise blanche de lin", "1.60.2.71000"],
        [4306, "Etoffe de soie", "1.60.2.71000"],
        [10559, "Etoffe de tisse-mage", "1.60.2.71000"],
      ],
    );
    const summary = await catalogSummary(database.db);
    assert.deepEqual(summary.wago, { source: "wago", count: 4, build: "1.60.2.71000", updatedAt: LATER });
    assert.equal(summary.client.count, 0);
  });

  test("un nom lu dans le cache du jeu (« client ») n'est jamais remplacé ni supprimé", async () => {
    await database.db.insert(t.itemNames).values([
      { itemId: 2576, name: "Chemise blanche (client)", quality: 1, source: "client", build: "1.60.0.1" },
      { itemId: 99999, name: "Objet du client", quality: 2, source: "client", build: "1.60.0.1" },
    ]);
    const result = await importItemNames(database.db, { now: NOW, fetch: fakeWago().fetchImpl });
    assert.deepEqual(result, { ok: true, build: "1.60.1.70862", count: 4, removed: 0 });

    const rows = await database.db.select().from(t.itemNames).orderBy(asc(t.itemNames.itemId));
    assert.deepEqual(
      rows.map((row) => [row.itemId, row.name, row.source]),
      [
        [236, "Cuir, renforcé", "wago"],
        [2576, "Chemise blanche (client)", "client"],
        [10559, "Etoffe de tisse-mage", "wago"],
        [14585, "Brassards du gardien", "wago"],
        [99999, "Objet du client", "client"],
      ],
    );
  });

  test("échecs : rien n'est écrit, le message dit pourquoi", async () => {
    const cases: [ReturnType<typeof fakeWago>, string][] = [
      [fakeWago({ status: 503 }), "wago.tools a répondu 503."],
      [fakeWago({ body: "ID,Name\n1,Épée\n" }), "Fichier inattendu : les colonnes ID, Display_lang et OverallQualityID sont absentes."],
      [fakeWago({ build: "pas une version" }), "Version du jeu illisible dans la réponse de wago.tools."],
      [fakeWago({ fail: Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }) }), "wago.tools injoignable (ENOTFOUND)."],
      [fakeWago({ fail: new DOMException("The operation was aborted due to timeout", "TimeoutError") }), "wago.tools ne répond pas (délai dépassé)."],
    ];
    for (const [wago, error] of cases) {
      assert.deepEqual(await importItemNames(database.db, { now: NOW, fetch: wago.fetchImpl }), { ok: false, error });
    }
    assert.equal((await catalogSummary(database.db)).wago.count, 0);
  });

  test("contrôle automatique : rien n'est téléchargé tant que la version importée est la dernière", async () => {
    const first = fakeWago();
    assert.deepEqual(await importItemNames(database.db, { now: NOW, fetch: first.fetchImpl, onlyIfNewer: true }), { ok: true, build: "1.60.1.70862", count: 4, removed: 0 });
    assert.equal(first.calls.length, 2);

    const same = fakeWago();
    assert.deepEqual(await importItemNames(database.db, { now: LATER, fetch: same.fetchImpl, onlyIfNewer: true }), {
      ok: true,
      build: "1.60.1.70862",
      count: 4,
      removed: 0,
      unchanged: true,
    });
    assert.deepEqual(same.calls, [BUILD_URL]);
    assert.deepEqual((await catalogSummary(database.db)).wago.updatedAt, NOW);

    const newer = fakeWago({ build: "1.60.2.71000" });
    const result = await importItemNames(database.db, { now: LATER, fetch: newer.fetchImpl, onlyIfNewer: true });
    assert.deepEqual(result, { ok: true, build: "1.60.2.71000", count: 4, removed: 0 });
  });

  test("deux demandes simultanées partagent le même import", async () => {
    const wago = fakeWago();
    const [manual, daily] = await Promise.all([
      runItemNamesImport(database.db, { trigger: "manual", onlyIfNewer: false, fetch: wago.fetchImpl }),
      runItemNamesImport(database.db, { trigger: "daily", onlyIfNewer: true, fetch: wago.fetchImpl }),
    ]);
    assert.deepEqual(manual, { ok: true, build: "1.60.1.70862", count: 4, removed: 0 });
    assert.equal(daily, manual);
    assert.equal(wago.calls.length, 2);

    // Import terminé : la demande suivante en lance un nouveau.
    const next = await runItemNamesImport(database.db, { trigger: "daily", onlyIfNewer: true, fetch: wago.fetchImpl });
    assert.equal(next.ok && next.unchanged, true);
    assert.equal(wago.calls.length, 3);
  });

  test("une réponse plus grosse que la limite est abandonnée en cours de lecture", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const fetchImpl = (async (input: string | URL | Request) =>
      String(input) === BUILD_URL ? new Response(JSON.stringify({ version: "1.60.1.70862" })) : new Response(endless)) as typeof fetch;
    const result = await importItemNames(database.db, { now: NOW, fetch: fetchImpl });
    assert.deepEqual(result, { ok: false, error: "Fichier trop volumineux (plus de 40 Mo)." });
    assert.ok(sent <= MAX_CATALOG_BYTES + 2 * chunk.byteLength);
  });
});

describe("noms de repli", () => {
  test("le nom de l'addon l'emporte ; « g:… » prend le nom de sa base ; ni mascotte ni clé à suffixe", async () => {
    await database.db.insert(t.itemNames).values([
      { itemId: 1010, name: "Nom du jeu", quality: 1, source: "wago", build: "1" },
      { itemId: 4306, name: "Etoffe de soie", quality: 1, source: "wago", build: "1" },
      { itemId: 7000, name: "Épée du jeu", quality: 3, source: "wago", build: "1" },
      { itemId: 567, name: "Mauvais objet", quality: 4, source: "wago", build: "1" },
      { itemId: 42, name: "Pas une mascotte", quality: 1, source: "wago", build: "1" },
    ]);
    const names = new Map<string, ItemName>([
      ["1010", { name: "Bâton court", quality: 1 }],
      ["4306", { name: null, quality: 2 }],
    ]);
    await fillCatalogNames(database.db, names, ["1010", "4306", "g:7000:60", "1234:567", "p:42", "123456"]);

    assert.equal(itemLabel(names, "1010"), "Bâton court");
    // Qualité relevée par l'addon conservée, nom repris du jeu.
    assert.deepEqual(names.get("4306"), { name: "Etoffe de soie", quality: 2 });
    assert.equal(itemLabel(names, "g:7000:60"), "Épée du jeu (niveau 60)");
    assert.equal(itemQuality(names, "g:7000:60"), 3);
    assert.equal(names.has("567"), false);
    assert.equal(names.has("42"), false);
    assert.equal(itemLabel(names, "123456"), "Objet 123456");
  });

  test("le moteur nomme les objets jamais possédés ; loadItemNames combine les deux sources", async () => {
    const tokenId = (await createAgentToken(database.db, "PC de test")).id;
    await processSync(database.db, structuredClone(BASE), { tokenId, requestId: "test", now: NOW });
    const before = (await loadEconomy(database.db, { now: NOW }))!;
    assert.equal(itemLabel(before.names, "2576"), "Objet 2576");

    await importItemNames(database.db, { now: NOW, fetch: fakeWago().fetchImpl });
    const context = (await loadEconomy(database.db, { now: NOW }))!;
    assert.equal(itemLabel(context.names, "2576"), "Chemise blanche");
    assert.equal(itemLabel(context.names, "10559"), "Etoffe de tisse-mage");
    // Un objet relevé par l'addon garde son nom, même présent dans la table du jeu.
    assert.equal(itemLabel(context.names, "1010"), itemLabel(before.names, "1010"));

    const names = await loadItemNames(database.db, ["1010", "236", "236"]);
    assert.equal(itemLabel(names, "1010"), itemLabel(before.names, "1010"));
    assert.deepEqual(names.get("236"), { name: "Cuir, renforcé", quality: 2 });
    assert.equal((await loadItemNames(database.db, [])).size, 0);
  });
});
