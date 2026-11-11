// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MEASURED_ALWAYS, MEASURED_WITH_GAMES, MIN_GAMES_FOR_SOFT, SKILL_CARRY, deriveAttributes } from "../../../scripts/stats/lib/attributes.mjs";
import { ATTRIBUTE_NAMES, calculateLolOvr } from "../../../scripts/stats/lib/game-world.mjs";

type Attrs = Record<string, number>;
const flat = (n: number): Attrs => Object.fromEntries(ATTRIBUTE_NAMES.map((name) => [name, n]));
const clampOvr = (v: number) => Math.min(99, Math.max(1, Math.round(v)));

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("constants", () => {
  it("documents which attributes are measured", () => {
    expect([...MEASURED_ALWAYS]).toEqual(["mechanics", "laning", "teamfighting"]);
    expect([...MEASURED_WITH_GAMES]).toEqual(["macro_play", "consistency", "champion_pool"]);
    expect(MIN_GAMES_FOR_SOFT).toBe(25);
    expect(SKILL_CARRY).toBe(0.75);
  });
});

describe("deriveAttributes", () => {
  it("raises measured attributes by the full delta and carries 75% to the unmeasured ones", () => {
    const authored = flat(60);
    const r = deriveAttributes({ attributes: authored, authoredOvr: 60, finalOvr: 66, games: 100, potentialBase: 70 });
    expect(r.measured).toEqual(["mechanics", "laning", "teamfighting", "macro_play", "consistency", "champion_pool"]);
    expect(calculateLolOvr(r.attributes)).toBe(66);
    for (const name of r.measured) expect(r.attributes[name]).toBeGreaterThanOrEqual(r.attributes.shotcalling);
    expect(r.attributes.shotcalling).toBeGreaterThan(60);
    expect(r.attributes.shotcalling).toBeLessThan(66);
    expect(r.newOvr).toBe(66);
    expect(r.potentialFloor).toBe(70);
  });

  it("lowers attributes for a negative delta", () => {
    const r = deriveAttributes({ attributes: flat(80), authoredOvr: 80, finalOvr: 74, games: 100, potentialBase: 85 });
    expect(calculateLolOvr(r.attributes)).toBe(74);
    expect(Object.values(r.attributes).every((v) => v < 80)).toBe(true);
    expect(r.potentialFloor).toBe(85);
  });

  it("gates macro_play, consistency and champion_pool on the minimum number of games", () => {
    const few = deriveAttributes({ attributes: flat(60), authoredOvr: 60, finalOvr: 70, games: MIN_GAMES_FOR_SOFT - 1, potentialBase: 60 });
    expect(few.measured).toEqual(["mechanics", "laning", "teamfighting"]);
    expect(few.attributes.mechanics).toBeGreaterThan(few.attributes.macro_play);
    expect(calculateLolOvr(few.attributes)).toBe(70);
    const enough = deriveAttributes({ attributes: flat(60), authoredOvr: 60, finalOvr: 70, games: MIN_GAMES_FOR_SOFT, potentialBase: 60 });
    expect(enough.measured).toHaveLength(6);
  });

  it("floors potential at the new OVR", () => {
    const r = deriveAttributes({ attributes: flat(60), authoredOvr: 60, finalOvr: 72, games: 100, potentialBase: 65 });
    expect(r.potentialFloor).toBe(72);
  });

  it("returns the authored attributes when nothing changes", () => {
    const authored = { ...flat(70), mechanics: 71 };
    const r = deriveAttributes({ attributes: authored, authoredOvr: calculateLolOvr(authored), finalOvr: calculateLolOvr(authored), games: 100, potentialBase: 70 });
    expect(r.attributes).toEqual(authored);
  });

  it("keeps every attribute in 1..99 and still hits the OVR at the edges", () => {
    const high = deriveAttributes({ attributes: flat(97), authoredOvr: 97, finalOvr: 99.4, games: 100, potentialBase: 99 });
    expect(Object.values(high.attributes).every((v) => v >= 1 && v <= 99)).toBe(true);
    expect(calculateLolOvr(high.attributes)).toBe(99);
    const low = deriveAttributes({ attributes: flat(3), authoredOvr: 3, finalOvr: 0.2, games: 100, potentialBase: 10 });
    expect(Object.values(low.attributes).every((v) => v >= 1 && v <= 99)).toBe(true);
    expect(calculateLolOvr(low.attributes)).toBe(1);
  });

  it("reaches the target through the unmeasured attributes when the measured ones are saturated", () => {
    const authored = { ...flat(60), mechanics: 99, laning: 99, teamfighting: 99, macro_play: 99, consistency: 99, champion_pool: 99 };
    const authoredOvr = calculateLolOvr(authored);
    const r = deriveAttributes({ attributes: authored, authoredOvr, finalOvr: 95, games: 100, potentialBase: 90 });
    expect(calculateLolOvr(r.attributes)).toBe(95);
  });

  it("always yields round(mean of 9) == round(finalOvr), over many seeded cases", () => {
    const rand = mulberry32(20260511);
    for (let i = 0; i < 4000; i += 1) {
      const attributes: Attrs = Object.fromEntries(ATTRIBUTE_NAMES.map((name) => [name, 1 + Math.floor(rand() * 99)]));
      const authoredOvr = calculateLolOvr(attributes);
      const finalOvr = Math.min(99.49, Math.max(0.6, authoredOvr + (rand() - 0.5) * 40));
      const games = Math.floor(rand() * 120);
      const r = deriveAttributes({ attributes, authoredOvr, finalOvr, games, potentialBase: 1 + Math.floor(rand() * 99) });
      expect(calculateLolOvr(r.attributes), JSON.stringify({ attributes, authoredOvr, finalOvr, games })).toBe(clampOvr(finalOvr));
      expect(Object.values(r.attributes).every((v) => Number.isInteger(v) && v >= 1 && v <= 99)).toBe(true);
      expect(r.potentialFloor).toBeGreaterThanOrEqual(r.newOvr);
      expect(r.potentialFloor).toBeLessThanOrEqual(99);
      expect(deriveAttributes({ attributes, authoredOvr, finalOvr, games, potentialBase: 1 })).toMatchObject({ attributes: r.attributes });
    }
  });
});
