import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import * as t from "@/db/schema";
import { openTestDatabase, type TestDatabase } from "@/db/testing";
import { confirmPassword } from "./confirm-password";
import { hashPassword } from "./password";
import type { Session } from "./session";

const PASSWORD = "mot de passe de test";

let database: TestDatabase;
let session: Session;

before(async () => {
  database = await openTestDatabase();
  await database.reset();
  const [user] = await database.db
    .insert(t.adminUsers)
    .values({ email: "moi@exemple.test", passwordHash: await hashPassword(PASSWORD) })
    .returning();
  session = { userId: user.id, email: user.email };
});

after(async () => {
  await database.close();
});

describe("confirmation par mot de passe", () => {
  test("accepte le bon mot de passe, refuse un mot de passe absent ou faux", async () => {
    assert.equal(await confirmPassword(database.db, session, PASSWORD, "test.ok"), null);
    assert.equal(await confirmPassword(database.db, session, "", "test.ok"), "Saisissez votre mot de passe pour confirmer.");
    assert.equal(await confirmPassword(database.db, session, "x".repeat(1025), "test.ok"), "Saisissez votre mot de passe pour confirmer.");
    assert.equal(await confirmPassword(database.db, session, "faux", "test.ok"), "Mot de passe incorrect.");
  });

  test("bloque après cinq tentatives, action par action", async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      assert.equal(await confirmPassword(database.db, session, "faux", "test.limited"), "Mot de passe incorrect.");
    }
    // Même le bon mot de passe attend la fin de la fenêtre : on ne devine pas par essais successifs.
    assert.equal(await confirmPassword(database.db, session, PASSWORD, "test.limited"), "Trop de tentatives. Réessayez dans quelques minutes.");
    assert.equal(await confirmPassword(database.db, session, PASSWORD, "test.other"), null);
  });
});
