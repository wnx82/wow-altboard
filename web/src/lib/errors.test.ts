import assert from "node:assert/strict";
import { test } from "node:test";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { describeError, sqlState } from "./errors";

const pgError = (message: string, fields: Record<string, unknown>) => Object.assign(new Error(message), fields);

test("requête en échec : type, code SQLSTATE et contrainte, jamais le SQL ni les paramètres", () => {
  const error = new DrizzleQueryError(
    "insert into machines (hostname) values ($1)",
    ["PC-SECRET"],
    pgError('duplicate key value violates unique constraint "machines_uuid_unique"', { code: "23505", constraint: "machines_uuid_unique", detail: "Key (uuid)=(PC-SECRET)" }),
  );

  const text = describeError(error);

  assert.equal(text, "DrizzleQueryError 23505 (machines_uuid_unique)");
  assert.ok(!text.includes("PC-SECRET") && !text.includes("insert"));
});

test("une valeur reçue citée par PostgreSQL ou par JavaScript n'est pas reprise", () => {
  const cast = new DrizzleQueryError("select $1::int", ["abc"], pgError('invalid input syntax for type integer: "abc"', { code: "22P02" }));
  assert.equal(describeError(cast), "DrizzleQueryError 22P02");
  assert.equal(describeError(new SyntaxError("Cannot convert abc to a BigInt")), "SyntaxError");
  assert.equal(describeError(new TypeError("Cannot read properties of undefined (reading 'level')")), "TypeError");
});

test("base injoignable : le code réseau, y compris dans un AggregateError", () => {
  const refused = pgError("connect ECONNREFUSED 10.0.0.15:5432", { code: "ECONNREFUSED" });
  assert.equal(describeError(new DrizzleQueryError("select 1", [], refused)), "DrizzleQueryError ECONNREFUSED");
  assert.equal(describeError(new AggregateError([refused], "connexions refusées")), "AggregateError ECONNREFUSED");
});

test("un code ou une contrainte qui ne ressemblent à rien de connu sont ignorés", () => {
  assert.equal(describeError(pgError("x", { code: "valeur envoyée", constraint: "x" })), "Error");
  assert.equal(describeError(pgError("x", { code: "23505", constraint: "Robert'); drop table" })), "Error 23505");
  assert.equal(describeError("texte levé"), "erreur inconnue");
  assert.equal(describeError(undefined), "erreur inconnue");
});

test("code SQLSTATE d'une erreur ou de ses causes, null sinon", () => {
  const busy = new DrizzleQueryError("select pg_advisory_xact_lock($1)", [1], pgError("canceling statement due to lock timeout", { code: "55P03" }));
  assert.equal(sqlState(busy), "55P03");
  assert.equal(sqlState(pgError("x", { code: "57014" })), "57014");
  assert.equal(sqlState(pgError("x", { code: "ECONNREFUSED" })), null);
  assert.equal(sqlState(new Error("sans code")), null);
  assert.equal(sqlState("texte levé"), null);
});
