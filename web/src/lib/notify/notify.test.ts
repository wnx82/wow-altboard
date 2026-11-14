import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { eq } from "drizzle-orm";
import * as t from "@/db/schema";
import { openTestDatabase, type TestDatabase } from "@/db/testing";
import { createAgentToken } from "@/lib/agent-tokens";
import { setManualGoal } from "@/lib/goals/store";
import { processSync } from "@/lib/sync/process";
import type { SyncPayload } from "@/lib/sync/schema";
import { brusselsMidnight, MIN_DOWN_CHECKS } from "./collect";
import { maskUrl, parseSilentDays, parseToken, parseWebhookUrl, readNotifySettings, writeNotifySettings } from "./config";
import { deliver } from "./deliver";
import { levelEvent, silentMachines, weeklyEvent } from "./events";
import { notifyPass } from "./runtime";

describe("notifications : réglages et textes", () => {
  test("adresse du webhook : http(s) seulement, sans identifiants ni fragment ; vide pour retirer", () => {
    assert.deepEqual(parseWebhookUrl(" https://n8n.exemple/webhook/abc "), { ok: true, value: "https://n8n.exemple/webhook/abc" });
    assert.deepEqual(parseWebhookUrl("http://10.0.0.5:5678/webhook/x"), { ok: true, value: "http://10.0.0.5:5678/webhook/x" });
    assert.deepEqual(parseWebhookUrl(""), { ok: true, value: null });
    for (const bad of ["ftp://exemple/x", "https://user:pass@exemple/x", "https://exemple/x#y", "pas une adresse", "https://exemple/a b"]) {
      assert.equal(parseWebhookUrl(bad).ok, false, bad);
    }
    assert.equal(maskUrl("https://n8n.exemple:8443/webhook/secret"), "https://n8n.exemple:8443/…");
    assert.equal(maskUrl(null), null);
  });

  test("jeton et délai", () => {
    assert.deepEqual(parseToken(" abc-123 "), { ok: true, value: "abc-123" });
    for (const bad of ["", "a b", "é", "x".repeat(201)]) assert.equal(parseToken(bad).ok, false, bad);
    assert.deepEqual(parseSilentDays(""), { ok: true, value: 3 });
    assert.deepEqual(parseSilentDays("7"), { ok: true, value: 7 });
    for (const bad of ["0", "61", "2.5", "-1"]) assert.equal(parseSilentDays(bad).ok, false, bad);
  });

  test("PC muets : signalés une fois par silence, oubliés quand ils reviennent", () => {
    const now = new Date("2026-11-14T12:00:00Z");
    const old = new Date("2026-11-10T12:00:00Z");
    const machines = [
      { id: 1, label: "PC A", lastSeenAt: old },
      { id: 2, label: "PC B", lastSeenAt: new Date("2026-11-14T08:00:00Z") },
    ];
    const first = silentMachines(machines, {}, 3, now);
    assert.deepEqual(
      first.silent.map((machine) => [machine.label, machine.days]),
      [["PC A", 4]],
    );
    assert.deepEqual(silentMachines(machines, first.notified, 3, now).silent, []);
    // Le PC A a synchronisé puis s'est tu de nouveau : nouveau silence, nouveau signalement.
    const again = silentMachines([{ id: 1, label: "PC A", lastSeenAt: new Date("2026-11-10T13:00:00Z") }], first.notified, 3, now);
    assert.equal(again.silent.length, 1);
  });

  test("textes : niveau gagné et rapport hebdomadaire", () => {
    assert.equal(levelEvent({ id: 1, name: "Ada" }, 41, 42).text, "Ada atteint le niveau 42.");
    assert.equal(levelEvent({ id: 1, name: "Ada" }, 40, 42).text, "Ada atteint le niveau 42 (2 niveaux gagnés).");
    const report = weeklyEvent({
      week: "2026-11-02",
      levels: [{ name: "Ada", from: 10, to: 12 }],
      goldStart: 10_000,
      goldEnd: 35_000,
      playedSeconds: 5_400,
      sessions: 2,
      goals: [],
    });
    assert.equal(report.event, "report.weekly");
    assert.match(report.text, /^Semaine du 2 novembre : 2 niveaux gagnés \(Ada 10 → 12\) ; or : \+2 po 50 pa 0 pc \(total 3 po 50 pa 0 pc\) ; temps joué : .* en 2 sessions ; aucun objectif atteint\.$/);
  });

  test("minuit à Bruxelles, heure d'hiver comme d'été", () => {
    assert.equal(brusselsMidnight("2026-11-09").toISOString(), "2026-11-08T23:00:00.000Z");
    assert.equal(brusselsMidnight("2026-07-06").toISOString(), "2026-07-05T22:00:00.000Z");
  });
});

