// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import kitsFile from "../../../assets/simulation/champion-kits.v1.json";
import abilitiesFile from "../../../assets/simulation/champion-abilities.v1.json";
import curatedFile from "../../../scripts/game-data/ability-archetypes.curated.json";
import { ARCHETYPE_NAMES, ARCHETYPES, DAMAGE_KINDS, POKE_EXCLUDED_WITH, RANGE_CLASSES, SLOTS } from "../../../scripts/game-data/lib/ability-archetypes.mjs";
import { parseArgs, render } from "../../../scripts/game-data/abilities.mjs";

const root = path.resolve(__dirname, "../../..");
const champions = abilitiesFile.champions as Record<string, Array<{ slot: string; name: string; archetypes: string[]; cooldownSec: number | null; rangeClass: string; origin: string }>>;
const kitChampions = kitsFile.champions as Record<string, { abilities: Array<{ slot: string; name: string; cooldown: number[] }> }>;

const has = (champion: string, slot: string, ...archetypes: string[]) => {
  const ability = champions[champion].find((entry) => entry.slot === slot);
  expect(ability, `${champion} ${slot}`).toBeDefined();
  for (const name of archetypes) expect(ability?.archetypes, `${champion} ${slot}`).toContain(name);
};
const countWith = (champion: string, archetype: string) => champions[champion].filter((entry) => entry.archetypes.includes(archetype)).length;

describe("champion-abilities.v1.json header", () => {
  it("names its schema, patch, date, source and generator, copied from the kits file", () => {
    expect(abilitiesFile.schema).toBe("olm.champion-abilities.v1");
    expect(abilitiesFile.patch).toBe(kitsFile.patch);
    expect(abilitiesFile.date).toBe(kitsFile.date);
    expect(abilitiesFile.source).toContain("champion-kits.v1.json");
    expect(abilitiesFile.generator).toBe("scripts/game-data/abilities.mjs");
  });

  it("defines the closed vocabulary in one line each, and the range thresholds and cooldown rule", () => {
    expect(Object.keys(abilitiesFile.archetypes)).toEqual(ARCHETYPE_NAMES);
    expect(abilitiesFile.archetypes).toEqual(ARCHETYPES);
    expect(Object.keys(abilitiesFile.rangeClass.classes)).toEqual(RANGE_CLASSES);
    expect(abilitiesFile.rangeClass.thresholds.meleeMax).toBeLessThan(abilitiesFile.rangeClass.thresholds.shortMax);
    expect(abilitiesFile.rangeClass.thresholds.shortMax).toBeLessThan(abilitiesFile.rangeClass.thresholds.mediumMax);
    expect(abilitiesFile.cooldownSec).toContain("middle rank");
    expect(ARCHETYPE_NAMES).toHaveLength(18);
  });
});

describe("champion-abilities.v1.json is what the generator produces", () => {
  it("matches a regeneration from the two committed inputs, byte for byte", () => {
    const { text } = render(kitsFile as never, curatedFile as never);
    expect(fs.readFileSync(path.join(root, "assets/simulation/champion-abilities.v1.json"), "utf8")).toBe(text);
  });

  it("defaults the command to the committed inputs and output", () => {
    const args = parseArgs([]);
    expect(path.relative(root, args.kits)).toBe("assets/simulation/champion-kits.v1.json");
    expect(path.relative(root, args.curated)).toBe("scripts/game-data/ability-archetypes.curated.json");
    expect(path.relative(root, args.out)).toBe("assets/simulation/champion-abilities.v1.json");
    expect(() => parseArgs(["--nope"])).toThrow(/unknown flag/);
  });
});

