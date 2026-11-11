// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  ARCHETYPES,
  ARCHETYPE_NAMES,
  POKE_MIN_RANGE,
  RANGE_CLASSES,
  RANGE_THRESHOLDS,
  buildAbilities,
  classifyAbilityText,
  classifyRange,
  cooldownAtMiddleRank,
  validateCurated,
} from "../../../scripts/game-data/lib/ability-archetypes.mjs";
import type { CuratedInput, KitsInput } from "../../../scripts/game-data/lib/ability-archetypes.mjs";

const rules = (description: string, range: number[] = [600]) => classifyAbilityText({ description, range });

describe("vocabulary", () => {
  it("is the closed list of twelve archetypes, each with a one-line definition", () => {
    expect(ARCHETYPE_NAMES).toEqual([
      "ally_shield",
      "ally_heal",
      "self_shield",
      "self_heal",
      "dash",
      "engage",
      "hard_cc",
      "poke",
      "execute",
      "stealth",
      "untargetable",
      "global",
    ]);
    for (const name of ARCHETYPE_NAMES) expect(ARCHETYPES[name].length).toBeGreaterThan(10);
  });
});

describe("classifyAbilityText", () => {
  it("gives ally_shield for a shield on an ally", () => {
    expect(rules("Shields an allied champion from incoming damage.")).toEqual(["ally_shield"]);
    expect(rules("Grants Annie or an ally a shield.")).toContain("ally_shield");
  });

  it("gives self_shield, not ally_shield, for an ability that shields herself", () => {
    expect(rules("Ambessa gains a shield and braces herself.")).toEqual(["self_shield"]);
    expect(rules("The champion shields herself for a short time.")).toEqual(["self_shield"]);
  });

  it("gives both when the shield reaches the caster and allies", () => {
    expect(rules("Shields herself and nearby allies.")).toEqual(["ally_shield", "self_shield"]);
  });

  it("ignores a shield that belongs to the enemy", () => {
    expect(rules("Removes nearby enemies' shields and silences them.")).toEqual([]);
  });

  it("separates healing allies from healing the caster, and does not read 'health' as 'heal'", () => {
    expect(rules("Heals another friendly champion.")).toEqual(["ally_heal"]);
    expect(rules("Soraka recovers Health when an enemy champion is hit.")).toEqual(["self_heal"]);
    expect(rules("Drains health from nearby enemies.")).toEqual(["self_heal"]);
    expect(rules("Reduces the maximum health of enemies and slows them.")).toEqual([]);
  });

  it("does not count heal reduction as a heal", () => {
    expect(rules("Applies heal reduction to the target.")).toEqual([]);
  });

  it("finds dashes, leaps and blinks, and ignores 'jump off' style wording", () => {
    expect(rules("Zed's shadow dashes forward.")).toEqual(["dash"]);
    expect(rules("Leaps to a location.")).toEqual(["dash"]);
    expect(rules("Blinks to the target.")).toEqual(["dash"]);
    expect(rules("He can jump off early or gets knocked off.")).toEqual([]);
  });

  it("finds hard crowd control and ignores slows and silences", () => {
    expect(rules("Stuns the target.")).toEqual(["hard_cc"]);
    expect(rules("Roots enemies in the area.")).toEqual(["hard_cc"]);
    expect(rules("Knocks the target back and deals damage.")).toEqual(["hard_cc"]);
    expect(rules("Knocks enemies into the air.")).toEqual(["hard_cc"]);
    expect(rules("Pulls an enemy towards her.")).toEqual(["hard_cc"]);
    expect(rules("Suppresses an enemy champion.")).toEqual(["hard_cc"]);
    expect(rules("The target falls asleep.")).toEqual(["hard_cc"]);
    expect(rules("Deals damage, slowing and silencing the target.", [500])).toEqual([]);
    expect(rules("A dagger rises into the air above herself.")).toEqual([]);
  });

  it("gives engage when a dash comes with crowd control", () => {
    expect(rules("Dashes to an enemy and stuns them on arrival.")).toEqual(["dash", "engage", "hard_cc"]);
  });

  it("gives nothing for plain damage, a slow alone or a steroid", () => {
    expect(rules("Deals magic damage and slowing nearby enemies.", [500])).toEqual([]);
    expect(rules("Gains Move Speed and Attack Speed for a few seconds.", [0])).toEqual([]);
  });

  it("gives poke for damage from far beyond attack range, but not from a short one or a dash", () => {
    expect(rules("Fires a bolt that deals damage.", [POKE_MIN_RANGE])).toEqual(["poke"]);
    expect(rules("Fires a bolt that deals damage.", [POKE_MIN_RANGE - 1])).toEqual([]);
    expect(rules("Dashes and deals damage.", [1200])).toEqual(["dash"]);
    expect(rules("Fires a bolt that deals damage.", [25000])).toEqual([]);
  });

  it("gives execute for missing-health damage or a kill threshold", () => {
    expect(rules("Deals damage based on the target's missing health.")).toEqual(["execute"]);
    expect(rules("Executes enemies below 30% of their maximum health.")).toEqual(["execute"]);
    expect(rules("Heals based on the missing health of the caster.")).not.toContain("execute");
  });

  it("gives stealth and untargetable", () => {
    expect(rules("Becomes invisible and gains Move Speed.")).toEqual(["stealth"]);
    expect(rules("Enters camouflage.")).toEqual(["stealth"]);
    expect(rules("Becomes untargetable for 2 seconds.")).toEqual(["untargetable"]);
    expect(rules("Makes an ally invulnerable.")).toEqual(["untargetable"]);
    expect(rules("Places a stasis on the target.")).toEqual(["untargetable"]);
  });

  it("gives global only from the text, never from a placeholder range", () => {
    expect(rules("Sends her hawk anywhere on the map.")).toEqual(["global"]);
    expect(rules("Fires a bolt that deals damage.", [25000])).not.toContain("global");
  });

  it("lists archetypes in vocabulary order and survives empty or missing input", () => {
    expect(rules("Dashes forward and shields herself, stunning enemies.")).toEqual(["self_shield", "dash", "engage", "hard_cc"]);
    expect(classifyAbilityText({})).toEqual([]);
    expect(classifyAbilityText({ description: "" })).toEqual([]);
    expect(classifyAbilityText(undefined as never)).toEqual([]);
  });
});

