import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { GameStateData, TeamData } from "@/store/gameStore";
import { acceptChance, buildRivalRows, SCRIM_ODDS, winChance } from "./rivalOdds";

// A player's OVR is whatever the test says, so the odds can be worked out by hand.
vi.mock("../players/lolPlayerStats", () => ({
  calculateLolOvr: (player: { ovr: number }) => player.ovr,
}));

const TRAINING_RS = readFileSync(resolve(__dirname, "../../../src-tauri/crates/olm_core/src/training.rs"), "utf-8");

function numbers(source: string, pattern: RegExp): number[] {
  const match = source.match(pattern);
  expect(match, `${pattern} must match training.rs`).not.toBeNull();
  return match!.slice(1).map(Number);
}

describe("rival odds mirror the engine", () => {
  it("keeps the acceptance roll of training.rs", () => {
    const [base, perReputation, min, max] = numbers(
      TRAINING_RS,
      /let chance = \((\d+\.\d+) \+ diff \* (\d+\.\d+)\)\.clamp\((\d+\.\d+), (\d+\.\d+)\);/,
    );
    expect(SCRIM_ODDS.accept).toEqual({ base, perReputation, min, max });
  });

  it("keeps the win probability of training.rs", () => {
    const [gap, base, perStrength, min, max] = numbers(
      TRAINING_RS,
      /let diff = \(own_strength - opponent_strength\)\.clamp\(-(\d+)\.0, \d+\.0\);\s*let win_prob = \((\d+\.\d+) \+ diff \* (\d+\.\d+)\)\.clamp\((\d+\.\d+), (\d+\.\d+)\);/,
    );
    expect(SCRIM_ODDS.win).toEqual({ base, perStrength, min, max, strengthGap: gap });
  });
});

describe("acceptChance", () => {
  it("is a coin flip a little in favour of equal reputations and moves 0.6 points per reputation point", () => {
    expect(acceptChance(50, 50)).toBeCloseTo(0.52);
    expect(acceptChance(50, 40)).toBeCloseTo(0.58);
    expect(acceptChance(38, 44)).toBeCloseTo(0.484);
  });

  it("never leaves the 8% to 88% band", () => {
    expect(acceptChance(0, 200)).toBe(0.08);
    expect(acceptChance(200, 0)).toBe(0.88);
  });
});

describe("winChance", () => {
  it("is even at equal strength and moves 2.2 points per strength point", () => {
    expect(winChance(76, 76)).toBeCloseTo(0.5);
    expect(winChance(76, 79)).toBeCloseTo(0.434);
    expect(winChance(76, 71)).toBeCloseTo(0.61);
  });

  it("never leaves the 20% to 80% band", () => {
    expect(winChance(60, 90)).toBe(0.2);
    expect(winChance(90, 60)).toBe(0.8);
    expect(winChance(0, 200)).toBe(0.2);
  });
});

function club(id: string, name: string, extra: Record<string, unknown> = {}): TeamData {
  return { id, name, competition_id: "league", scrim_reputation: 50, ...extra } as unknown as TeamData;
}

function lineup(teamId: string, ovrs: number[]) {
  return ovrs.map((ovr, index) => ({ id: `${teamId}-${index}`, team_id: teamId, ovr }));
}

describe("buildRivalRows", () => {
  const game = {
    manager: { team_id: "mine" },
    teams: [
      club("mine", "Kestrel Vale", { active_lineup_ids: ["mine-0", "mine-1", "mine-2", "mine-3", "mine-4"] }),
      club("ember", "Ember Five", { scrim_reputation: 35 }),
      club("northglass", "Northglass", { scrim_reputation: 44 }),
      club("cinder", "Cinder Esports", { scrim_reputation: 41 }),
      club("abroad", "Abroad", { competition_id: "other" }),
    ],
    players: [
      ...lineup("mine", [76, 76, 76, 76, 76]),
      ...lineup("northglass", [79, 79, 79, 79, 80]),
      ...lineup("ember", [75, 75, 75, 75, 75]),
      ...lineup("cinder", [77, 77, 77, 77, 78]),
    ],
  } as unknown as GameStateData;
  const mine = game.teams[0];

  it("lists the other clubs of the competition, strongest first", () => {
    const rows = buildRivalRows(game, mine, 38);
    expect(rows.map((row) => row.name)).toEqual(["Northglass", "Cinder Esports", "Ember Five"]);
    expect(rows.map((row) => row.ovr)).toEqual([79, 77, 75]);
  });

  it("gives the chance to win from the unrounded strength of both lineups", () => {
    const [northglass, cinder, ember] = buildRivalRows(game, mine, 38);
    // 79.2 against 76: 0.5 - 3.2 * 0.022 = 0.4296
    expect(northglass.winPercent).toBe(43);
    // 77.2 against 76: 0.5 - 1.2 * 0.022 = 0.4736. Rounded to OVR 77 it would read 48.
    expect(cinder.winPercent).toBe(47);
    // 75 against 76: 0.5 + 1 * 0.022 = 0.522
    expect(ember.winPercent).toBe(52);
  });

  it("gives the chance that each rival takes a slot from the reputation of both clubs", () => {
    const [northglass, cinder, ember] = buildRivalRows(game, mine, 38);
    expect(northglass.acceptPercent).toBe(48);
    expect(cinder.acceptPercent).toBe(50);
    expect(ember.acceptPercent).toBe(54);
    expect(northglass.reputation).toBe(44);
  });
});