describe("notifications : envoi", () => {
  test("POST JSON avec le jeton, sans suivre de redirection ; un échec est rapporté, jamais levé", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const ok = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    const now = new Date("2026-11-14T12:00:00Z");
    assert.deepEqual(await deliver({ url: "https://n8n.exemple/w", token: "jeton" }, levelEvent({ id: 1, name: "Ada" }, 1, 2), now, ok), { ok: true, status: 200 });
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers.authorization, "Bearer jeton");
    assert.equal(calls[0].init.redirect, "error");
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
      source: "wow-altboard",
      event: "level.gained",
      at: now.toISOString(),
      text: "Ada atteint le niveau 2.",
      data: { characterId: 1, character: "Ada", from: 1, to: 2 },
    });

    const refused = (async () => new Response("non", { status: 403 })) as unknown as typeof fetch;
    assert.deepEqual(await deliver({ url: "https://n8n.exemple/w", token: null }, levelEvent({ id: 1, name: "Ada" }, 1, 2), now, refused), {
      ok: false,
      status: 403,
      error: "réponse HTTP 403",
    });
    const unreachable = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    assert.deepEqual(await deliver({ url: "https://n8n.exemple/w", token: null }, levelEvent({ id: 1, name: "Ada" }, 1, 2), now, unreachable), {
      ok: false,
      status: null,
      error: "webhook injoignable",
    });
  });
});