describe("cooldownAtMiddleRank", () => {
  it("takes rank 3 of 5 and rank 2 of 3", () => {
    expect(cooldownAtMiddleRank([8, 7, 6, 5, 4])).toBe(6);
    expect(cooldownAtMiddleRank([150, 135, 120])).toBe(135);
    expect(cooldownAtMiddleRank([12])).toBe(12);
  });

  it("is null when there is no cooldown", () => {
    expect(cooldownAtMiddleRank([0, 0, 0, 0, 0])).toBeNull();
    expect(cooldownAtMiddleRank([])).toBeNull();
    expect(cooldownAtMiddleRank(undefined)).toBeNull();
  });
});

describe("classifyRange", () => {
  const at = (range: number) => classifyRange([range, range, range]);

  it("applies the named thresholds at the middle rank", () => {
    expect(at(0)).toBe("self");
    expect(at(RANGE_THRESHOLDS.selfMax)).toBe("self");
    expect(at(RANGE_THRESHOLDS.selfMax + 1)).toBe("melee");
    expect(at(RANGE_THRESHOLDS.meleeMax)).toBe("melee");
    expect(at(RANGE_THRESHOLDS.meleeMax + 1)).toBe("short");
    expect(at(RANGE_THRESHOLDS.shortMax)).toBe("short");
    expect(at(RANGE_THRESHOLDS.shortMax + 1)).toBe("medium");
    expect(at(RANGE_THRESHOLDS.mediumMax)).toBe("medium");
    expect(at(RANGE_THRESHOLDS.mediumMax + 1)).toBe("long");
    expect(at(RANGE_THRESHOLDS.globalMin - 1)).toBe("long");
  });

  it("calls a huge placeholder range long, unless the ability is global", () => {
    expect(at(25000)).toBe("long");
    expect(classifyRange([25000], "Fires a rocket across the map.", ["global"])).toBe("global");
    expect(classifyRange([400], "Sends a hawk anywhere on the map.")).toBe("global");
  });

  it("only returns a known class", () => {
    for (const range of [0, 100, 500, 900, 5000, 25000]) expect(RANGE_CLASSES).toContain(at(range));
  });
});

function kit(slot: string, name: string, description: string, range = [500], cooldown = [10]) {
  return { slot, name, description, range, cooldown };
}