describe("champion-abilities.v1.json content", () => {
  it("has every champion of the kits file with exactly four abilities in order Q, W, E, R, named as in the kit", () => {
    expect(Object.keys(champions).sort()).toEqual(Object.keys(kitChampions).sort());
    for (const [id, abilities] of Object.entries(champions)) {
      expect(abilities.map((ability) => ability.slot), id).toEqual(SLOTS);
      expect(abilities.map((ability) => ability.name), id).toEqual(kitChampions[id].abilities.map((ability) => ability.name));
    }
  });

  it("uses only vocabulary terms, once each and in vocabulary order", () => {
    for (const [id, abilities] of Object.entries(champions)) {
      for (const ability of abilities) {
        const label = `${id} ${ability.slot}`;
        for (const name of ability.archetypes) expect(ARCHETYPE_NAMES, label).toContain(name);
        expect(new Set(ability.archetypes).size, label).toBe(ability.archetypes.length);
        expect(ability.archetypes, label).toEqual(ARCHETYPE_NAMES.filter((name) => ability.archetypes.includes(name)));
      }
    }
  });

  it("gives a positive cooldown to abilities that have one, null to the rest, and a known range class and origin", () => {
    for (const [id, abilities] of Object.entries(champions)) {
      abilities.forEach((ability, index) => {
        const label = `${id} ${ability.slot}`;
        const kitCooldowns = kitChampions[id].abilities[index].cooldown;
        const middle = kitCooldowns[Math.floor((kitCooldowns.length - 1) / 2)];
        if (middle > 0) {
          expect(typeof ability.cooldownSec, label).toBe("number");
          expect(ability.cooldownSec, label).toBe(middle);
          expect(ability.cooldownSec as number, label).toBeGreaterThan(0);
        } else {
          expect(ability.cooldownSec, label).toBeNull();
        }
        expect(RANGE_CLASSES, label).toContain(ability.rangeClass);
        expect(["rule", "curated"], label).toContain(ability.origin);
      });
    }
  });

  it("marks exactly the curated entries as curated, and keeps no entry that restates the rules", () => {
    let curated = 0;
    for (const [id, slots] of Object.entries(curatedFile.overrides)) {
      for (const slot of Object.keys(slots)) {
        curated += 1;
        expect(champions[id].find((entry) => entry.slot === slot)?.origin, `${id} ${slot}`).toBe("curated");
      }
    }
    const fromFile = Object.values(champions).flat().filter((ability) => ability.origin === "curated").length;
    expect(fromFile).toBe(curated);
    // Well over half of the abilities must come from the rules alone, otherwise the rules are not doing their job.
    expect(fromFile).toBeLessThan(Object.values(champions).flat().length * 0.5);
  });

  it("gives every ability at least one term, unless it is listed under noEffect with a reason", () => {
    const noEffect = (curatedFile as { noEffect?: Record<string, Record<string, string>> }).noEffect ?? {};
    for (const [id, abilities] of Object.entries(champions)) {
      for (const ability of abilities) {
        const reason = noEffect[id]?.[ability.slot];
        if (ability.archetypes.length === 0) expect(reason, `${id} ${ability.slot} has no term and no noEffect reason`).toBeTypeOf("string");
        else expect(reason, `${id} ${ability.slot} has terms and a noEffect entry`).toBeUndefined();
      }
    }
    for (const [id, slots] of Object.entries(noEffect)) {
      for (const [slot, reason] of Object.entries(slots)) expect(reason.length, `${id} ${slot}`).toBeGreaterThan(20);
    }
    // The target is zero: only a slot that is not an ability, or one that merely repeats another spell, may sit here.
    const listed = Object.values(noEffect).reduce((sum, slots) => sum + Object.keys(slots).length, 0);
    expect(listed).toBeLessThanOrEqual(5);
  });

  it("gives an ability at most one damage kind, and never poke together with dash, engage or hard_cc", () => {
    for (const [id, abilities] of Object.entries(champions)) {
      for (const ability of abilities) {
        const label = `${id} ${ability.slot}`;
        expect(DAMAGE_KINDS.filter((kind) => ability.archetypes.includes(kind)).length, label).toBeLessThanOrEqual(1);
        if (ability.archetypes.includes("poke")) {
          for (const excluded of POKE_EXCLUDED_WITH) expect(ability.archetypes, label).not.toContain(excluded);
        }
      }
    }
  });

  it("counts abilities per damage kind inside loose bounds", () => {
    const abilities = Object.values(champions).flat();
    const count = (kind: string) => abilities.filter((ability) => ability.archetypes.includes(kind)).length;
    expect(count("execute")).toBeGreaterThanOrEqual(10);
    expect(count("execute")).toBeLessThanOrEqual(40);
    expect(count("poke")).toBeGreaterThanOrEqual(40);
    expect(count("poke")).toBeLessThanOrEqual(120);
    expect(count("damage")).toBeGreaterThanOrEqual(250);
    expect(count("damage")).toBeLessThanOrEqual(500);
  });

  it("counts champions per archetype inside loose bounds, so a broken rule shows", () => {
    const counts = Object.fromEntries(ARCHETYPE_NAMES.map((name) => [name, Object.values(champions).filter((abilities) => abilities.some((ability) => ability.archetypes.includes(name))).length]));
    const bounds: Record<string, [number, number]> = {
      ally_shield: [12, 40],
      ally_heal: [8, 30],
      self_shield: [15, 60],
      self_heal: [20, 70],
      dash: [60, 130],
      engage: [15, 60],
      hard_cc: [80, 150],
      poke: [40, 120],
      execute: [8, 40],
      stealth: [8, 30],
      untargetable: [10, 35],
      global: [6, 25],
      ally_buff: [15, 60],
      self_buff: [80, 165],
      soft_cc: [70, 150],
      damage: [130, 173],
      zone: [35, 100],
      summon: [10, 40],
    };
    for (const [name, [min, max]] of Object.entries(bounds)) {
      expect(counts[name], name).toBeGreaterThanOrEqual(min);
      expect(counts[name], name).toBeLessThanOrEqual(max);
    }
  });
});

