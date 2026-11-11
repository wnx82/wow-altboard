import assert from "node:assert/strict";
import { describe, test } from "node:test";
import nextConfig from "../../../next.config";
import { accountArt, ART_HOST, ART_PATH, artwork, CHAMPION_ART, LOGIN_ART, type ArtKey } from "./art";

const PLACED: ArtKey[] = [LOGIN_ART, ...CHAMPION_ART, ...Array.from({ length: 12 }, (_, id) => accountArt(id + 1))];

describe("illustrations de WoW Forever", () => {
  test("toutes viennent du CDN de Blizzard autorisé par l'optimiseur d'images", () => {
    const allowed = (nextConfig.images?.remotePatterns ?? []).map((pattern) => (pattern instanceof URL ? pattern.href : ""));
    assert.ok(allowed.includes(`${ART_HOST}${ART_PATH}**`), "chemin des illustrations absent de remotePatterns");
    for (const key of PLACED) {
      const { src } = artwork(key);
      assert.ok(src.startsWith(`${ART_HOST}${ART_PATH}`), src);
      assert.match(src, /\.(png|jpe?g|webp)$/);
    }
  });

  test("un compte garde la même illustration, et six comptes en ont six différentes", () => {
    assert.equal(accountArt(42), accountArt(42));
    assert.equal(new Set([1, 2, 3, 4, 5, 6].map(accountArt)).size, 6);
  });

  test("une illustration par place du podium", () => {
    assert.equal(CHAMPION_ART.length, 3);
  });
});