function fixtureKits(): KitsInput {
  const abilities = (prefix: string) => [
    kit("Q", `${prefix} Q`, "Deals damage."),
    kit("W", `${prefix} W`, "Shields an ally."),
    kit("E", `${prefix} E`, "Dashes forward."),
    kit("R", `${prefix} R`, "Stuns enemies."),
  ];
  return { patch: "99.1.1", date: "2030-01-02", champions: { Alpha: { abilities: abilities("Alpha") }, Beta: { abilities: abilities("Beta") } } };
}

describe("validateCurated and buildAbilities", () => {
  const ruleOutput = () => ({ archetypes: ["dash"] as never, rangeClass: "short" as never });
  const kitChampions = fixtureKits().champions;

  it("fails loudly on an unknown champion, slot or archetype", () => {
    expect(() => validateCurated({ overrides: { Nobody: { Q: ["dash"] } } } as CuratedInput, kitChampions, ruleOutput)).toThrow(/unknown champion Nobody/);
    expect(() => validateCurated({ overrides: { Alpha: { X: ["dash"] } } } as never, kitChampions, ruleOutput)).toThrow(/unknown slot X/);
    expect(() => validateCurated({ overrides: { Alpha: { Q: ["teleport"] } } } as never, kitChampions, ruleOutput)).toThrow(/unknown archetype teleport/);
    expect(() => validateCurated({ overrides: { Alpha: { Q: { rangeClass: "huge" } } } } as never, kitChampions, ruleOutput)).toThrow(/unknown range class huge/);
    expect(() => validateCurated({} as never, kitChampions, ruleOutput)).toThrow(/no `overrides`/);
  });

  it("rejects an entry that repeats or merely restates the rule output", () => {
    expect(() => validateCurated({ overrides: { Alpha: { Q: ["dash", "dash"] } } } as never, kitChampions, ruleOutput)).toThrow(/repeats/);
    expect(() => validateCurated({ overrides: { Alpha: { Q: ["dash"] } } } as never, kitChampions, ruleOutput)).toThrow(/equals the rule output/);
    expect(() => validateCurated({ overrides: { Alpha: { Q: { rangeClass: "short" } } } } as never, kitChampions, ruleOutput)).toThrow(/equals the rule output/);
    expect(() => validateCurated({ overrides: { Alpha: { Q: {} } } } as never, kitChampions, ruleOutput)).toThrow(/sets nothing/);
  });

  it("applies the rules, then the curated entries, and marks the origin", () => {
    const { file, report } = buildAbilities({
      kits: fixtureKits(),
      curated: { overrides: { Alpha: { Q: ["poke", "dash"], E: { rangeClass: "self" } } } },
    });
    expect(file.schema).toBe("olm.champion-abilities.v1");
    expect(file.patch).toBe("99.1.1");
    expect(file.date).toBe("2030-01-02");
    const alpha = file.champions.Alpha;
    expect(alpha.map((ability) => ability.slot)).toEqual(["Q", "W", "E", "R"]);
    expect(alpha[0]).toMatchObject({ archetypes: ["dash", "poke"], origin: "curated", cooldownSec: 10 });
    expect(alpha[1]).toMatchObject({ archetypes: ["ally_shield"], origin: "rule" });
    expect(alpha[2]).toMatchObject({ archetypes: ["dash"], rangeClass: "self", origin: "curated" });
    expect(alpha[3]).toMatchObject({ archetypes: ["hard_cc"], origin: "rule" });
    expect(file.champions.Beta[0]).toMatchObject({ archetypes: [], origin: "rule" });
    expect(report).toMatchObject({ champions: 2, abilities: 8, curated: 2, ruleOnly: 6 });
    expect(report.championsPerArchetype).toMatchObject({ dash: 2, poke: 1, ally_shield: 2, hard_cc: 2, global: 0 });
  });

  it("rejects a champion whose abilities are not Q, W, E, R in order", () => {
    const kits = fixtureKits();
    kits.champions.Alpha.abilities.reverse();
    expect(() => buildAbilities({ kits, curated: { overrides: {} } })).toThrow(/Q, W, E, R in order/);
    const short = fixtureKits();
    short.champions.Alpha.abilities.pop();
    expect(() => buildAbilities({ kits: short, curated: { overrides: {} } })).toThrow(/Q, W, E, R in order/);
  });

  it("prints the thresholds in the header", () => {
    const { file } = buildAbilities({ kits: fixtureKits(), curated: { overrides: {} } });
    expect(file.rangeClass.thresholds).toEqual({ ...RANGE_THRESHOLDS });
    expect(file.pokeMinRange).toBe(POKE_MIN_RANGE);
    expect(file.cooldownSec).toContain("middle rank");
  });
});
