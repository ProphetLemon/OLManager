import { describe, expect, it } from "vitest";

import type { DraftMatchResult } from "@/ui-v2/_legacy/components/match/draftResultSimulator";

import { buildScoreboard } from "./postGame";
import { championKeysOf, hasPlayedOutState, postGameStateFromResult, timelineFromResult } from "./draftResultState";

const player = (side: "blue" | "red", playerId: string, role: "TOP" | "JUNGLE" | "MID" | "ADC" | "SUPPORT", over = {}) => ({
  side,
  playerId,
  playerName: playerId.toUpperCase(),
  role,
  championId: `champ-${playerId}`,
  kills: 2,
  deaths: 1,
  assists: 3,
  gold: 500,
  spentGold: 9000,
  damageDealt: 12000,
  rating: 7,
  ...over,
});

const objectives = (towers: number, heralds: number) => ({ voidgrubs: 2, dragons: 3, dragonSoul: false, elderDragons: 0, heralds, barons: 1, towers, inhibitors: 1 });

const result = {
  winnerSide: "blue",
  durationMinutes: 28,
  blueKills: 14,
  redKills: 9,
  mvp: player("blue", "b-mid", "MID"),
  playerResults: [player("blue", "b-mid", "MID"), player("blue", "b-top", "TOP"), player("red", "r-sup", "SUPPORT"), player("red", "r-jgl", "JUNGLE")],
  goldDiffTimeline: [],
  timelineEvents: [
    { minute: 3, side: "blue", type: "first_blood", label: "First Blood" },
    { minute: 9, side: "red", type: "dragon", label: "Dragon" },
    { minute: 12, side: "blue", type: "nexus_turret", label: "Nexus turret" },
    { minute: 28, side: "blue", type: "nexus", label: "Nexus" },
  ],
  objectives: { blue: objectives(8, 1), red: objectives(2, 0) },
  power: { blue: 1, red: 1, diff: 0, autoWin: false, winProbBlue: 50 },
} as unknown as DraftMatchResult;

describe("postGameStateFromResult", () => {
  const state = postGameStateFromResult(result);
  const board = buildScoreboard(state);

  it("reads the winner, the length and the kills of the result", () => {
    expect(state).toMatchObject({ winner: "blue", timeSec: 28 * 60, mvpId: "b-mid" });
    expect(board.totals.blue).toMatchObject({ kills: 14, towers: 8, dragons: 3, barons: 1, grubs: 2, heralds: 1 });
    expect(board.totals.red).toMatchObject({ kills: 9, towers: 2, heralds: 0 });
  });

  it("puts the players in lane order, with the gold earned and the damage the result recorded", () => {
    expect(board.rows.blue.map((row) => row.role)).toEqual(["TOP", "MID"]);
    expect(board.rows.red.map((row) => row.role)).toEqual(["JGL", "SUP"]);
    expect(board.rows.blue[1]).toMatchObject({ gold: 9500, damage: 12000, kills: 2 });
  });

  it("leaves out what a simulation does not know: level, CS, items, spells", () => {
    expect(board.rows.blue[0]).toMatchObject({ level: null, cs: null, items: null, spells: [] });
  });

  it("names the MVP the simulation chose", () => {
    expect(board.mvp?.id).toBe("b-mid");
  });

  it("has no record: no gold series and no key events", () => {
    expect(state.matchRecord).toBeUndefined();
  });

  it("gives the champion each player picked, for the portraits", () => {
    expect(championKeysOf(result)).toEqual({ "b-mid": "champ-b-mid", "b-top": "champ-b-top", "r-sup": "champ-r-sup", "r-jgl": "champ-r-jgl" });
  });
});

describe("timelineFromResult", () => {
  const entries = timelineFromResult(result);

  it("turns the simulator's events into timeline entries in time order, with the key of each one's text", () => {
    expect(entries.map((entry) => [entry.t, entry.kind, entry.side, entry.labelKey])).toEqual([
      [180, "firstBlood", "blue", "match.draftResult.timelineEvents.firstBlood"],
      [540, "dragon", "red", "match.draftResult.timelineEvents.dragon"],
      [720, "tower", "blue", "match.draftResult.timelineEvents.nexusTurret"],
      [1680, "nexus", "blue", "match.draftResult.timelineEvents.nexus"],
    ]);
    expect(entries.filter((entry) => entry.big).map((entry) => entry.kind)).toEqual(["firstBlood", "nexus"]);
  });
});

describe("hasPlayedOutState", () => {
  it("is true for a state with champions and false for the empty one a simulation hands on", () => {
    expect(hasPlayedOutState({ champions: [{ id: "a" }] } as never)).toBe(true);
    expect(hasPlayedOutState({ champions: [] } as never)).toBe(false);
    expect(hasPlayedOutState(null)).toBe(false);
  });
});
