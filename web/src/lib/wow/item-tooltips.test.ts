import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { eq } from "drizzle-orm";
import * as t from "@/db/schema";
import { openTestDatabase, type TestDatabase } from "@/db/testing";
import { fetchWowheadTooltip, getItemTooltip, resetTooltipFailures, tooltipKey, tooltipUrl } from "./item-tooltips";

const NOW = new Date("2026-11-13T10:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const later = (days: number) => new Date(NOW.getTime() + days * DAY);
const SWORD = '<table><tr><td><!--nstart--><b class="q2">Épée</b><!--nend--><span class="q"><br>Niveau d\'objet 16</span><br>+3 Esprit</td></tr></table>';

type Reply = { status: number; body?: string } | "throw";

function fakeWowhead(replies: Record<string, Reply>) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const reply = replies[url] ?? { status: 404, body: "{}" };
    if (reply === "throw") throw new TypeError("fetch failed");
    return new Response(reply.body ?? "", { status: reply.status });
  }) as typeof fetch;
  return { fetchImpl, calls };
}
const ok = (tooltip: string): Reply => ({ status: 200, body: JSON.stringify({ name: "x", quality: 2, icon: "inv", tooltip, spells: [] }) });

describe("bulles d'objets : clés", () => {
  test("objet, suffixe aléatoire, clé d'Auctionator ; ni mascotte ni clé illisible", () => {
    assert.deepEqual(tooltipKey("15210"), { key: "15210", itemId: 15210, suffix: null });
    assert.deepEqual(tooltipKey("15210:1017"), { key: "15210:1017", itemId: 15210, suffix: 1017 });
    assert.deepEqual(tooltipKey("15210:0"), { key: "15210", itemId: 15210, suffix: null });
    assert.deepEqual(tooltipKey("g:15210:60"), { key: "15210", itemId: 15210, suffix: null });
    for (const bad of ["p:42", "", "abc", "0", "99999999999", "1:2:3", "-5"]) assert.equal(tooltipKey(bad), null, bad);
  });

  test("adresse : WoW Forever en français, suffixe en rand", () => {
    assert.equal(tooltipUrl(19019, null), "https://nether.wowhead.com/tooltip/item/19019?dataEnv=16&locale=2");
    assert.equal(tooltipUrl(15210, 1017), "https://nether.wowhead.com/tooltip/item/15210?dataEnv=16&locale=2&rand=1017");
  });
});

describe("bulles d'objets : lecture chez Wowhead", () => {
  test("réponse lue en lignes ; 404 ou bulle vide : objet inconnu ; erreurs lisibles", async () => {
    const url = tooltipUrl(1, null);
    const read = (reply: Reply) => fetchWowheadTooltip(fakeWowhead({ [url]: reply }).fetchImpl, 1, null);
    const lines = await read(ok(SWORD));
    assert.ok(lines.ok && "lines" in lines);
    assert.deepEqual(lines.lines.length, 2);
    assert.deepEqual(await read({ status: 404 }), { ok: true, missing: true });
    assert.deepEqual(await read(ok("<b></b>")), { ok: true, missing: true });
    assert.deepEqual(await read({ status: 503 }), { ok: false, error: "Wowhead a répondu 503." });
    assert.deepEqual(await read({ status: 200, body: "<html>" }), { ok: false, error: "Réponse de Wowhead illisible." });
    assert.deepEqual(await read({ status: 200, body: '{"error":"x"}' }), { ok: false, error: "Réponse de Wowhead inattendue." });
    assert.deepEqual(await read("throw"), { ok: false, error: "Wowhead injoignable." });
  });
});

let database: TestDatabase;

before(async () => {
  database = await openTestDatabase();
});

after(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.reset();
  resetTooltipFailures();
});

