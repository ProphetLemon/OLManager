// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildHeader,
  buildItems,
  buildKits,
  classifyUltimateArchetype,
  dropReason,
  itemKey,
  parseStatLines,
  stripMarkup,
} from "../../../scripts/game-data/lib/ddragon-transform.mjs";

const SR = { "11": true, "12": true };

function item(name: string, overrides: Record<string, unknown> = {}) {
  return {
    name,
    description: "",
    gold: { base: 100, total: 100, sell: 70, purchasable: true },
    tags: [],
    maps: SR,
    stats: {},
    ...overrides,
  };
}

const ITEM_FIXTURE = {
  version: "99.1.1",
  data: {
    "1001": item("Boots", { tags: ["Boots"], gold: { base: 300, total: 300, sell: 210, purchasable: true } }),
    "3006": item("Berserker's Greaves", { tags: ["Boots", "AttackSpeed"], from: ["1001", "1042"], depth: 2 }),
    "3999": item("Gunmetal Test Greaves", { tags: ["LifeSteal"], from: ["3006"], depth: 3 }),
    "1036": item("Long Sword", { tags: ["Damage", "Lane"], into: ["3031", "3071"], gold: { base: 350, total: 350, sell: 245, purchasable: true } }),
    "1082": item("Dark Seal", { tags: ["Health", "Lane"], into: ["3041"], gold: { base: 350, total: 350, sell: 140, purchasable: true } }),
    "3031": item("Infinity Edge", {
      description: "<mainText><stats><attention>75</attention> Attack Damage<br><attention>25%</attention> Critical Strike Chance<br><attention>20</attention> Ability Haste</stats><br><br></mainText>",
      from: ["1036", "9999"],
      into: ["323031"],
      depth: 2,
      tags: ["CriticalStrike", "Damage"],
      stats: { FlatCritChanceMod: 0.25, FlatPhysicalDamageMod: 75 },
      gold: { base: 725, total: 3500, sell: 2450, purchasable: true },
    }),
    "2003": item("Health Potion", { tags: ["Consumable", "Lane", "Jungle"], consumed: true }),
    "3340": item("Stealth Ward", { tags: ["Trinket", "Vision", "Lane"] }),
    "3865": item("World Atlas", { tags: ["GoldPer", "Lane", "Vision"] }),
    "3075": item("Thornmail", { from: ["1036"], tags: ["Armor"] }),
    "323075": item("Thornmail", { tags: ["Armor"], maps: { "11": true } }),
    "1101": item("Scorchclaw Pup", { tags: ["Jungle"] }),
    "1107": item("Scorchclaw Pup", { tags: ["Jungle"] }),
    "7000": item("Aram Only Orb", { maps: { "11": false, "12": true } }),
    "2421": item("Hidden Armguard", { hideFromAll: true }),
    "3330": item("Champion Effigy", { requiredChampion: "FiddleSticks" }),
    "3157": item("Ornn Upgrade", { requiredAlly: "Ornn" }),
    "3040": item("Removed Embrace", { gold: { base: 0, total: 2900, sell: 2000, purchasable: false } }),
    "3041": item("Not In Store", { inStore: false }),
  },
};

describe("stripMarkup", () => {
  it("removes tags, turns breaks into spaces and decodes entities", () => {
    expect(stripMarkup("Deals <magicDamage>100 magic damage</magicDamage>.<br />Then <status>stuns</status> &amp; slows&nbsp;1s.")).toBe(
      "Deals 100 magic damage. Then stuns & slows 1s.",
    );
  });

  it("returns an empty string for anything that is not text", () => {
    expect(stripMarkup(undefined)).toBe("");
    expect(stripMarkup(42)).toBe("");
  });
});

describe("itemKey", () => {
  it("follows the style of the existing icon files", () => {
    expect(itemKey("Infinity Edge")).toBe("infinity_edge");
    expect(itemKey("Guinsoo's Rageblade")).toBe("guinsoos_rageblade");
    expect(itemKey("Blade of The Ruined King")).toBe("blade_of_the_ruined_king");
    expect(itemKey("Dead Man’s Plate")).toBe("dead_mans_plate");
    expect(itemKey("Hexoptics C44")).toBe("hexoptics_c44");
  });
});

describe("parseStatLines", () => {
  it("reads the stats block of the description, including stats the stats object lacks", () => {
    expect(parseStatLines(ITEM_FIXTURE.data["3031"].description)).toEqual([
      { value: "75", stat: "Attack Damage" },
      { value: "25%", stat: "Critical Strike Chance" },
      { value: "20", stat: "Ability Haste" },
    ]);
  });

  it("is empty without a stats block", () => {
    expect(parseStatLines("<mainText>Passive only</mainText>")).toEqual([]);
    expect(parseStatLines(undefined)).toEqual([]);
  });
});

