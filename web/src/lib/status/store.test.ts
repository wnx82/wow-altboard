import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { serverStatusChecks } from "@/db/schema";
import { countRows, openTestDatabase, type TestDatabase } from "@/db/testing";
import { loadStatusConfig, type ServiceKey } from "./config";
import type { CheckRecord } from "./monitor";
import type { Outcome, Status } from "./status";
import { hourlyBuckets, lastAnswers, latestChecks, listTransitions, pruneChecks, recordChecks } from "./store";
import { getServerStatusView, getServiceSummaries } from "./view";

const CONFIG = loadStatusConfig({ WOW_STATUS_AUTH_TARGETS: "login.example.test:1119", WOW_STATUS_GAME_TARGETS: "192.0.2.10:3724" });
const CAP_MS = CONFIG.staleAfterMs;

const OUTCOMES: Record<Status, Outcome> = { up: "ok", degraded: "slow", down: "timeout", unknown: "dns" };

/** Un contrôle à l'heure donnée (UTC, le 8 octobre 2026). */
function check(service: ServiceKey, time: string, status: Status, latencyMs: number | null = status === "up" ? 30 : null): CheckRecord {
  const answering = status === "up" || status === "degraded";
  return {
    service,
    checkedAt: new Date(`2026-10-08T${time}Z`),
    status,
    outcome: OUTCOMES[status],
    latencyMs: status === "degraded" ? 650 : latencyMs,
    targetsUp: answering ? 1 : 0,
    targetsTotal: 1,
    source: "tcp",
    error: status === "unknown" ? "ENOTFOUND" : null,
  };
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

describe("historique des contrôles", () => {
  test("base vide : aucune erreur, aucune donnée", async () => {
    const now = new Date("2026-10-08T12:00:00Z");

    assert.deepEqual(await latestChecks(database.db), []);
    assert.deepEqual(await lastAnswers(database.db), []);
    assert.deepEqual(await hourlyBuckets(database.db, new Date(0), now, CAP_MS), []);
    assert.deepEqual(await listTransitions(database.db, new Date(0), 10), []);
    await recordChecks(database.db, []);
    assert.equal(await countRows(database.db, serverStatusChecks), 0);
  });

  test("dernier contrôle et dernière réponse de chaque service", async () => {
    await recordChecks(database.db, [
      check("auth", "10:00:00", "up", 30),
      check("auth", "10:01:00", "up", 34),
      check("auth", "10:02:00", "down"),
      check("game", "10:00:00", "unknown"),
    ]);

    const latest = await latestChecks(database.db);
    assert.deepEqual(
      latest.map((row) => [row.service, row.checkedAt.toISOString(), row.status, row.outcome, row.latencyMs, row.targetsUp, row.targetsTotal, row.error]),
      [
        ["auth", "2026-10-08T10:02:00.000Z", "down", "timeout", null, 0, 1, null],
        ["game", "2026-10-08T10:00:00.000Z", "unknown", "dns", null, 0, 1, "ENOTFOUND"],
      ],
    );
    // La dernière mesure valide survit à la panne ; un service jamais joint n'en a pas.
    assert.deepEqual(
      (await lastAnswers(database.db)).map((row) => [row.service, row.checkedAt.toISOString(), row.latencyMs]),
      [["auth", "2026-10-08T10:01:00.000Z", 34]],
    );
  });

  test("les valeurs hors du modèle sont refusées par la base", async () => {
    await assert.rejects(recordChecks(database.db, [{ ...check("auth", "10:00:00", "up"), status: "maintenance" as Status }]));
    await assert.rejects(recordChecks(database.db, [{ ...check("auth", "10:00:00", "up"), service: "chat" as ServiceKey }]));
    await assert.rejects(recordChecks(database.db, [{ ...check("auth", "10:00:00", "up"), targetsUp: 2 }]));
    assert.equal(await countRows(database.db, serverStatusChecks), 0);
  });

  test("la purge ne retire que les contrôles antérieurs à la limite", async () => {
    await recordChecks(database.db, [check("auth", "09:00:00", "up"), check("auth", "10:00:00", "up"), check("game", "09:30:00", "down")]);

    assert.equal(await pruneChecks(database.db, new Date("2026-10-08T10:00:00Z")), 2);
    assert.deepEqual(
      (await latestChecks(database.db)).map((row) => [row.service, row.checkedAt.toISOString()]),
      [["auth", "2026-10-08T10:00:00.000Z"]],
    );
  });

  test("les durées sont pondérées par le temps écoulé jusqu'au contrôle suivant", async () => {
    await recordChecks(database.db, [
      check("auth", "10:00:00", "up"),
      check("auth", "10:01:00", "up"),
      check("auth", "10:02:00", "down"),
      // Pendant une panne les contrôles s'espacent : ces quatre minutes restent de la panne.
      check("auth", "10:06:00", "down"),
      check("auth", "10:07:00", "degraded"),
      check("auth", "10:08:00", "unknown"),
      check("auth", "10:09:00", "up"),
    ]);

    const buckets = await hourlyBuckets(database.db, new Date("2026-10-08T00:00:00Z"), new Date("2026-10-08T10:09:30Z"), CAP_MS);

    assert.deepEqual(buckets, [
      {
        service: "auth",
        hour: new Date("2026-10-08T10:00:00Z"),
        // 10:00, 10:01 et 10:07 pour une minute chacun, 10:09 pour trente secondes.
        availableSeconds: 210,
        degradedSeconds: 60,
        // 10:02 → 10:06 → 10:07. La minute « inconnu » n'est comptée nulle part.
        downSeconds: 300,
      },
    ]);
  });

  test("un trou de mesure n'est pas compté au-delà de la durée de validité d'un contrôle", async () => {
    await recordChecks(database.db, [check("game", "08:00:00", "up"), check("game", "10:00:00", "up"), check("auth", "08:10:00", "down")]);

    const buckets = await hourlyBuckets(database.db, new Date("2026-10-08T00:00:00Z"), new Date("2026-10-08T10:00:20Z"), CAP_MS);

    assert.deepEqual(
      buckets.map((bucket) => [bucket.service, bucket.hour.toISOString(), bucket.availableSeconds, bucket.downSeconds]),
      [
        // Dernier contrôle du service : il vaut jusqu'à maintenant, plafonné lui aussi.
        ["auth", "2026-10-08T08:00:00.000Z", 0, CAP_MS / 1000],
        ["game", "2026-10-08T08:00:00.000Z", CAP_MS / 1000, 0],
        ["game", "2026-10-08T10:00:00.000Z", 20, 0],
      ],
    );
    // Les contrôles antérieurs à la fenêtre n'y entrent pas.
    assert.equal((await hourlyBuckets(database.db, new Date("2026-10-08T09:00:00Z"), new Date("2026-10-08T10:00:20Z"), CAP_MS)).length, 1);
  });

  test("les changements de statut sont listés du plus récent au plus ancien, par service", async () => {
    await recordChecks(database.db, [
      check("auth", "10:00:00", "up"),
      check("auth", "10:01:00", "up"),
      check("auth", "10:02:00", "down"),
      check("auth", "10:03:00", "down"),
      check("auth", "10:04:00", "up", 41),
      check("game", "10:00:00", "down"),
      check("game", "10:01:00", "down"),
      check("game", "10:03:30", "unknown"),
    ]);

    const transitions = await listTransitions(database.db, new Date("2026-10-08T00:00:00Z"), 10);

    assert.deepEqual(
      transitions.map((row) => [row.service, row.checkedAt.toISOString(), row.previous, row.status, row.outcome, row.latencyMs]),
      [
        ["auth", "2026-10-08T10:04:00.000Z", "down", "up", "ok", 41],
        ["game", "2026-10-08T10:03:30.000Z", "down", "unknown", "dns", null],
        ["auth", "2026-10-08T10:02:00.000Z", "up", "down", "timeout", null],
      ],
    );
    assert.equal((await listTransitions(database.db, new Date("2026-10-08T00:00:00Z"), 1)).length, 1);
    // Le premier contrôle de la fenêtre n'est pas un changement : son précédent est hors champ.
    const recent = await listTransitions(database.db, new Date("2026-10-08T10:03:00Z"), 10);
    assert.deepEqual(recent.map((row) => row.service), ["auth"]);
  });
});

describe("vue de la page", () => {
  test("statut présent, dernière mesure valide, disponibilité et changements, en six requêtes", async () => {
    await recordChecks(database.db, [
      check("auth", "11:57:00", "up", 28),
      check("auth", "11:58:00", "up", 31),
      check("auth", "11:59:00", "down"),
      check("game", "11:58:00", "up", 22),
      check("game", "11:59:00", "up", 24),
    ]);
    let queries = 0;
    const original = database.pool.query.bind(database.pool);
    (database.pool as { query: unknown }).query = (...args: unknown[]) => {
      queries++;
      return (original as (...a: unknown[]) => unknown)(...args);
    };

    const view = await getServerStatusView(database.db, CONFIG, new Date("2026-10-08T11:59:30Z"));
    (database.pool as { query: unknown }).query = original;

    // Dernier contrôle et dernière réponse : une lecture indexée par service (deux services).
    assert.equal(queries, 6);
    assert.equal(view.configured, true);
    assert.equal(view.hasHistory, true);
    assert.deepEqual(
      view.services.map((service) => [service.service, service.status, service.latencyMs, service.checkedAt, service.stale, service.lastAnswer]),
      [
        ["auth", "down", null, "2026-10-08T11:59:00.000Z", false, { at: "2026-10-08T11:58:00.000Z", latencyMs: 31 }],
        ["game", "up", 24, "2026-10-08T11:59:00.000Z", false, null],
      ],
    );
    assert.match(view.services[0].detail, /Aucune réponse en 3 s/);
    assert.deepEqual(
      view.transitions.map((transition) => [transition.label, transition.from, transition.to]),
      [["Authentification Blizzard", "up", "down"]],
    );
    // Deux minutes et demie mesurées : pas de pourcentage.
    assert.deepEqual(
      view.history[0].availability.map((availability) => [availability.window, availability.percent, availability.measuredSeconds, availability.downSeconds]),
      [
        ["24h", null, 150, 30],
        ["7d", null, 150, 30],
      ],
    );
    assert.equal(view.history[0].hours.at(-1)!.status, "down");
    assert.equal(view.history[1].hours.at(-1)!.status, "up");
  });

  test("mesures périmées : l'état redevient inconnu, la dernière mesure valide reste affichée", async () => {
    await recordChecks(database.db, [check("auth", "10:00:00", "up", 30), check("game", "10:00:00", "down")]);

    // Quinze minutes plus tard, à la limite de validité.
    const fresh = await getServerStatusView(database.db, CONFIG, new Date("2026-10-08T10:15:00Z"));
    assert.deepEqual(fresh.services.map((service) => [service.status, service.stale]), [["up", false], ["down", false]]);

    const stale = await getServerStatusView(database.db, CONFIG, new Date("2026-10-08T10:15:01Z"));
    assert.deepEqual(
      stale.services.map((service) => [service.status, service.stale, service.latencyMs, service.lastAnswer?.latencyMs ?? null]),
      [
        ["unknown", true, null, 30],
        ["unknown", true, null, null],
      ],
    );
    assert.match(stale.services[0].detail, /trop ancien/);
  });

  test("sans adresse configurée : état inconnu, sans mesure inventée", async () => {
    const view = await getServerStatusView(database.db, loadStatusConfig({}), new Date("2026-10-08T12:00:00Z"));

    assert.equal(view.configured, false);
    assert.equal(view.hasHistory, false);
    assert.deepEqual(
      view.services.map((service) => [service.status, service.detail, service.latencyMs, service.checkedAt, service.targets]),
      [
        ["unknown", "Aucune adresse configurée", null, null, 0],
        ["unknown", "Aucune adresse configurée", null, null, 0],
      ],
    );
    assert.deepEqual(view.transitions, []);
    assert.ok(view.history.every((history) => history.availability.every((availability) => availability.percent === null)));
  });

  test("adresse configurée mais jamais contrôlée : absence de données, pas une panne", async () => {
    await recordChecks(database.db, [check("game", "11:59:00", "up", 24)]);

    const view = await getServerStatusView(database.db, CONFIG, new Date("2026-10-08T11:59:30Z"));

    assert.deepEqual([view.services[0].status, view.services[0].detail], ["unknown", "Aucun contrôle enregistré pour l'instant"]);
    assert.equal(view.services[1].status, "up");
  });

  test("miniatures de l'accueil : état présent et 24 dernières heures, en cinq requêtes", async () => {
    await recordChecks(database.db, [
      // Hors de la fenêtre de 24 heures : ni compté ni affiché.
      { ...check("game", "00:00:00", "down"), checkedAt: new Date("2026-10-07T10:00:00Z") },
      check("auth", "11:00:00", "up", 28),
      check("auth", "11:15:00", "up", 29),
      check("auth", "11:30:00", "up", 27),
      check("auth", "11:45:00", "down"),
      check("auth", "11:50:00", "up", 31),
      check("game", "11:58:00", "up", 22),
    ]);
    let queries = 0;
    const original = database.pool.query.bind(database.pool);
    (database.pool as { query: unknown }).query = (...args: unknown[]) => {
      queries++;
      return (original as (...a: unknown[]) => unknown)(...args);
    };

    const summaries = await getServiceSummaries(database.db, CONFIG, new Date("2026-10-08T11:59:30Z"));
    (database.pool as { query: unknown }).query = original;

    assert.equal(queries, 5);
    assert.deepEqual(
      summaries.map((summary) => [summary.service, summary.status, summary.latencyMs, summary.hours.length, summary.hours.at(-1)!.status]),
      [
        ["auth", "up", 31, 24, "down"],
        ["game", "up", 22, 24, "up"],
      ],
    );
    // Contrôles espacés au plus de quinze minutes : 45 min en ligne, 5 min en panne, 9 min 30 s en ligne.
    assert.deepEqual(summaries[0].availability, { window: "24h", percent: (3_270 / 3_570) * 100, measuredSeconds: 3_570, downSeconds: 300 });
    assert.deepEqual([summaries[1].availability.percent, summaries[1].availability.downSeconds], [null, 0]);
    assert.ok(summaries[1].hours.slice(0, -1).every((cell) => cell.status === null));
  });
});
