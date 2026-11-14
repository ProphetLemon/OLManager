import { describe, expect, it } from "vitest";
import { championDisplayName } from "./championNames";
import { getChampionCounterValue } from "./championRelationships";
import { MATCHUP_LIMIT, getChampionMatchups } from "./championMatchups";

describe("getChampionMatchups", () => {
  it("lists champions it counters as strong and champions that counter it as weak", () => {
    const { strongAgainst, weakAgainst } = getChampionMatchups("Malphite");
    expect(strongAgainst.length).toBeGreaterThan(0);
    for (const entry of strongAgainst) {
      expect(getChampionCounterValue("malphite", entry.championId)).toBe(entry.value);
    }
    for (const entry of weakAgainst) {
      expect(getChampionCounterValue(entry.championId, "malphite")).toBe(entry.value);
    }
  });

  it("includes the curated malphite over yasuo counter (value 3)", () => {
    const strong = getChampionMatchups("malphite", 200).strongAgainst;
    expect(strong.find((entry) => entry.championId === "yasuo")?.value).toBe(3);
    expect(getChampionMatchups("yasuo", 200).weakAgainst.find((e) => e.championId === "malphite")?.value).toBe(3);
  });

  it("sorts by value descending, then display name, and caps the lists", () => {
    const { strongAgainst, weakAgainst } = getChampionMatchups("ahri");
    for (const list of [strongAgainst, weakAgainst]) {
      expect(list.length).toBeLessThanOrEqual(MATCHUP_LIMIT);
      for (let i = 1; i < list.length; i += 1) {
        const [a, b] = [list[i - 1], list[i]];
        expect(a.value).toBeGreaterThanOrEqual(b.value);
        if (a.value === b.value) {
          expect(championDisplayName(a.championId).localeCompare(championDisplayName(b.championId))).toBeLessThanOrEqual(0);
        }
      }
    }
    expect(getChampionMatchups("malphite", 2).strongAgainst).toHaveLength(2);
  });

  it("resolves ids written in any common form", () => {
    expect(getChampionMatchups("Wukong", 200)).toEqual(getChampionMatchups("MonkeyKing", 200));
    expect(getChampionMatchups("Dr. Mundo", 200)).toEqual(getChampionMatchups("drmundo", 200));
  });

  it("returns empty lists for an unknown champion or a non-positive limit", () => {
    expect(getChampionMatchups("notachampion")).toEqual({ strongAgainst: [], weakAgainst: [] });
    expect(getChampionMatchups("malphite", 0)).toEqual({ strongAgainst: [], weakAgainst: [] });
  });
});
