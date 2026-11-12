import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { asc } from "drizzle-orm";
import * as t from "@/db/schema";
import { openTestDatabase, type TestDatabase } from "@/db/testing";
import { BUILD_URL, catalogUrl } from "@/lib/economy/item-names";
import { itemTableUrl } from "./icon-files";
import { ERA_BUILD_URL, importItemSpecs, itemSpecsSummary, loadItemSpecs, mergeItemSpecs, parseItemLevels, parseItemTypes } from "./item-specs";

const NOW = new Date("2026-11-13T10:00:00Z");
// Une épée, un plastron de cuir, un anneau, une robe de tissu, et deux objets qui ne sont pas de l'équipement.
const ITEM_TABLE = [
  "ID,ClassID,SubclassID,Material,InventoryType,IconFileDataID",
  "15210,2,7,1,13,135321",
  "2316,4,2,8,5,132719",
  "1462,4,0,4,11,133345",
  "16866,4,4,6,7,134584",
  "2589,7,5,7,0,132905",
  "x,4,1,7,5,1",
  "4306,0,0,0,0,1",
].join("\n");
const FOREVER_SPARSE = [
  "ID,Display_lang,ItemLevel,AllowableClass,RequiredLevel,InventoryType",
  '2316,"Gilet en cuir, renforcé",16,-1,11,5',
  "1462,Anneau,30,32767,25,11",
  "2589,Étoffe de lin,5,32767,0,0",
].join("\n");
const ERA_SPARSE = [
  "ID,Display_lang,AllowableClass,ItemLevel,RequiredLevel,InventoryType",
  "15210,Épée courte d'écumeur,-1,16,11,13",
  "2316,Gilet en cuir,-1,99,99,5",
  "16866,Jambières de puissance,1,66,60,7",
].join("\n");

function fakeWago(options: { forever?: string; era?: string; eraStatus?: number; eraBuildStatus?: number } = {}) {
  const forever = options.forever ?? "1.60.1.70888";
  const era = options.era ?? "1.15.9.70576";
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url === BUILD_URL) return new Response(JSON.stringify({ version: forever }), { status: 200 });
    if (url === ERA_BUILD_URL) return new Response(JSON.stringify({ version: era }), { status: options.eraBuildStatus ?? 200 });
    if (url === itemTableUrl(forever)) return new Response(ITEM_TABLE, { status: 200 });
    if (url === catalogUrl(forever)) return new Response(FOREVER_SPARSE, { status: 200 });
    if (url === catalogUrl(era)) return new Response(ERA_SPARSE, { status: options.eraStatus ?? 200 });
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