describe("bulles d'objets : cache en base", () => {
  test("lue une fois, puis servie depuis la base pendant trente jours, relue ensuite", async () => {
    const url = tooltipUrl(15210, 1017);
    const wowhead = fakeWowhead({ [url]: ok(SWORD) });
    const first = await getItemTooltip(database.db, "15210:1017", { now: NOW, fetch: wowhead.fetchImpl });
    assert.equal(first.status, "ok");
    assert.equal(first.status === "ok" && first.lines.length, 2);
    const [row] = await database.db.select().from(t.itemTooltips).where(eq(t.itemTooltips.itemKey, "15210:1017"));
    assert.equal(row.status, "ok");

    await getItemTooltip(database.db, "15210:1017", { now: later(29), fetch: wowhead.fetchImpl });
    assert.deepEqual(wowhead.calls, [url]);
    await getItemTooltip(database.db, "15210:1017", { now: later(31), fetch: wowhead.fetchImpl });
    assert.deepEqual(wowhead.calls, [url, url]);
  });

  test("deux demandes simultanées : une seule lecture", async () => {
    const wowhead = fakeWowhead({ [tooltipUrl(2589, null)]: ok(SWORD) });
    const both = await Promise.all([
      getItemTooltip(database.db, "2589", { now: NOW, fetch: wowhead.fetchImpl }),
      getItemTooltip(database.db, "2589", { now: NOW, fetch: wowhead.fetchImpl }),
    ]);
    assert.deepEqual(both.map((tooltip) => tooltip.status), ["ok", "ok"]);
    assert.equal(wowhead.calls.length, 1);
  });

  test("objet inconnu de Wowhead : noté, redemandé après trois jours", async () => {
    const wowhead = fakeWowhead({});
    assert.equal((await getItemTooltip(database.db, "999", { now: NOW, fetch: wowhead.fetchImpl })).status, "missing");
    assert.equal((await getItemTooltip(database.db, "999", { now: later(2), fetch: wowhead.fetchImpl })).status, "missing");
    assert.equal(wowhead.calls.length, 1);
    await getItemTooltip(database.db, "999", { now: later(4), fetch: wowhead.fetchImpl });
    assert.equal(wowhead.calls.length, 2);
  });

  test("Wowhead injoignable : bulle gardée même ancienne, sinon indisponible et pas de nouvel essai avant cinq minutes", async () => {
    const url = tooltipUrl(117, null);
    await getItemTooltip(database.db, "117", { now: NOW, fetch: fakeWowhead({ [url]: ok(SWORD) }).fetchImpl });
    const down = fakeWowhead({ [url]: "throw", [tooltipUrl(118, null)]: "throw" });
    const stale = await getItemTooltip(database.db, "117", { now: later(40), fetch: down.fetchImpl });
    assert.equal(stale.status, "ok");

    assert.deepEqual(await getItemTooltip(database.db, "118", { now: NOW, fetch: down.fetchImpl }), { status: "unavailable" });
    const calls = down.calls.length;
    await getItemTooltip(database.db, "118", { now: new Date(NOW.getTime() + 60_000), fetch: down.fetchImpl });
    assert.equal(down.calls.length, calls);
    await getItemTooltip(database.db, "118", { now: new Date(NOW.getTime() + 6 * 60_000), fetch: down.fetchImpl });
    assert.equal(down.calls.length, calls + 1);
  });

  test("objet disparu de Wowhead : l'ancienne bulle reste", async () => {
    const url = tooltipUrl(4306, null);
    await getItemTooltip(database.db, "4306", { now: NOW, fetch: fakeWowhead({ [url]: ok(SWORD) }).fetchImpl });
    const gone = await getItemTooltip(database.db, "4306", { now: later(31), fetch: fakeWowhead({}).fetchImpl });
    assert.equal(gone.status, "ok");
    const [row] = await database.db.select().from(t.itemTooltips).where(eq(t.itemTooltips.itemKey, "4306"));
    assert.equal(row.status, "ok");
    assert.equal(row.fetchedAt.getTime(), later(31).getTime());
  });

  test("mascotte ou clé illisible : rien n'est demandé", async () => {
    const wowhead = fakeWowhead({});
    assert.deepEqual(await getItemTooltip(database.db, "p:42", { now: NOW, fetch: wowhead.fetchImpl }), { status: "unavailable" });
    assert.equal(wowhead.calls.length, 0);
  });
});
