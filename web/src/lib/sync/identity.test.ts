import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { repairIdentity, withKnownIdentity, type KnownIdentity } from "./identity";
import type { CharacterPayload } from "./schema";

const base = (fields: Partial<CharacterPayload> = {}): CharacterPayload =>
  ({
    guid: "Player-6855-00667145",
    name: "Aekiss Valtharion",
    realm: "CAMWOWEU5Realm1PvE",
    lastSeen: 1795746263,
    level: 48,
    xp: 3019,
    xpMax: 135100,
    restedXp: 9370,
    guild: "Paradoxe",
    hidden: false,
    gear: [],
    professions: [],
    reputations: [],
    currencies: [],
    ...fields,
  }) as CharacterPayload;

const playtime = (current: number | undefined, completed: number[]): NonNullable<CharacterPayload["playtime"]> => ({
  totalSeconds: 875_000,
  ...(current === undefined ? {} : { current: { level: current } }),
  levels: completed.map((level) => ({ level, playedSeconds: 3600 })),
});

describe("identité relevée trop tôt par AltBoard", () => {
  test("un relevé cohérent est gardé tel quel", () => {
    const character = base({ playtime: playtime(48, [46, 47]) });

    const repaired = repairIdentity(character);

    assert.equal(repaired.unreliable, false);
    assert.equal(repaired.character, character);
  });

  test("le niveau en cours d'Allemano Ledger remplace un niveau d'AltBoard en retard", () => {
    const repaired = repairIdentity(base({ xp: 0, xpMax: 0, restedXp: undefined, guild: undefined, playtime: playtime(49, [47, 48]) }));

    assert.equal(repaired.unreliable, true);
    assert.deepEqual([repaired.character.level, repaired.character.xp, repaired.character.xpMax], [49, undefined, undefined]);
  });

  test("sans niveau en cours, le dernier niveau terminé d'Allemano Ledger compte", () => {
    const repaired = repairIdentity(base({ playtime: playtime(undefined, [47, 48]) }));

    assert.equal(repaired.unreliable, true);
    assert.equal(repaired.character.level, 49);
    assert.equal(repaired.character.xp, undefined);
  });

  test("un niveau d'Allemano Ledger plus bas ne fait jamais redescendre le personnage", () => {
    const repaired = repairIdentity(base({ level: 50, playtime: playtime(48, [47]) }));

    assert.equal(repaired.unreliable, false);
    assert.equal(repaired.character.level, 50);
  });

  test("une expérience 0 / 0 devient inconnue, même sans Allemano Ledger", () => {
    const repaired = repairIdentity(base({ level: 10, xp: 0, xpMax: 0 }));

    assert.equal(repaired.unreliable, true);
    assert.deepEqual([repaired.character.level, repaired.character.xp, repaired.character.xpMax], [10, undefined, undefined]);
  });

  test("une expérience nulle en début de niveau reste une vraie valeur", () => {
    const repaired = repairIdentity(base({ xp: 0 }));

    assert.equal(repaired.unreliable, false);
    assert.equal(repaired.character.xp, 0);
  });
});

describe("relevé non fiable complété par l'état connu", () => {
  const known: KnownIdentity = { level: 48, xp: 3019, xpMax: 135100, restedXp: 9370, guild: "Paradoxe" };

  test("la guilde et l'expérience reposée connues restent ; l'expérience d'un autre niveau non", () => {
    const { character } = repairIdentity(base({ xp: 0, xpMax: 0, restedXp: undefined, guild: undefined, playtime: playtime(49, [48]) }));

    const completed = withKnownIdentity(character, known);

    assert.deepEqual(
      [completed.level, completed.xp, completed.xpMax, completed.restedXp, completed.guild],
      [49, undefined, undefined, 9370, "Paradoxe"],
    );
  });

  test("au même niveau, l'expérience connue remplace un 0 / 0", () => {
    const { character } = repairIdentity(base({ xp: 0, xpMax: 0, guild: undefined }));

    const completed = withKnownIdentity(character, known);

    assert.deepEqual([completed.level, completed.xp, completed.xpMax, completed.guild], [48, 3019, 135100, "Paradoxe"]);
  });

  test("une valeur présente dans le relevé est gardée", () => {
    const { character } = repairIdentity(base({ xp: 0, xpMax: 0, guild: "Nouvelle Guilde", restedXp: 12 }));

    const completed = withKnownIdentity(character, known);

    assert.deepEqual([completed.guild, completed.restedXp], ["Nouvelle Guilde", 12]);
  });

  test("une expérience connue de 0 / 0 n'est jamais reprise", () => {
    const { character } = repairIdentity(base({ xp: 0, xpMax: 0 }));

    const completed = withKnownIdentity(character, { ...known, xp: 0, xpMax: 0 });

    assert.deepEqual([completed.xp, completed.xpMax], [undefined, undefined]);
  });
});
