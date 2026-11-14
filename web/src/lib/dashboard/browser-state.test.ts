import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DEFAULT_STATE, homeHref, NO_FILTERS, readBrowserState, writeBrowserState, type BrowserState } from "./browser-state";

const read = (search: string) => readBrowserState(new URLSearchParams(search));

describe("état de la liste de l'accueil dans l'adresse", () => {
  test("une adresse sans paramètre donne l'état par défaut, et inversement", () => {
    assert.deepEqual(read(""), DEFAULT_STATE);
    assert.equal(writeBrowserState(DEFAULT_STATE), "");
  });

  test("aller-retour d'un état complet", () => {
    const state: BrowserState = {
      query: "élodie brise",
      filters: {
        account: "780",
        realm: "Soulseeker",
        classToken: "MAGE",
        race: "Gnome",
        faction: "Alliance",
        profession: "Couture",
        machine: "3",
        goals: "open",
        minLevel: "10",
        maxLevel: "60",
      },
      sort: { key: "money", descending: false },
      favoritesOnly: true,
    };
    const search = writeBrowserState(state);
    assert.match(search, /^\?/);
    assert.deepEqual(read(search), state);
  });

  test("paramètres lisibles, valeurs par défaut omises", () => {
    const search = writeBrowserState({
      ...DEFAULT_STATE,
      query: "zoé",
      favoritesOnly: true,
      filters: { ...NO_FILTERS, classToken: "PRIEST" },
      sort: { key: "name", descending: false },
    });
    const params = new URLSearchParams(search);
    assert.deepEqual([...params.keys()].sort(), ["classe", "favoris", "q", "tri"]);
    assert.equal(params.get("tri"), "nom");
    assert.equal(params.get("q"), "zoé");
  });

  test("le sens n'est écrit que s'il contredit le sens naturel du tri", () => {
    assert.equal(writeBrowserState({ ...DEFAULT_STATE, sort: { key: "level", descending: false } }), "?ordre=croissant");
    assert.equal(writeBrowserState({ ...DEFAULT_STATE, sort: { key: "name", descending: true } }), "?tri=nom&ordre=decroissant");
    assert.deepEqual(read("?tri=nom").sort, { key: "name", descending: false });
    assert.deepEqual(read("?tri=or").sort, { key: "money", descending: true });
  });

  test("une recherche faite d'espaces n'est pas écrite", () => {
    assert.equal(writeBrowserState({ ...DEFAULT_STATE, query: "   " }), "");
  });

  test("les valeurs illisibles sont ignorées", () => {
    const state = read("?compte=abc&pc=0&niveau-min=-5&niveau-max=1000&objectifs=bof&tri=inconnu&ordre=n%27importe&favoris=oui&royaume=%20");
    assert.deepEqual(state, DEFAULT_STATE);
    assert.equal(read(`?q=${"a".repeat(500)}`).query.length, 100);
  });

  test("les paramètres étrangers à la liste sont conservés", () => {
    assert.equal(writeBrowserState({ ...DEFAULT_STATE, favoritesOnly: true }, "?q=ancien&utm=x"), "?utm=x&favoris=1");
    assert.equal(writeBrowserState(DEFAULT_STATE, "utm=x&tri=nom"), "?utm=x");
  });

  test("liens vers l'accueil filtré, relus tels quels par la liste", () => {
    assert.equal(homeHref({}), "/");
    assert.equal(homeHref({ account: "780" }), "/?compte=780");
    const profession = homeHref({ profession: "Premiers soins" });
    assert.equal(profession, "/?metier=Premiers+soins");
    assert.equal(read(profession.slice(1)).filters.profession, "Premiers soins");
  });
});