describe("caractéristiques des armures et des armes", () => {
  test("table Item : armures et armes seulement, avec type et emplacement", () => {
    const parsed = parseItemTypes(ITEM_TABLE);
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.ok && parsed.value, [
      { itemId: 15210, itemClass: 2, subclass: 7, inventoryType: 13 },
      { itemId: 2316, itemClass: 4, subclass: 2, inventoryType: 5 },
      { itemId: 1462, itemClass: 4, subclass: 0, inventoryType: 11 },
      { itemId: 16866, itemClass: 4, subclass: 4, inventoryType: 7 },
    ]);
    assert.equal(parseItemTypes("ID,IconFileDataID\n1,2").ok, false);
  });

  test("table ItemSparse : niveaux et classes autorisées, colonnes repérées par leur nom", () => {
    const forever = parseItemLevels(FOREVER_SPARSE);
    const era = parseItemLevels(ERA_SPARSE);
    assert.equal(forever.ok && era.ok, true);
    if (!forever.ok || !era.ok) return;
    assert.deepEqual(forever.value.get(2316), { itemLevel: 16, requiredLevel: 11, allowableClass: null });
    assert.deepEqual(forever.value.get(1462), { itemLevel: 30, requiredLevel: 25, allowableClass: null });
    assert.deepEqual(era.value.get(16866), { itemLevel: 66, requiredLevel: 60, allowableClass: 1 });

    // WoW Forever d'abord, Classic Era pour les objets qu'il ne publie pas.
    const types = parseItemTypes(ITEM_TABLE);
    assert.equal(types.ok, true);
    const merged = mergeItemSpecs(types.ok ? types.value : [], forever.value, era.value);
    assert.deepEqual(
      merged.map((row) => [row.itemId, row.requiredLevel, row.levelSource]),
      [
        [15210, 11, "era"],
        [2316, 11, "wowf"],
        [1462, 25, "wowf"],
        [16866, 60, "era"],
      ],
    );
  });

  test("import, rien de téléchargé tant que les versions ne changent pas, puis remplacement", async () => {
    const first = fakeWago();
    const imported = await importItemSpecs(database.db, { now: NOW, fetch: first.fetchImpl, onlyIfNewer: true });
    assert.deepEqual(imported, { ok: true, build: "1.60.1.70888/1.15.9.70576", count: 4, fromForever: 2, fromEra: 2, removed: 0 });
    const rows = await database.db.select().from(t.itemSpecs).orderBy(asc(t.itemSpecs.itemId));
    assert.deepEqual(
      rows.map((row) => [row.itemId, row.itemClass, row.subclass, row.inventoryType, row.itemLevel, row.requiredLevel, row.allowableClass, row.levelSource]),
      [
        [1462, 4, 0, 11, 30, 25, null, "wowf"],
        [2316, 4, 2, 5, 16, 11, null, "wowf"],
        [15210, 2, 7, 13, 16, 11, null, "era"],
        [16866, 4, 4, 7, 66, 60, 1, "era"],
      ],
    );

    const again = fakeWago();
    const unchanged = await importItemSpecs(database.db, { now: NOW, fetch: again.fetchImpl, onlyIfNewer: true });
    assert.equal(unchanged.ok && unchanged.unchanged, true);
    assert.deepEqual(again.calls, [BUILD_URL, ERA_BUILD_URL]);

    // Nouvelle version de Classic Era : tout est relu et la version précédente disparaît.
    const newer = await importItemSpecs(database.db, { now: NOW, fetch: fakeWago({ era: "1.15.10.71000" }).fetchImpl, onlyIfNewer: true });
    assert.equal(newer.ok && newer.removed, 0);
    assert.equal((await itemSpecsSummary(database.db)).build, "1.60.1.70888/1.15.10.71000");
  });

  test("un échec de wago.tools ne touche pas aux caractéristiques déjà importées", async () => {
    await importItemSpecs(database.db, { now: NOW, fetch: fakeWago().fetchImpl });
    const failed = await importItemSpecs(database.db, { now: NOW, fetch: fakeWago({ era: "1.15.10.71000", eraStatus: 503 }).fetchImpl });
    assert.deepEqual(failed, { ok: false, error: "wago.tools a répondu 503." });
    const summary = await itemSpecsSummary(database.db);
    assert.deepEqual([summary.count, summary.build], [4, "1.60.1.70888/1.15.9.70576"]);
  });

  test("Classic Era injoignable au premier import : WoW Forever seul, complété dès que Classic Era répond", async () => {
    const alone = await importItemSpecs(database.db, { now: NOW, fetch: fakeWago({ eraBuildStatus: 503 }).fetchImpl, onlyIfNewer: true });
    assert.deepEqual(alone, { ok: true, build: "1.60.1.70888/", count: 4, fromForever: 2, fromEra: 0, removed: 0 });
    const full = await importItemSpecs(database.db, { now: NOW, fetch: fakeWago().fetchImpl, onlyIfNewer: true });
    assert.deepEqual(full, { ok: true, build: "1.60.1.70888/1.15.9.70576", count: 4, fromForever: 2, fromEra: 2, removed: 0 });
    // Une fois l'import complet en place, une panne de Classic Era ne le dégrade pas.
    const down = await importItemSpecs(database.db, { now: NOW, fetch: fakeWago({ eraBuildStatus: 503 }).fetchImpl, onlyIfNewer: true });
    assert.equal(down.ok, false);
    assert.equal((await itemSpecsSummary(database.db)).fromEra, 2);
  });

  test("lecture par clé d'objet, variantes à suffixe comprises ; un objet qui n'est pas de l'équipement est absent", async () => {
    await importItemSpecs(database.db, { now: NOW, fetch: fakeWago().fetchImpl });
    const specs = await loadItemSpecs(database.db, ["15210:1017", "2316", "2589", "p:1234", "999"]);
    assert.deepEqual([...specs.keys()].sort(), ["15210:1017", "2316"]);
    assert.deepEqual(specs.get("15210:1017"), { itemClass: 2, subclass: 7, inventoryType: 13, itemLevel: 16, requiredLevel: 11, allowableClass: null });
    assert.deepEqual(await loadItemSpecs(database.db, []), new Map());
  });
});