describe("named champions read from the committed file", () => {
  it("Yuumi shields or heals an ally and can become untargetable", () => {
    expect(champions.Yuumi.some((ability) => ability.archetypes.includes("ally_shield") || ability.archetypes.includes("ally_heal"))).toBe(true);
    expect(countWith("Yuumi", "untargetable")).toBeGreaterThanOrEqual(1);
  });

  it("Soraka has an ally heal on a basic ability and a global ally heal ultimate", () => {
    const basics = champions.Soraka.filter((ability) => ability.slot !== "R");
    expect(basics.some((ability) => ability.archetypes.includes("ally_heal"))).toBe(true);
    has("Soraka", "R", "ally_heal", "global");
  });

  it("Zed has at least two abilities with a dash", () => {
    expect(countWith("Zed", "dash")).toBeGreaterThanOrEqual(2);
  });

  it("Lulu and Janna shield allies", () => {
    expect(countWith("Lulu", "ally_shield")).toBeGreaterThanOrEqual(1);
    expect(countWith("Janna", "ally_shield")).toBeGreaterThanOrEqual(1);
  });

  it("Leona and Malphite engage with crowd control", () => {
    has("Leona", "E", "engage", "hard_cc");
    has("Malphite", "R", "engage", "hard_cc");
  });

  it("Ahri has hard crowd control on one ability and a dash on her ultimate", () => {
    expect(countWith("Ahri", "hard_cc")).toBeGreaterThanOrEqual(1);
    has("Ahri", "R", "dash");
  });

  it("Ezreal has a dash and poke", () => {
    expect(countWith("Ezreal", "dash")).toBeGreaterThanOrEqual(1);
    expect(countWith("Ezreal", "poke")).toBeGreaterThanOrEqual(1);
  });

  it("Shen's ultimate is global and shields an ally", () => {
    has("Shen", "R", "global", "ally_shield");
  });

  it("Garen's and Darius's ultimates execute", () => {
    has("Garen", "R", "execute");
    has("Darius", "R", "execute");
  });

  it("Twitch has stealth", () => {
    expect(countWith("Twitch", "stealth")).toBeGreaterThanOrEqual(1);
  });

  it("Kayle can make an ally untargetable", () => {
    has("Kayle", "R", "untargetable");
  });

  it("Nasus, Teemo and Trundle, which had no type at all, have a type on all four abilities", () => {
    for (const id of ["Nasus", "Teemo", "Trundle"]) {
      expect(champions[id].map((ability) => ability.slot), id).toEqual(SLOTS);
      for (const ability of champions[id]) expect(ability.archetypes.length, `${id} ${ability.slot}`).toBeGreaterThan(0);
    }
  });

  it("Garen's Decisive Strike and Ashe's Ranger's Focus are self buffs, Garen's also deals damage", () => {
    has("Garen", "Q", "self_buff", "damage");
    has("Ashe", "Q", "self_buff");
    expect(champions.Ashe[0].archetypes).not.toContain("damage");
  });

  it("Zed's Shadow Slash is damage with a slow", () => {
    has("Zed", "E", "damage", "soft_cc");
  });

  it("Teemo's ultimate is a zone and Annie's ultimate summons", () => {
    has("Teemo", "R", "zone");
    has("Annie", "R", "summon");
  });

  it("Zilean and Lulu buff allies", () => {
    has("Zilean", "E", "ally_buff");
    has("Lulu", "W", "ally_buff");
  });

  it("crowd-control skillshots are hard_cc plus damage, not poke, and a dash that hits is dash plus damage", () => {
    has("Ahri", "E", "hard_cc", "damage");
    has("Leona", "R", "hard_cc", "damage");
    expect(champions.Ahri[2].archetypes).not.toContain("poke");
    has("Ahri", "R", "dash", "damage");
    has("Fizz", "Q", "dash", "damage");
  });

  it("a shield or a heal that deals no damage has no damage kind", () => {
    for (const [id, slot] of [["Lulu", "E"], ["Janna", "E"], ["Soraka", "W"], ["Milio", "R"]] as const) {
      const ability = champions[id].find((entry) => entry.slot === slot);
      expect(DAMAGE_KINDS.some((kind) => ability?.archetypes.includes(kind)), `${id} ${slot}`).toBe(id === "Lulu");
    }
  });

  it("the three champions new in this patch are classified from their texts", () => {
    for (const id of ["Mel", "Yunara", "Zaahen"]) expect(champions[id], id).toHaveLength(4);
    has("Mel", "W", "ally_shield");
    has("Zaahen", "E", "dash");
  });
});