describe("dropReason", () => {
  it("names the first rule that removes an item", () => {
    const data = ITEM_FIXTURE.data;
    expect(dropReason("7000", data["7000"])).toBe("other-mode");
    expect(dropReason("323075", data["323075"])).toBe("mode-variant-id");
    expect(dropReason("2421", data["2421"])).toBe("hidden");
    expect(dropReason("3330", data["3330"])).toBe("champion-only");
    expect(dropReason("3157", data["3157"])).toBe("ally-required");
    expect(dropReason("3040", data["3040"])).toBe("not-purchasable");
    expect(dropReason("3041", data["3041"])).toBe("not-purchasable");
    expect(dropReason("3031", data["3031"])).toBeNull();
  });
});

describe("buildItems", () => {
  const { items, filter } = buildItems(ITEM_FIXTURE);
  const byKey = Object.fromEntries(items.map((entry) => [entry.key, entry]));

  it("keeps Summoner's Rift shop items and counts every drop by reason", () => {
    // Ids ascending: 1001, 1036, 1082, 1101, 2003, 3006, 3031, 3075, 3340, 3865, 3999.
    expect(items.map((entry) => entry.key)).toEqual([
      "boots",
      "long_sword",
      "dark_seal",
      "scorchclaw_pup",
      "health_potion",
      "berserkers_greaves",
      "infinity_edge",
      "thornmail",
      "stealth_ward",
      "world_atlas",
      "gunmetal_test_greaves",
    ]);
    expect(filter.total).toBe(Object.keys(ITEM_FIXTURE.data).length);
    expect(filter.kept).toBe(items.length);
    expect(filter.dropped).toBe(filter.total - filter.kept);
    expect(filter.droppedByReason).toEqual({
      "other-mode": 1,
      "mode-variant-id": 1,
      hidden: 1,
      "champion-only": 1,
      "ally-required": 1,
      "not-purchasable": 2,
      "duplicate-name": 1,
    });
    expect(filter.duplicateNames).toEqual([{ name: "Scorchclaw Pup", kept: "1101", dropped: "1107" }]);
  });

  it("keeps the lowest id of two items with the same name", () => {
    expect(byKey.scorchclaw_pup.id).toBe(1101);
    expect(byKey.thornmail.id).toBe(3075);
  });

  it("carries cost, stats as given, stat lines and recipe links that stay inside the catalogue", () => {
    const edge = byKey.infinity_edge;
    expect(edge).toMatchObject({
      id: 3031,
      name: "Infinity Edge",
      cost: 3500,
      baseCost: 725,
      stats: { FlatCritChanceMod: 0.25, FlatPhysicalDamageMod: 75 },
      tags: ["CriticalStrike", "Damage"],
      icon: "/lol-item-icons/infinity_edge.png",
    });
    expect(edge.statLines.map((line) => line.stat)).toContain("Ability Haste");
    // 9999 is not an item and 323031 is a dropped mode copy: neither may stay in the recipe.
    expect(edge.buildsFrom).toEqual([1036]);
    expect(edge.buildsInto).toEqual([]);
    // 3071 does not exist in the download, so only Infinity Edge remains.
    expect(byKey.long_sword.buildsInto).toEqual([3031]);
  });

  it("sets the boots flag from the tag and from boots upgrades without the tag", () => {
    expect(byKey.boots.boots).toBe(true);
    expect(byKey.berserkers_greaves.boots).toBe(true);
    expect(byKey.gunmetal_test_greaves.boots).toBe(true);
    expect(byKey.infinity_edge.boots).toBe(false);
  });

  it("flags starters, consumables, trinkets and support items", () => {
    expect(byKey.dark_seal.starter).toBe(true);
    expect(byKey.scorchclaw_pup.starter).toBe(true);
    expect(byKey.long_sword.starter).toBe(false);
    expect(byKey.health_potion).toMatchObject({ consumable: true, starter: false });
    expect(byKey.stealth_ward).toMatchObject({ trinket: true, starter: false });
    expect(byKey.world_atlas).toMatchObject({ support: true, starter: false });
    expect(byKey.infinity_edge.support).toBe(false);
  });

  it("fails loudly when two items would share a key", () => {
    const clash = { data: { "1": item("Odd Item"), "2": item("Odd  Item!") } };
    expect(() => buildItems(clash)).toThrow(/share the key odd_item/);
  });

  it("returns an empty catalogue for an empty download", () => {
    expect(buildItems({}).items).toEqual([]);
  });
});

function spell(id: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name,
    description: "Plain description.",
    tooltip: "Plain tooltip.",
    cooldown: [10, 9, 8],
    cost: [50, 55, 60],
    costType: " {{ abilityresourcename }}",
    range: [600, 600, 600],
    maxrank: 3,
    image: { full: `${id}.png` },
    ...overrides,
  };
}

