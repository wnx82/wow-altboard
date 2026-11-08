import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { activeNav, isActiveLink, NAV_GROUPS } from "./navigation";

const DASHBOARD = path.resolve(import.meta.dirname, "../app/(dashboard)");
/** Dossiers du tableau de bord sans entrée propre dans le menu : l'accueil et la fiche d'un personnage. */
const NOT_IN_MENU = new Set(["(home)", "characters"]);

describe("navigation principale", () => {
  test("chaque page du tableau de bord figure une seule fois dans le menu", () => {
    const pages = readdirSync(DASHBOARD, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !NOT_IN_MENU.has(entry.name))
      .map((entry) => `/${entry.name}`);
    const links = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.href));

    assert.equal(new Set(links).size, links.length);
    assert.deepEqual([...links].sort(), ["/", ...pages].sort());
  });

  test("la page en cours et son groupe", () => {
    const at = (pathname: string) => {
      const found = activeNav(pathname);
      return found && [found.group.label, found.item.label];
    };
    assert.deepEqual(at("/"), ["Personnages", "Personnages"]);
    assert.deepEqual(at("/characters/12"), ["Personnages", "Personnages"]);
    assert.deepEqual(at("/market/item-190396"), ["Économie", "Marché"]);
    assert.deepEqual(at("/settings"), ["Gestion", "Paramètres"]);
    assert.equal(at("/login"), null);
  });

  test("un préfixe ne suffit pas : il faut un segment entier", () => {
    assert.equal(isActiveLink("/items", "/itemsets"), false);
    assert.equal(isActiveLink("/", "/charactersheet"), false);
    assert.equal(isActiveLink("/items", "/items"), true);
  });
});
