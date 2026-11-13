import assert from "node:assert/strict";
import { test } from "node:test";
import { SyncGate } from "./gate";

test("une place à la fois, rendue dans l'ordre d'arrivée", async () => {
  const gate = new SyncGate({ maxWaiting: 2, waitMs: 1_000 });
  const order: string[] = [];
  const first = await gate.acquire();
  const second = gate.acquire().then((release) => (order.push("second"), release));
  const third = gate.acquire().then((release) => (order.push("troisième"), release));
  assert.equal(gate.waiting, 2);

  first?.();
  (await second)?.();
  (await third)?.();

  assert.deepEqual(order, ["second", "troisième"]);
  assert.equal(gate.waiting, 0);
  // Libre à nouveau : la place est donnée tout de suite.
  assert.ok(await gate.acquire());
});

test("libérer deux fois ne donne pas deux places", async () => {
  const gate = new SyncGate({ maxWaiting: 2, waitMs: 1_000 });
  const first = await gate.acquire();
  const second = gate.acquire();
  const third = gate.acquire();
  first?.();
  first?.();

  const winner = await second;
  assert.ok(winner);
  assert.equal(gate.waiting, 1, "le troisième attend toujours");
  winner();
  assert.ok(await third);
});

test("file pleine ou attente trop longue : null, et la file se vide", async () => {
  const gate = new SyncGate({ maxWaiting: 1, waitMs: 30 });
  const held = await gate.acquire();
  const waiting = gate.acquire();
  assert.equal(await gate.acquire(), null, "file pleine");
  assert.equal(await waiting, null, "délai dépassé");
  assert.equal(gate.waiting, 0);
  held?.();
  assert.ok(await gate.acquire());
});
