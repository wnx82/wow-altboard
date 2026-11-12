import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { asc } from "drizzle-orm";
import * as t from "@/db/schema";
import { openTestDatabase, type TestDatabase } from "@/db/testing";
import { BUILD_URL } from "@/lib/economy/item-names";
import {
  iconFilesSummary,
  iconItemId,
  iconManifestUrl,
  importIconFiles,
  itemIconsSummary,
  itemTableUrl,
  loadIconNames,
  loadItemIcons,
  parseIconManifest,
  parseItemTable,
} from "./icon-files";
import { itemIconUrl, UNKNOWN_ITEM_ICON } from "./icons";

const NOW = new Date("2026-11-12T18:00:00Z");
const MANIFEST = [
  "ID,FilePath,FileName",
  "130646,Interface\\AbilitiesFrame\\,UI-AbilityPanel-BotLeft.blp",
  "134939,Interface\\ICONS\\,INV_Scroll_03.blp",
  "132539,Interface\\Icons\\,INV_Boots_05.blp",
  '134049,Interface\\ICONS\\,"INV_Misc_Food_93_SkethylBerries .blp"',
  '1387609,Interface\\ICONS\\,"inv_first_aid_70_ jar.blp"',
  "132134,Interface\\ICONS\\,Ability_Druid_Mangle.tga.blp",
  "134939,Interface\\ICONS\\,INV_Doublon.blp",
  "abc,Interface\\ICONS\\,INV_Pas_De_Numero.blp",
].join("\n");
const ITEM_TABLE = [
  "ID,ClassID,SubclassID,IconFileDataID,ItemGroupSoundsID",
  "4306,7,5,134939,0",
  "2589,7,5,132539,0",
  "4540,0,5,134049,0",
  "99999,0,0,0,0",
  "4306,7,5,1,0",
  "x,0,0,134939,0",
].join("\n");

/** Faux wago.tools : la version, puis le manifeste et la table Item de cette version ; les appels sont consignés. */
function fakeWago(options: { build?: string; body?: string; items?: string; status?: number; itemStatus?: number } = {}) {
  const build = options.build ?? "1.60.1.70888";
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url === BUILD_URL) return new Response(JSON.stringify({ product: "wowf", version: build }), { status: 200 });
    if (url === iconManifestUrl(build)) return new Response(options.body ?? MANIFEST, { status: options.status ?? 200 });
    if (url === itemTableUrl(build)) return new Response(options.items ?? ITEM_TABLE, { status: options.itemStatus ?? 200 });
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

