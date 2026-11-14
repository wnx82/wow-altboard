import assert from "node:assert/strict";
import { inspect } from "node:util";
import { describe, test } from "node:test";
import { DrizzleQueryError } from "drizzle-orm";
import { installLogRedaction, MASKED_PARAMS, redactQueryError } from "./log-redaction";

const SECRET = "joueur@example.invalid";

describe("journal du serveur : paramètres des requêtes masqués", () => {
  test("message, pile et propriété params d'une DrizzleQueryError", () => {
    const cause = Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
    const error = new DrizzleQueryError('select "id" from "admin_users" where "email" = $1', [SECRET], cause);
    assert.ok(inspect(error).includes(SECRET), "sans masque, le paramètre est écrit");

    redactQueryError(error);
    const written = inspect(error);
    assert.ok(!written.includes(SECRET));
    assert.ok(written.includes('where "email" = $1'), "le SQL reste");
    assert.ok(written.includes(MASKED_PARAMS));
    assert.ok(written.includes("23505"), "la cause reste lisible");
  });

  test("erreur enveloppée, autres valeurs laissées telles quelles", () => {
    const inner = new DrizzleQueryError("select 1 where $1", [SECRET]);
    const outer = new Error("rendu impossible", { cause: inner });
    redactQueryError(outer);
    assert.ok(!inspect(outer).includes(SECRET));
    assert.equal(redactQueryError("texte"), "texte");
    const plain = new Error("Failed query: sans paramètres");
    assert.equal(redactQueryError(plain).message, "Failed query: sans paramètres");
  });

  test("console filtrée : ce qui est écrit ne contient plus le paramètre", () => {
    const written: unknown[][] = [];
    const sink = { error: (...args: unknown[]) => written.push(args), warn: (...args: unknown[]) => written.push(args) };
    installLogRedaction(sink);
    sink.error("Erreur :", new DrizzleQueryError("select $1", [SECRET]));
    sink.warn(new DrizzleQueryError("select $1", [SECRET]));
    assert.equal(written.length, 2);
    assert.ok(!inspect(written).includes(SECRET));
  });
});
