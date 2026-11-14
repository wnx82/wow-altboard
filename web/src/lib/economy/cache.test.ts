import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { cachedEconomy, ECONOMY_CACHE_TTL_MS, invalidateEconomyCache } from "./cache";

describe("contexte de l'économie gardé en mémoire", () => {
  beforeEach(() => invalidateEconomyCache());

  test("même clé : un seul calcul, partagé par les appels simultanés", async () => {
    let calls = 0;
    const load = async () => ({ value: ++calls });
    const [a, b] = await Promise.all([cachedEconomy("k", load, 0), cachedEconomy("k", load, 0)]);
    assert.equal(a, b);
    assert.equal(calls, 1);
    assert.equal(await cachedEconomy("autre", load, 0).then((v) => v.value), 2);
  });

  test("expiration après dix minutes, invalidation immédiate", async () => {
    let calls = 0;
    const load = async () => ++calls;
    await cachedEconomy("k", load, 0);
    assert.equal(await cachedEconomy("k", load, ECONOMY_CACHE_TTL_MS - 1), 1);
    assert.equal(await cachedEconomy("k", load, ECONOMY_CACHE_TTL_MS), 2);
    invalidateEconomyCache();
    assert.equal(await cachedEconomy("k", load, ECONOMY_CACHE_TTL_MS), 3);
  });

  test("un calcul en échec n'est pas gardé", async () => {
    await assert.rejects(cachedEconomy("k", async () => Promise.reject(new Error("base indisponible")), 0));
    assert.equal(await cachedEconomy("k", async () => "ok", 0), "ok");
  });

  test("huit contextes au plus : le moins récemment servi part", async () => {
    let calls = 0;
    const load = async () => ++calls;
    for (let index = 0; index < 8; index++) await cachedEconomy(`m${index}`, load, 0);
    await cachedEconomy("m0", load, 0);
    await cachedEconomy("m8", load, 0);
    assert.equal(calls, 9);
    await cachedEconomy("m0", load, 0);
    assert.equal(calls, 9, "m0, servi récemment, est resté");
    await cachedEconomy("m1", load, 0);
    assert.equal(calls, 10, "m1, le plus ancien, est parti");
  });
});