function champion(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    key: "266",
    name: id,
    title: "the Tester",
    tags: ["Fighter", "Tank"],
    partype: "Mana",
    stats: { hp: 650, hpperlevel: 114, attackrange: 175, attackdamage: 60 },
    passive: { name: "<b>Passive</b>", description: "Heals <healing>a bit</healing>.", image: { full: "Passive.png" } },
    spells: [spell(`${id}Q`, "Q"), spell(`${id}W`, "W"), spell(`${id}E`, "E"), spell(`${id}R`, "World Ender", { tooltip: "Fears <status>minions</status> and surges." })],
    ...overrides,
  };
}

describe("classifyUltimateArchetype", () => {
  it("keeps the keyword order of the live view classifier", () => {
    expect(classifyUltimateArchetype("Judgment", "Executes enemies below 30% health")).toBe("execute");
    expect(classifyUltimateArchetype("Requiem", "Hits every enemy champion anywhere on the map")).toBe("global");
    expect(classifyUltimateArchetype("Leap", "Dashes to a target")).toBe("engage");
    expect(classifyUltimateArchetype("Shield", "Grants a shield to allies")).toBe("defensive");
    expect(classifyUltimateArchetype("Storm", "Creates a storm over a large area")).toBe("zone");
    expect(classifyUltimateArchetype("Morph", "Transform into a beast")).toBe("sustain");
    expect(classifyUltimateArchetype("Blast", "Deals magic damage")).toBe("burst");
  });

  it("matches the raw tooltip, so a markup tag name can decide the archetype as it did before", () => {
    expect(classifyUltimateArchetype("Mend", "Restores <healing>health</healing>")).toBe("defensive");
  });
});

describe("buildKits", () => {
  const full = { data: { Aatrox: champion("Aatrox"), Ahri: champion("Ahri"), Locke: champion("Locke", { key: "1" }) } };
  const { champions, report } = buildKits(full, ["Aatrox", "Ahri", "Zed"]);

  it("builds one kit per Data Dragon champion with stats as given", () => {
    expect(Object.keys(champions)).toEqual(["Aatrox", "Ahri", "Locke"]);
    expect(champions.Aatrox).toMatchObject({
      id: "Aatrox",
      key: 266,
      tags: ["Fighter", "Tank"],
      resource: "Mana",
      attackRange: 175,
      stats: { hp: 650, hpperlevel: 114, attackrange: 175, attackdamage: 60 },
      inCatalogue: true,
    });
  });

  it("strips markup from names and descriptions and keeps the numbers", () => {
    expect(champions.Aatrox.passive).toEqual({ name: "Passive", description: "Heals a bit.", image: "Passive.png" });
    const ultimate = champions.Aatrox.abilities[3];
    expect(ultimate).toMatchObject({ slot: "R", name: "World Ender", cooldown: [10, 9, 8], cost: [50, 55, 60], range: [600, 600, 600], maxRank: 3, image: "AatroxR.png" });
    expect(champions.Aatrox.abilities.map((ability) => ability.slot)).toEqual(["Q", "W", "E", "R"]);
  });

  it("stores the ultimate archetype computed from the raw tooltip and a local icon path", () => {
    expect(champions.Aatrox.ultimate).toEqual({ archetype: "burst", icon: "/lol-ultimate-icons/AatroxR.png" });
  });

  it("falls back to the description when the tooltip is empty", () => {
    const only = buildKits({ data: { Zed: champion("Zed", { spells: [spell("ZedQ", "Q"), spell("ZedW", "W"), spell("ZedE", "E"), spell("ZedR", "Death Mark", { tooltip: "", description: "Dashes at the target" })] }) } }, ["Zed"]);
    expect(only.champions.Zed.ultimate.archetype).toBe("engage");
  });

  it("reports champions outside the catalogue and catalogue entries Data Dragon lacks", () => {
    expect(report).toEqual({ total: 3, inCatalogue: 2, notInCatalogue: ["Locke"], missingFromData: ["Zed"] });
    expect(champions.Locke.inCatalogue).toBe(false);
  });

  it("rejects a champion that does not have four abilities", () => {
    expect(() => buildKits({ data: { Odd: champion("Odd", { spells: [spell("OddQ", "Q")] }) } }, ["Odd"])).toThrow(/expected 4/);
  });
});

describe("buildHeader", () => {
  it("names the schema, patch, date and source", () => {
    expect(buildHeader({ patch: "16.22.1", date: "2026-11-11", kind: "items" })).toMatchObject({
      schema: "olm.items.v1",
      patch: "16.22.1",
      date: "2026-11-11",
      locale: "en_US",
      source: expect.stringContaining("ddragon.leagueoflegends.com"),
    });
  });
});
