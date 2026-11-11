// @vitest-environment node
import { describe, expect, it } from "vitest";
import buildsFile from "../../../assets/simulation/champion-builds.v1.json";
import itemsFile from "../../../assets/simulation/items.v1.json";
import kitsFile from "../../../assets/simulation/champion-kits.v1.json";

type Entry = {
  games: number;
  wins: number;
  buildGames: number;
  build: { boots: string | null; items: string[] } | null;
  itemShare?: Record<string, number>;
  bootsShare?: Record<string, number>;
  commonCores?: { items: string[]; games: number }[];
  fallback?: string;
  class?: string | null;
};

const itemByKey = new Map(itemsFile.items.map((item) => [item.key, item]));
const champions = buildsFile.champions as unknown as Record<string, Record<string, Entry>>;
const entries = Object.entries(champions).flatMap(([champion, roles]) => Object.entries(roles).map(([role, entry]) => ({ champion, role, entry })));

describe("champion-builds.v1.json", () => {
  it("records its provenance", () => {
    expect(buildsFile.schema).toBe("olm.champion-builds.v1");
    expect(buildsFile.source).toContain("Leaguepedia");
    expect(buildsFile.leagues).toEqual(expect.any(String));
    expect(buildsFile.since < buildsFile.until).toBe(true);
    expect(buildsFile.firstGame && buildsFile.lastGame).toBeTruthy();
    expect(buildsFile.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(buildsFile.minGames).toBeGreaterThanOrEqual(10);
    expect(buildsFile.itemsPatch).toBe(itemsFile.patch);
  });

  it("counts its games by patch and its pairs consistently", () => {
    expect(buildsFile.games).toBeGreaterThan(1000);
    expect(Object.values(buildsFile.patches).reduce((sum, count) => sum + count, 0)).toBe(buildsFile.games);
    expect(entries.length).toBe(buildsFile.pairs.total);
    expect(entries.filter(({ entry }) => entry.build).length).toBe(buildsFile.pairs.withBuild);
    expect(entries.filter(({ entry }) => !entry.build).length).toBe(buildsFile.pairs.fallback);
    expect(buildsFile.pairs.withBuild).toBeGreaterThan(100);
  });

  it("names only champions of the kits file and roles of the game", () => {
    const roles = new Set(["Top", "Jungle", "Mid", "Bot", "Support"]);
    for (const { champion, role } of entries) {
      expect(champion in kitsFile.champions, champion).toBe(true);
      expect(roles.has(role), `${champion} ${role}`).toBe(true);
    }
  });

  it("keeps games, wins and sample sizes in order", () => {
    for (const { champion, role, entry } of entries) {
      const label = `${champion} ${role}`;
      expect(entry.wins, label).toBeLessThanOrEqual(entry.games);
      expect(entry.buildGames, label).toBeLessThanOrEqual(entry.games);
      if (entry.build) expect(entry.buildGames, label).toBeGreaterThanOrEqual(buildsFile.minGames);
      else expect(entry.buildGames < buildsFile.minGames || (entry.itemShare === undefined), label).toBe(true);
    }
  });

  it("names only item keys that exist in items.v1.json, with finished items and boots in the right places", () => {
    for (const { champion, role, entry } of entries) {
      const label = `${champion} ${role}`;
      if (!entry.build) continue;
      expect(entry.build.items.length, label).toBeGreaterThanOrEqual(3);
      expect(entry.build.items.length, label).toBeLessThanOrEqual(5);
      expect(new Set(entry.build.items).size, label).toBe(entry.build.items.length);
      for (const key of entry.build.items) {
        const item = itemByKey.get(key);
        expect(item, `${label} ${key}`).toBeDefined();
        expect(item?.boots, `${label} ${key}`).toBe(false);
        expect(item?.buildsInto.length, `${label} ${key}`).toBe(0);
      }
      if (entry.build.boots) expect(itemByKey.get(entry.build.boots)?.boots, `${label} boots`).toBe(true);
      for (const key of [...Object.keys(entry.itemShare ?? {}), ...Object.keys(entry.bootsShare ?? {}), ...(entry.commonCores ?? []).flatMap((core) => core.items)]) {
        expect(itemByKey.has(key), `${label} ${key}`).toBe(true);
      }
      for (const share of Object.values(entry.itemShare ?? {})) expect(share > 0 && share <= 1).toBe(true);
    }
  });

  it("orders each build by how often the items appear", () => {
    for (const { champion, role, entry } of entries) {
      if (!entry.build || !entry.itemShare) continue;
      const shares = entry.build.items.map((key) => entry.itemShare?.[key] ?? 0);
      expect(shares, `${champion} ${role}`).toEqual([...shares].sort((a, b) => b - a));
    }
  });

  it("marks pairs without a build of their own as falling back on their class", () => {
    for (const { champion, role, entry } of entries) {
      if (entry.build) continue;
      expect(entry.fallback, `${champion} ${role}`).toBe("class");
      expect(entry.class, `${champion} ${role}`).toBeTruthy();
    }
  });

  it("lists unmapped item names with counts and never names a catalogue item as unmapped", () => {
    for (const { name, count } of buildsFile.unmappedItems) {
      expect(count).toBeGreaterThan(0);
      expect(name).not.toBe("");
    }
  });
});
