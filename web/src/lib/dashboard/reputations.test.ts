import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { compareReputations, OTHER_GROUP, standingProgress, type ReputationRow } from "./reputations";

const collator = new Intl.Collator("fr", { sensitivity: "base" });
const row = (character: string, factionId: number, name: string, groupName: string | null, reaction: number, currentValue: number): ReputationRow<string> => ({
  character,
  factionId,
  name,
  groupName,
  reaction,
  currentValue,
  minValue: 3_000,
  maxValue: 9_000,
});

describe("réputations comparées", () => {
  test("avancement dans le palier", () => {
    assert.equal(standingProgress({ currentValue: 6_000, minValue: 3_000, maxValue: 9_000 }), 0.5);
    assert.equal(standingProgress({ currentValue: 6_000, minValue: null, maxValue: 9_000 }), null);
  });

  test("groupes par nom, « Autres » en dernier ; personnages par palier puis avancement", () => {
    const groups = compareReputations(
      [
        row("Anna", 72, "Hurlevent", "Alliance", 5, 4_000),
        row("Bob", 72, "Hurlevent", "Alliance", 6, 9_500),
        row("Cid", 72, "Hurlevent", "Alliance", 5, 8_000),
        row("Anna", 47, "Forgefer", "Alliance", 4, 100),
        row("Anna", 59, "Confrérie du thorium", null, 4, 0),
      ],
      collator.compare,
    );
    assert.deepEqual(
      groups.map((group) => [group.name, group.factions.map((faction) => faction.name)]),
      [
        ["Alliance", ["Forgefer", "Hurlevent"]],
        [OTHER_GROUP, ["Confrérie du thorium"]],
      ],
    );
    assert.deepEqual(
      groups[0].factions[1].holders.map((holder) => holder.character),
      ["Bob", "Cid", "Anna"],
    );
  });
});
