// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import championList from "../../../assets/simulation/champion-list.json";
import itemsFile from "../../../assets/simulation/items.v1.json";
import kitsFile from "../../../assets/simulation/champion-kits.v1.json";

const root = path.resolve(__dirname, "../../..");
const publicFile = (webPath: string) => path.join(root, "public", webPath);

const items = itemsFile.items;
const itemIds = new Set(items.map((item) => item.id));
const itemKeys = new Set(items.map((item) => item.key));

describe("items.v1.json", () => {
  it("names its patch, date, source and filter", () => {
    expect(itemsFile.schema).toBe("olm.items.v1");
    expect(itemsFile.patch).toMatch(/^\d+\.\d+\.\d+$/);
    expect(itemsFile.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(itemsFile.source).toContain("ddragon.leagueoflegends.com");
    expect(itemsFile.filter.rule).toContain("maps.11");
  });

  it("agrees with its own filter report", () => {
    expect(itemsFile.filter.kept).toBe(items.length);
    expect(itemsFile.filter.kept + itemsFile.filter.dropped).toBe(itemsFile.filter.total);
    const dropped = Object.values(itemsFile.filter.droppedByReason).reduce((sum, count) => sum + count, 0);
    expect(dropped).toBe(itemsFile.filter.dropped);
  });

  it("has unique ids and keys in the icon file style, with a plausible cost", () => {
    expect(itemIds.size).toBe(items.length);
    expect(itemKeys.size).toBe(items.length);
    for (const item of items) {
      expect(item.key, item.name).toMatch(/^[a-z0-9]+(_[a-z0-9]+)*$/);
      expect(item.icon).toBe(`/lol-item-icons/${item.key}.png`);
      expect(Number.isInteger(item.cost) && item.cost >= 0, item.name).toBe(true);
      expect(item.name, item.key).not.toMatch(/[<>]/);
    }
  });

  it("keeps recipes inside the catalogue and consistent in both directions", () => {
    const byId = new Map(items.map((item) => [item.id, item]));
    for (const item of items) {
      for (const id of item.buildsFrom) {
        expect(byId.has(id), `${item.key} builds from ${id}`).toBe(true);
        expect(byId.get(id)?.buildsInto, `${id} into ${item.key}`).toContain(item.id);
      }
      for (const id of item.buildsInto) expect(byId.has(id), `${item.key} builds into ${id}`).toBe(true);
    }
  });

  it("has an icon file for every item", () => {
    const missing = items.filter((item) => !fs.existsSync(publicFile(item.icon))).map((item) => item.key);
    expect(missing).toEqual([]);
  });

  it("covers boots, starters, consumables, trinkets and support items", () => {
    for (const flag of ["boots", "starter", "consumable", "trinket", "support"] as const) {
      expect(items.some((item) => item[flag]), flag).toBe(true);
    }
    expect(items.filter((item) => item.boots).every((item) => item.cost >= 300)).toBe(true);
    const finished = items.filter((item) => item.buildsInto.length === 0 && item.cost >= 2000 && !item.boots);
    expect(finished.length).toBeGreaterThan(50);
  });

  it("resolves the 60 item keys of the live engine tables or lists them as retired", () => {
    const rust = fs.readFileSync(path.join(root, "src-tauri/crates/olm_core/src/sim_live.rs"), "utf8");
    const engineKeys = new Set([...rust.matchAll(/key: "([a-z_]+)",\s*cost:/g)].map((match) => match[1]));
    expect(engineKeys.size).toBe(60);
    const retired = new Set(itemsFile.retiredKeys);
    const unresolved = [...engineKeys].filter((key) => !itemKeys.has(key) && !retired.has(key));
    expect(unresolved).toEqual([]);
    for (const key of retired) {
      expect(itemKeys.has(key), `${key} is retired but in the catalogue`).toBe(false);
      expect(fs.existsSync(publicFile(`/lol-item-icons/${key}.png`)), `${key} icon`).toBe(true);
    }
  });
});

describe("champion-kits.v1.json", () => {
  const kits = Object.values(kitsFile.champions);

  it("names the same patch and source as the items file", () => {
    expect(kitsFile.schema).toBe("olm.champion-kits.v1");
    expect(kitsFile.patch).toBe(itemsFile.patch);
    expect(kitsFile.date).toBe(itemsFile.date);
    expect(kitsFile.catalogueVersion).toBe(championList.version);
  });

  it("has a kit for every champion of the catalogue", () => {
    const missing = championList.champions.filter((champion) => !(champion.id in kitsFile.champions)).map((champion) => champion.id);
    expect(missing).toEqual([]);
    for (const champion of championList.champions) expect(kitsFile.champions[champion.id as keyof typeof kitsFile.champions].inCatalogue).toBe(true);
  });

  it("lists exactly the champions outside the catalogue", () => {
    const catalogue = new Set(championList.champions.map((champion) => champion.id));
    expect(kits.filter((kit) => !kit.inCatalogue).map((kit) => kit.id).sort()).toEqual([...kitsFile.championsNotInCatalogue].sort());
    expect(kits.every((kit) => kit.inCatalogue === catalogue.has(kit.id))).toBe(true);
  });

  it("gives every champion stats, a passive and four abilities with an ultimate icon on disk", () => {
    for (const kit of kits) {
      expect(kit.stats.hp, kit.id).toBeGreaterThan(0);
      expect(kit.attackRange, kit.id).toBe(kit.stats.attackrange);
      expect(kit.passive.name, kit.id).not.toBe("");
      expect(kit.abilities.map((ability) => ability.slot), kit.id).toEqual(["Q", "W", "E", "R"]);
      for (const ability of kit.abilities) {
        expect(ability.name, `${kit.id} ${ability.slot}`).not.toBe("");
        expect(ability.description, `${kit.id} ${ability.slot}`).not.toMatch(/<[a-zA-Z/]/);
        expect(ability.cooldown.length, `${kit.id} ${ability.slot}`).toBeGreaterThan(0);
      }
      expect(["execute", "global", "engage", "defensive", "zone", "sustain", "burst"], kit.id).toContain(kit.ultimate.archetype);
      expect(kit.ultimate.icon, kit.id).toBe(`/lol-ultimate-icons/${kit.abilities[3].image}`);
      expect(fs.existsSync(publicFile(kit.ultimate.icon)), `${kit.id} ultimate icon`).toBe(true);
    }
  });
});

describe("icons the live view shows", () => {
  it("has the five summoner spell icons and the two trinket icons", () => {
    for (const id of ["SummonerFlash", "SummonerDot", "SummonerHeal", "SummonerSmite", "SummonerTeleport"]) {
      expect(fs.existsSync(publicFile(`/lol-summoner-icons/${id}.png`)), id).toBe(true);
    }
    for (const key of ["stealth_ward", "oracle_lens"]) expect(itemKeys.has(key), key).toBe(true);
  });
});