describe("notifications : passage en base", () => {
  const BASE: SyncPayload = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../../tests/fixtures/payloads/two-accounts.json"), "utf8"));
  // Samedi 14 novembre 2026, 13 h à Bruxelles.
  const NOW = new Date("2026-11-14T12:00:00Z");
  let database: TestDatabase;
  let sent: { event: string; text: string; data: Record<string, unknown> }[];
  const webhook = (async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  const pass = (now: Date) => notifyPass(database.db, now, webhook);
  const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

  before(async () => {
    database = await openTestDatabase();
  });
  after(async () => {
    await database.close();
  });
  beforeEach(async () => {
    await database.reset();
    sent = [];
    const { id } = await createAgentToken(database.db, "PC de test");
    await processSync(database.db, BASE, { tokenId: id, requestId: "test", now: new Date("2026-11-10T10:00:00Z") });
  });

  async function firstCharacter() {
    const [character] = await database.db.select({ id: t.characters.id, name: t.characters.name, level: t.characters.level }).from(t.characters).where(eq(t.characters.name, "Élodie Brisefer"));
    return character;
  }
  const snapshot = (characterId: number, capturedAt: Date, level: number) =>
    database.db.insert(t.characterSnapshots).values({ characterId, capturedAt, snapshotHash: `h${capturedAt.getTime()}`, level, data: {} });
  const check = (minutes: number, status: "up" | "down" | "degraded") =>
    database.db.insert(t.serverStatusChecks).values({ checkedAt: later(minutes), service: "game", status, outcome: status === "down" ? "timeout" : "open", targetsUp: status === "down" ? 0 : 1, targetsTotal: 1, source: "test" });

  test("premier passage : l'état prend les valeurs du moment, rien du passé n'est annoncé", async () => {
    const character = await firstCharacter();
    const [goal] = await database.db.insert(t.characterGoals).values({ characterId: character.id, position: 0, label: "Avant", kind: "manual", params: {} }).returning();
    await setManualGoal(database.db, goal.id, true, NOW);
    await writeNotifySettings(database.db, { url: "https://n8n.exemple/w" }, NOW);

    assert.deepEqual(await pass(NOW), { events: 0, sent: 0 });
    assert.deepEqual(await pass(later(1)), { events: 0, sent: 0 });
    // Le PC de la synchronisation du 10 novembre est muet depuis plus de 3 jours : déjà tenu pour signalé.
    assert.equal(sent.length, 0);
  });

  test("niveau gagné, objectif atteint, serveur revenu et PC muet, chacun une fois", async () => {
    // Sans le rapport hebdomadaire : le dernier passage tombe après le lundi suivant.
    await writeNotifySettings(database.db, { url: "https://n8n.exemple/w", token: "jeton", events: ["level", "goal", "server", "silent"] }, NOW);
    // PC vu à l'instant : il ne sera muet qu'après le délai.
    await database.db.update(t.machines).set({ lastSeenAt: NOW });
    await pass(NOW);
    const character = await firstCharacter();

    await snapshot(character.id, later(10), character.level! + 1);
    await snapshot(character.id, later(20), character.level! + 2);
    const [goal] = await database.db.insert(t.characterGoals).values({ characterId: character.id, position: 0, label: "Monter", kind: "manual", params: {} }).returning();
    await setManualGoal(database.db, goal.id, true, later(21));
    for (let index = 0; index < MIN_DOWN_CHECKS; index++) await check(22 + index, "down");
    await check(30, "up");

    await pass(later(31));
    assert.deepEqual(
      sent.map((event) => [event.event, event.text]),
      [
        ["level.gained", `${character.name} atteint le niveau ${character.level! + 2} (2 niveaux gagnés).`],
        ["goal.reached", `${character.name} a atteint son objectif « Monter ».`],
        ["server.online", "Le serveur de jeu répond de nouveau."],
      ],
    );
    assert.equal(sent[2].data.downSince, later(22).toISOString());

    sent = [];
    await pass(later(32));
    assert.equal(sent.length, 0, "rien de neuf");

    // Une coupure d'un seul contrôle n'est pas annoncée ; décocher puis recocher un objectif l'est de nouveau.
    await check(40, "down");
    await check(45, "up");
    await setManualGoal(database.db, goal.id, false, later(46));
    await setManualGoal(database.db, goal.id, true, later(47));
    // Quatre jours sans synchronisation : PC muet.
    await pass(new Date(NOW.getTime() + 4 * 24 * 3600_000));
    assert.deepEqual(
      sent.map((event) => event.event),
      ["goal.reached", "machine.silent"],
    );
    assert.match(sent[1].text, /n'a rien synchronisé depuis 4 jours\.$/);
  });

  test("sans webhook ou événement décoché : rien n'est envoyé, mais l'état avance", async () => {
    await pass(NOW);
    const character = await firstCharacter();
    await snapshot(character.id, later(10), character.level! + 1);
    await pass(later(11));
    assert.equal(sent.length, 0);

    await writeNotifySettings(database.db, { url: "https://n8n.exemple/w", events: ["goal"] }, NOW);
    assert.deepEqual((await readNotifySettings(database.db)).events, ["goal"]);
    await snapshot(character.id, later(20), character.level! + 2);
    await pass(later(21));
    assert.equal(sent.length, 0, "niveau décoché, et le niveau d'avant l'activation n'est pas rattrapé");
  });

  test("rapport hebdomadaire : le lundi à partir de 9 h, une seule fois, pour la semaine écoulée", async () => {
    await writeNotifySettings(database.db, { url: "https://n8n.exemple/w", events: ["weekly"] }, NOW);
    await pass(NOW);
    const character = await firstCharacter();
    await snapshot(character.id, new Date("2026-11-11T18:00:00Z"), character.level! + 1);
    await database.db.insert(t.characterSessions).values({ characterId: character.id, startedAt: new Date("2026-11-11T17:00:00Z"), durationSeconds: 3_600 });

    // Lundi 16 novembre, 8 h 30 à Bruxelles : trop tôt.
    await pass(new Date("2026-11-16T07:30:00Z"));
    assert.equal(sent.length, 0);
    // 9 h 05 : la semaine du 9 au 15 novembre part, une seule fois.
    await pass(new Date("2026-11-16T08:05:00Z"));
    await pass(new Date("2026-11-16T08:06:00Z"));
    assert.deepEqual(
      sent.map((event) => event.event),
      ["report.weekly"],
    );
    assert.equal(sent[0].data.week, "2026-11-09");
    assert.equal(sent[0].data.playedSeconds, 3_600);
    assert.deepEqual(sent[0].data.levels, [{ name: character.name, from: character.level, to: character.level! + 1 }]);
  });
});
