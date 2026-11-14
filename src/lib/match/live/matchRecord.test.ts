import { describe, expect, it } from "vitest";

import {
  buildMatchRecord,
  goldGaps,
  goldSeries,
  newGoldRecord,
  newKeyEventLog,
  recordCoverage,
  recordGold,
  recordKeyEvents,
  sampleOf,
  type RecordableState,
} from "./matchRecord";

const champion = (id: string, gold: number, spentGold = 0) => ({ id, gold, spentGold });

const state = (timeSec: number, blue: number, red: number, champions = [champion("a", 100, 400), champion("b", 50, 0)]): RecordableState => ({
  timeSec,
  stats: { blue: { gold: blue }, red: { gold: red } },
  champions,
});

describe("sampleOf", () => {
  it("records the team difference and each champion's gold earned (purse plus what was spent)", () => {
    expect(sampleOf(state(75, 2000, 1500))).toEqual({
      minute: 1,
      timeSec: 75,
      diff: 500,
      players: { a: 500, b: 50 },
    });
  });

  it("reads missing numbers as nothing recorded for that player, never as zero", () => {
    const sample = sampleOf({ timeSec: 10, stats: { blue: { gold: 10 }, red: { gold: 4 } }, champions: [{ id: "x" }, { id: "y", gold: 30 }] });
    expect(sample?.players).toEqual({ y: 30 });
  });

  it("gives nothing for a state with no time", () => {
    expect(sampleOf({ stats: {}, champions: [] })).toBeNull();
  });
});

describe("recordGold", () => {
  it("keeps the first observation of each minute and the latest one apart", () => {
    const record = newGoldRecord();
    recordGold(record, state(0, 0, 0));
    recordGold(record, state(30, 100, 0));
    recordGold(record, state(61, 500, 100));
    recordGold(record, state(119, 900, 200));
    expect(record.samples.map((s) => [s.minute, s.timeSec])).toEqual([
      [0, 0],
      [1, 61],
    ]);
    expect(record.latest?.timeSec).toBe(119);
  });

  it("ends the series on the real end of the match", () => {
    const record = newGoldRecord();
    recordGold(record, state(0, 0, 0));
    recordGold(record, state(61, 500, 100));
    recordGold(record, state(95, 700, 150));
    expect(goldSeries(record).map((s) => [s.timeSec, s.diff])).toEqual([
      [0, 0],
      [61, 400],
      [95, 550],
    ]);
  });

  it("does not repeat the latest observation when it is already the last sample", () => {
    const record = newGoldRecord();
    recordGold(record, state(0, 0, 0));
    expect(goldSeries(record)).toHaveLength(1);
  });
});

describe("goldGaps", () => {
  const at = (minute: number) => ({ minute, timeSec: minute * 60 + 2, diff: 0, players: {} });

  it("finds no gap in a watched match", () => {
    expect(goldGaps([at(0), at(1), at(2), at(3)])).toEqual([]);
  });

  it("marks the minutes a skip never showed as one gap and does not bridge them", () => {
    expect(goldGaps([at(0), at(1), at(2), at(27)])).toEqual([{ fromSec: 122, toSec: 1622, fromMinute: 2, toMinute: 27 }]);
  });
});

describe("recordKeyEvents", () => {
  const kill = { t: 140, text: "BLUE Paduck killed Supa", type: "kill", code: "champion_killed", data: { team: "blue", actor: "Paduck", target: "Supa" } };

  it("keeps kills, structures and objectives, in order, and ignores the rest", () => {
    const log = newKeyEventLog();
    recordKeyEvents(log, [
      { t: 30, text: "wave", type: "info", code: "wave_spawned" },
      kill,
      { t: 200, text: "bought", type: "info", code: "item_bought" },
      { t: 428, text: "BLUE secured the Ocean Dragon", type: "dragon", code: "dragon_secured", data: { team: "blue", dragonKind: "ocean" } },
      { t: 790, text: "BLUE voidgrub", type: "info", code: "voidgrub_secured", data: { team: "blue" } },
    ]);
    expect(log.events.map((e) => e.code)).toEqual(["champion_killed", "dragon_secured", "voidgrub_secured"]);
  });

  it("does not repeat an event the engine sends again in its rolling list", () => {
    const log = newKeyEventLog();
    recordKeyEvents(log, [kill]);
    recordKeyEvents(log, [kill, { ...kill, t: 150 }]);
    expect(log.events.map((e) => e.t)).toEqual([140, 150]);
  });

  it("keeps an event of an older state that has no code when its type is a key one", () => {
    const log = newKeyEventLog();
    recordKeyEvents(log, [{ t: 10, text: "RED destroyed a tower", type: "tower" }, { t: 11, text: "spawn", type: "spawn" }]);
    expect(log.events).toHaveLength(1);
  });
});

describe("recordCoverage", () => {
  const watched = [0, 1, 2, 3].map((minute) => ({ minute, timeSec: minute * 60, diff: 0, players: {} }));

  it("calls a watched match complete", () => {
    expect(recordCoverage(buildMatchRecord(watched, [], null))).toEqual({ goldPartial: false, gaps: [], eventsPartialFromSec: null });
  });

  it("calls a skipped match partial from the second it was skipped", () => {
    const skipped = [...watched.slice(0, 2), { minute: 25, timeSec: 1500, diff: 0, players: {} }];
    const coverage = recordCoverage(buildMatchRecord(skipped, [], 80));
    expect(coverage.goldPartial).toBe(true);
    expect(coverage.gaps).toHaveLength(1);
    expect(coverage.eventsPartialFromSec).toBe(80);
  });

  it("calls a match with no record at all partial too, so nothing reads as complete by default", () => {
    expect(recordCoverage(undefined)).toEqual({ goldPartial: true, gaps: [], eventsPartialFromSec: 0 });
  });
});