describe("noms des icônes du jeu", () => {
  test("seules les icônes à nom simple sont gardées, en minuscules, la première ligne d'un identifiant l'emporte", () => {
    const parsed = parseIconManifest(MANIFEST);
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.ok && parsed.value, [
      { fileId: 134939, name: "inv_scroll_03" },
      { fileId: 132539, name: "inv_boots_05" },
      { fileId: 134049, name: "inv_misc_food_93_skethylberries" },
    ]);
  });

  test("un fichier sans les colonnes attendues ou sans icône est refusé", () => {
    assert.equal(parseIconManifest("ID,Name\n1,x").ok, false);
    assert.equal(parseIconManifest("ID,FilePath,FileName\n130646,Interface\\AbilitiesFrame\\,UI.blp").ok, false);
    assert.equal(parseItemTable("ID,ClassID\n1,2").ok, false);
    assert.equal(parseItemTable("ID,IconFileDataID\n1,0").ok, false);
  });

  test("table Item : l'icône de chaque objet, sans les objets sans icône ni les doublons", () => {
    const parsed = parseItemTable(ITEM_TABLE);
    assert.deepEqual(parsed.ok && parsed.value, [
      { itemId: 4306, fileId: 134939 },
      { itemId: 2589, fileId: 132539 },
      { itemId: 4540, fileId: 134049 },
    ]);
  });

  test("import, puis rien de téléchargé tant que la version ne change pas, puis remplacement", async () => {
    const first = fakeWago();
    assert.deepEqual(await importIconFiles(database.db, { now: NOW, fetch: first.fetchImpl }), { ok: true, build: "1.60.1.70888", count: 3, items: 3, removed: 0 });
    assert.deepEqual(await iconFilesSummary(database.db), { count: 3, build: "1.60.1.70888" });
    assert.deepEqual(await itemIconsSummary(database.db), { count: 3, build: "1.60.1.70888" });

    const again = fakeWago();
    const unchanged = await importIconFiles(database.db, { now: NOW, fetch: again.fetchImpl, onlyIfNewer: true });
    assert.equal(unchanged.ok && unchanged.unchanged, true);
    assert.deepEqual(again.calls, [BUILD_URL]);

    const newer = fakeWago({
      build: "1.60.2.71000",
      body: "ID,FilePath,FileName\n134939,Interface\\ICONS\\,INV_Scroll_04.blp\n",
      items: "ID,IconFileDataID\n4306,134939\n",
    });
    assert.deepEqual(await importIconFiles(database.db, { now: NOW, fetch: newer.fetchImpl, onlyIfNewer: true }), {
      ok: true,
      build: "1.60.2.71000",
      count: 1,
      items: 1,
      removed: 2,
    });
    assert.deepEqual(await database.db.select({ fileId: t.iconFiles.fileId, name: t.iconFiles.name }).from(t.iconFiles).orderBy(asc(t.iconFiles.fileId)), [
      { fileId: 134939, name: "inv_scroll_04" },
    ]);
    assert.deepEqual(await itemIconsSummary(database.db), { count: 1, build: "1.60.2.71000" });
  });

  test("une erreur de wago.tools ne touche pas aux icônes déjà importées", async () => {
    await importIconFiles(database.db, { now: NOW, fetch: fakeWago().fetchImpl });
    const failed = await importIconFiles(database.db, { now: NOW, fetch: fakeWago({ build: "1.60.2.71000", status: 503 }).fetchImpl });
    assert.deepEqual(failed, { ok: false, error: "wago.tools a répondu 503." });
    assert.equal((await iconFilesSummary(database.db)).count, 3);
    // La table Item en échec : rien n'est écrit, pas même les noms d'icônes déjà téléchargés.
    const itemFailed = await importIconFiles(database.db, { now: NOW, fetch: fakeWago({ build: "1.60.2.71000", itemStatus: 503 }).fetchImpl });
    assert.equal(itemFailed.ok, false);
    assert.deepEqual(await iconFilesSummary(database.db), { count: 3, build: "1.60.1.70888" });
    assert.deepEqual(await itemIconsSummary(database.db), { count: 3, build: "1.60.1.70888" });
  });

  test("une version déjà importée sans la table Item la télécharge quand même", async () => {
    await importIconFiles(database.db, { now: NOW, fetch: fakeWago().fetchImpl });
    await database.db.delete(t.itemIcons);
    const again = await importIconFiles(database.db, { now: NOW, fetch: fakeWago().fetchImpl, onlyIfNewer: true });
    assert.equal(again.ok && again.unchanged, undefined);
    assert.equal((await itemIconsSummary(database.db)).count, 3);
  });

  test("lecture par identifiant de fichier, adresse de l'image et repli sur le point d'interrogation", async () => {
    await importIconFiles(database.db, { now: NOW, fetch: fakeWago().fetchImpl });
    assert.deepEqual(await loadIconNames(database.db, [134939, 134939, 999]), new Map([[134939, "inv_scroll_03"]]));
    assert.deepEqual(await loadIconNames(database.db, []), new Map());
    assert.equal(itemIconUrl("inv_scroll_03"), "https://render.worldofwarcraft.com/eu/icons/56/inv_scroll_03.jpg");
    assert.equal(itemIconUrl(null), `https://render.worldofwarcraft.com/eu/icons/56/${UNKNOWN_ITEM_ICON}.jpg`);
    assert.equal(itemIconUrl("../secret"), `https://render.worldofwarcraft.com/eu/icons/56/${UNKNOWN_ITEM_ICON}.jpg`);
  });

  test("icône d'une clé : celle de l'addon d'abord, sinon celle de la table Item, variantes comprises", async () => {
    await importIconFiles(database.db, { now: NOW, fetch: fakeWago().fetchImpl });
    await database.db.insert(t.items).values({ itemKey: "2589", itemId: 2589, name: "Étoffe de lin", quality: 1, icon: 134049 });
    const icons = await loadItemIcons(database.db, ["2589", "4306", "g:4306:60", "4306:12", "4540", "p:4306", "777", "bad key"]);
    assert.deepEqual(
      [...icons].sort(),
      [
        ["2589", "inv_misc_food_93_skethylberries"],
        ["4306", "inv_scroll_03"],
        ["4306:12", "inv_scroll_03"],
        ["4540", "inv_misc_food_93_skethylberries"],
        ["g:4306:60", "inv_scroll_03"],
      ],
    );
    assert.deepEqual(await loadItemIcons(database.db, []), new Map());
    assert.equal(iconItemId("p:4306"), null);
    assert.equal(iconItemId("g:4306:60"), 4306);
    assert.equal(iconItemId("4306:12"), 4306);
  });
});
