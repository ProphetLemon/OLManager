import { describe, expect, it } from "vitest";

import { chooseRoleOrder } from "@/ui-v2/_legacy/components/match/ChampionDraft";

const ROLES = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"];

// Pick order: Ahri (Mid only), Jarvan (Jungle, Top), Jinx (ADC), Thresh (Support), Aatrox (Top).
const HINTS: string[][] = [["MID"], ["JUNGLE", "TOP"], ["ADC"], ["SUPPORT"], ["TOP"]];

function offRoleCount(order: number[], hints: string[][]): number {
  return order.filter((selection, roleIdx) => !hints[selection].includes(ROLES[roleIdx])).length;
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("chooseRoleOrder", () => {
  it("keeps a mid-lane mage out of the jungle even when her jungle mastery is far higher", () => {
    // Ahri: 95 in jungle, 30 in mid. Jarvan: 40 in jungle, 80 in mid. The old +20 role bonus
    // made "Ahri jungle, Jarvan mid" (175) beat "Ahri mid, Jarvan jungle" (110).
    const mastery = [
      [50, 50, 50, 50, 50],
      [95, 40, 50, 50, 50],
      [30, 80, 50, 50, 50],
      [50, 50, 80, 50, 50],
      [50, 50, 50, 80, 50],
    ];
    const order = chooseRoleOrder(HINTS, (roleIdx, selectionIdx) => mastery[roleIdx][selectionIdx]);

    expect(order[ROLES.indexOf("JUNGLE")]).not.toBe(0);
    expect(offRoleCount(order, HINTS)).toBe(0);
  });

  it("never fields an off-role champion when a valid assignment exists, whatever the mastery", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const random = mulberry32(seed);
      const shuffled = [...ROLES].sort(() => random() - 0.5);
      const hints = shuffled.map((own) => {
        const extras = ROLES.filter((role) => role !== own && random() < 0.25);
        return [own, ...extras];
      });
      const mastery = ROLES.map(() => hints.map(() => Math.floor(random() * 100)));

      const order = chooseRoleOrder(hints, (roleIdx, selectionIdx) => mastery[roleIdx][selectionIdx]);

      expect(offRoleCount(order, hints), `seed ${seed}`).toBe(0);
      expect([...order].sort()).toEqual([0, 1, 2, 3, 4]);
    }
  });

  it("uses mastery to choose among valid assignments", () => {
    const flex = [["TOP", "MID"], ["MID", "TOP"], ["JUNGLE"], ["ADC"], ["SUPPORT"]];
    const mastery = (roleIdx: number, selectionIdx: number): number =>
      (selectionIdx === 0 && roleIdx === 2) || (selectionIdx === 1 && roleIdx === 0) ? 90 : 10;

    expect(chooseRoleOrder(flex, mastery)).toEqual([1, 2, 0, 3, 4]);
  });

  it("falls back to the fewest off-role champions when no valid assignment exists", () => {
    // Two mid-only champions: one of them has to leave the mid lane.
    const hints = [["MID"], ["MID"], ["JUNGLE"], ["ADC"], ["SUPPORT"]];
    const order = chooseRoleOrder(hints, () => 50);

    expect(offRoleCount(order, hints)).toBe(1);
    expect(order[ROLES.indexOf("JUNGLE")]).toBe(2);
    expect(order[ROLES.indexOf("ADC")]).toBe(3);
    expect(order[ROLES.indexOf("SUPPORT")]).toBe(4);
  });

  it("treats a champion without role data as fitting any role", () => {
    const hints = [[], ["MID"], ["JUNGLE"], ["ADC"], ["SUPPORT"]];
    const order = chooseRoleOrder(hints, () => 50);

    expect(order[ROLES.indexOf("MID")]).toBe(1);
    expect(order[ROLES.indexOf("TOP")]).toBe(0);
  });
});
