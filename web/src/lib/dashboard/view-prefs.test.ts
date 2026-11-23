import assert from "node:assert/strict";
import { test } from "node:test";
import { COLLAPSED_COOKIE, parseCollapsed, parseView, prefCookie, readViewPrefs, VIEW_COOKIE } from "./view-prefs";

test("vue : seules « cards » et « table » sont reconnues", () => {
  assert.equal(parseView("table"), "table");
  assert.equal(parseView("cards"), "cards");
  assert.equal(parseView("grille"), null);
  assert.equal(parseView(undefined), null);
});

test("comptes repliés : identifiants entiers seulement, sans doublon", () => {
  assert.deepEqual(parseCollapsed("3,12,3"), ["3", "12"]);
  assert.deepEqual(parseCollapsed("3%2C7"), ["3", "7"]);
  assert.deepEqual(parseCollapsed("abc,-1,0,4"), ["4"]);
  // Cookie présent mais vide : aucun compte replié, ce n'est pas l'absence de préférence.
  assert.deepEqual(parseCollapsed(""), []);
  assert.equal(parseCollapsed(undefined), null);
});

test("lecture des deux cookies", () => {
  const jar: Record<string, string> = { [VIEW_COOKIE]: "table", [COLLAPSED_COOKIE]: "5" };
  assert.deepEqual(readViewPrefs((name) => jar[name]), { view: "table", collapsed: ["5"] });
  assert.deepEqual(readViewPrefs(() => undefined), { view: null, collapsed: null });
});

test("cookie écrit pour un an, sur tout le site, Secure en HTTPS", () => {
  assert.equal(prefCookie(VIEW_COOKIE, "table", false), "wab_view=table; Path=/; Max-Age=31536000; SameSite=Lax");
  assert.equal(prefCookie(COLLAPSED_COOKIE, "1,2", true), "wab_collapsed=1%2C2; Path=/; Max-Age=31536000; SameSite=Lax; Secure");
});
