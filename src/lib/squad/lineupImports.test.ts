import { describe, expect, it } from "vitest";

import type { PlayerData } from "@/store/gameStore";
import { buildActiveLineupIds } from "@/lib/squad/helpers";

const make = (
  id: string,
  position: PlayerData["position"],
  isImport = false,
  ovr = 60,
): PlayerData =>
  ({
    id,
    match_name: id,
    position,
    natural_position: position,
    is_import: isImport,
    attributes: {
      mechanics: ovr,
      laning: ovr,
      teamfighting: ovr,
      macro_play: ovr,
      consistency: ovr,
      shotcalling: ovr,
      champion_pool: ovr,
      discipline: ovr,
      mental_resilience: ovr,
    },
    lol_ovr: ovr,
  }) as unknown as PlayerData;

describe("buildActiveLineupIds import rule", () => {
  const roster = [
    make("top", "TOP", true, 90),
    make("jng", "JUNGLE", true, 85),
    make("mid", "MID", true, 80),
    make("adc", "ADC", false, 70),
    make("sup", "SUPPORT", false, 70),
    make("mid2", "MID", false, 60),
    make("jng2", "JUNGLE", false, 40),
  ];

  it("never auto-builds a five with three imports", () => {
    const ids = buildActiveLineupIds(roster, []);
    expect(ids.filter((id) => roster.find((p) => p.id === id)?.is_import)).toHaveLength(2);
    expect(ids).toHaveLength(5);
    expect(ids.every(Boolean)).toBe(true);
  });

  it("repairs a saved lineup that holds three imports with the cheapest swap", () => {
    const ids = buildActiveLineupIds(roster, ["top", "jng", "mid", "adc", "sup"]);
    // MID loses 20 rating points, JUNGLE would lose 45: the mid swap wins.
    expect(ids).toEqual(["top", "jng", "mid2", "adc", "sup"]);
  });

  it("keeps a valid saved lineup untouched", () => {
    const ids = buildActiveLineupIds(roster, ["top", "jng", "mid2", "adc", "sup"]);
    expect(ids).toEqual(["top", "jng", "mid2", "adc", "sup"]);
  });
});
