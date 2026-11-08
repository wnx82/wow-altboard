import assert from "node:assert/strict";
import { test } from "node:test";
import { compareVersions, isOutdated } from "./versions";

test("les versions se comparent nombre par nombre, pas en texte", () => {
  assert.ok(compareVersions("0.4.1", "0.5.0")! < 0);
  assert.ok(compareVersions("0.10.0", "0.9.9")! > 0);
  assert.equal(compareVersions("1.2.3", "1.2.3"), 0);
  assert.equal(compareVersions("1.2.3+build.7", "1.2.3"), 0);
});

test("une préversion précède la version publiée", () => {
  assert.ok(compareVersions("0.5.0-beta.1", "0.5.0")! < 0);
  assert.ok(compareVersions("0.5.0", "0.5.0-rc.1")! > 0);
  assert.ok(compareVersions("0.5.0-beta.1", "0.5.0-beta.2")! < 0);
});

test("une version illisible ne se compare pas et ne passe jamais pour périmée", () => {
  assert.equal(compareVersions("dev", "0.5.0"), null);
  assert.equal(isOutdated("dev", "0.5.0"), false);
  assert.equal(isOutdated(null, "0.5.0"), false);
  assert.equal(isOutdated("0.4.1", null), false);
  assert.equal(isOutdated("0.4.1", "0.5.0"), true);
  assert.equal(isOutdated("0.5.0", "0.5.0"), false);
  assert.equal(isOutdated("0.6.0", "0.5.0"), false);
});
