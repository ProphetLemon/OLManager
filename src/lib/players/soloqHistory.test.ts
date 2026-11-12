import { describe, expect, it } from "vitest";
import type { SoloQDayKind, SoloQHistoryDay } from "@/api/types";
import { translateFromEnglish as t } from "@/test-i18n";
import {
  DAY_KIND_VISUALS,
  LEGEND_GLYPH_PATHS,
  buildChartModel,
  buildChips,
  buildIdleRuns,
  buildStory,
  causeName,
  clampIndex,
  dayIndexFromFraction,
  dayKindWord,
  displayKinds,
  focusLabel,
  glyphPath,
  idleCause,
  idleCauseOfFocus,
  normalizeHistory,
  offsetOf,
  rangeOptions,
  rangeStart,
  selectedDayStatus,
} from "./soloqHistory";

const FIRST = Date.UTC(2026, 1, 1);
const iso = (index: number) => new Date(FIRST + index * 86_400_000).toISOString().slice(0, 10);

function day(index: number, over: Partial<SoloQHistoryDay> = {}): SoloQHistoryDay {
  return { date: iso(index), lp: 1000, formula_lp: 1000, focus: "Scrims", kind: "Played", bank: 14, bank_max: 14, ...over };
}

function series(length: number, make: (index: number) => Partial<SoloQHistoryDay> = () => ({})): SoloQHistoryDay[] {
  return Array.from({ length }, (_, index) => day(index, make(index)));
}

const RESET = "MentalResetRecovery";
const REAL = { decay_per_idle_day: 50, recovery_per_played_day: 100 };

describe("normalizeHistory", () => {
  const raw = (over: Record<string, unknown> = {}) => ({
    player_id: "p1",
    followed: true,
    decay_mode: "Real",
    bank_days: 14,
    bank_max: 14,
    offset_lp: 0,
    days: [day(0)],
    ...over,
  });

  it("refuses anything that is not a history", () => {
    expect(normalizeHistory(null)).toBeNull();
    expect(normalizeHistory("nope")).toBeNull();
    expect(normalizeHistory({ clock: {}, players: [] })).toBeNull();
    expect(normalizeHistory(raw({ days: "x" }))).toBeNull();
  });

  it("keeps the newest 90 days, drops malformed ones and maps an empty focus to no team", () => {
    const days = [...series(100), { date: "2026-06-01", lp: 5, kind: "Nap" }, day(101, { focus: "" as never })];
    const history = normalizeHistory(raw({ days }));
    expect(history?.days).toHaveLength(90);
    expect(history?.days[history.days.length - 1].focus).toBeNull();
    expect(history?.days.every((entry) => entry.kind !== ("Nap" as SoloQDayKind))).toBe(true);
  });

  it("keeps each day's own bank maximum after the mode changed", () => {
    const days = [day(0, { bank: 14, bank_max: 14 }), day(1, { bank: 7, bank_max: 7 })];
    const history = normalizeHistory(raw({ bank_max: 7, days }));
    expect(history?.days.map((entry) => entry.bank_max)).toEqual([14, 7]);
    expect(history?.days.map((entry) => entry.bank)).toEqual([14, 7]);
  });

  it("clamps a day recorded without a maximum to the current one", () => {
    const old = { ...day(0, { bank: 14 }), bank_max: undefined };
    const history = normalizeHistory(raw({ bank_max: 7, days: [old] }));
    expect(history?.days[0]).toMatchObject({ bank: 7, bank_max: 7 });
  });

  it("reads an unknown decay mode as Off", () => {
    expect(normalizeHistory(raw({ decay_mode: "Brutal" }))?.decay_mode).toBe("Off");
  });
});

describe("idle cause", () => {
  it("is no team when the focus is null and Mental Reset for that focus", () => {
    expect(idleCause({ kind: "Idle", focus: null })).toBe("noTeam");
    expect(idleCause({ kind: "Decay", focus: null })).toBe("noTeam");
    expect(idleCause({ kind: "Idle", focus: RESET })).toBe("reset");
    expect(idleCause({ kind: "Decay", focus: RESET })).toBe("reset");
  });

  it("understands the legacy name of the recovery focus", () => {
    expect(idleCauseOfFocus("Recovery")).toBe("reset");
  });

  it("is none for any other focus and for days that are not idle", () => {
    expect(idleCause({ kind: "Idle", focus: "Scrims" })).toBeNull();
    expect(idleCause({ kind: "Played", focus: null })).toBeNull();
    expect(idleCause({ kind: "Match", focus: RESET })).toBeNull();
  });

  it("labels the cause for the player, never hard-coding Mental Reset", () => {
    expect(causeName("noTeam", t)).toBe("No team");
    expect(causeName("reset", t)).toBe("Mental Reset");
    expect(focusLabel(null, t)).toBe("No team");
    expect(focusLabel(RESET, t)).toBe("Mental Reset");
    expect(focusLabel("Scrims", t)).toBe("Ranked Grind");
  });
});

describe("day-kind mapping", () => {
  const KINDS: SoloQDayKind[] = ["Played", "Idle", "Decay", "Match", "Rest"];

  it("gives every kind its own shape, so colour is never the only cue", () => {
    const glyphs = KINDS.map((kind) => DAY_KIND_VISUALS[kind].glyph);
    expect(new Set(glyphs).size).toBe(KINDS.length);
    expect(DAY_KIND_VISUALS.Played).toEqual({ glyph: "bar-up", tone: "positive" });
    expect(DAY_KIND_VISUALS.Idle).toEqual({ glyph: "bar-down", tone: "warning" });
    expect(DAY_KIND_VISUALS.Decay).toEqual({ glyph: "triangle", tone: "negative" });
    expect(DAY_KIND_VISUALS.Match).toEqual({ glyph: "diamond", tone: "foreground" });
    expect(DAY_KIND_VISUALS.Rest).toEqual({ glyph: "dash", tone: "dim" });
  });

  it("draws every shape in the strip and in the legend", () => {
    const paths = KINDS.map((kind) => glyphPath(DAY_KIND_VISUALS[kind].glyph, 100, 8));
    expect(new Set(paths).size).toBe(KINDS.length);
    expect(new Set(Object.values(LEGEND_GLYPH_PATHS)).size).toBe(5);
  });

  it("names a day by its kind and, for idle days, its cause", () => {
    expect(dayKindWord({ kind: "Played", focus: "Scrims" }, true, t)).toBe("SoloQ day");
    expect(dayKindWord({ kind: "Match", focus: "Scrims" }, true, t)).toBe("Match day");
    expect(dayKindWord({ kind: "Rest", focus: "Scrims" }, true, t)).toBe("Rest day");
    expect(dayKindWord({ kind: "Decay", focus: null }, true, t)).toBe("Decay day (no team)");
    expect(dayKindWord({ kind: "Idle", focus: RESET }, true, t)).toBe("Idle, grace day (mental reset)");
    expect(dayKindWord({ kind: "Idle", focus: null }, false, t)).toBe("Idle day (no team)");
  });

  it("lets a match day inside a Mental Reset stretch carry the idle run through", () => {
    const days = [
      day(0, { kind: "Idle", focus: RESET }),
      day(1, { kind: "Match", focus: RESET }),
      day(2, { kind: "Idle", focus: RESET }),
      day(3, { kind: "Match", focus: "Scrims" }),
      day(4, { kind: "Played" }),
    ];
    expect(displayKinds(days)).toEqual(["Idle", "Idle", "Idle", null, null]);
  });

  it("builds one span per run, counting idle days only and summing the LP lost", () => {
    const days = [
      day(0),
      day(1, { kind: "Idle", focus: RESET, bank: 1 }),
      day(2, { kind: "Match", focus: RESET, bank: 1 }),
      day(3, { kind: "Idle", focus: RESET, bank: 0 }),
      day(4, { kind: "Decay", focus: RESET, bank: 0, lp: 950 }),
      day(5, { kind: "Decay", focus: RESET, bank: 0, lp: 900 }),
      day(6, { kind: "Played", lp: 1000 }),
    ];
    const runs = buildIdleRuns(days, 0);
    expect(runs).toEqual([
      { kind: "Idle", from: 1, to: 3, idleDays: 2, cause: "reset", lostLp: 0 },
      { kind: "Decay", from: 4, to: 5, idleDays: 2, cause: "reset", lostLp: 100 },
    ]);
  });
});

describe("range and stepper", () => {
  it("offers 30, 60 and 90 days, never more than the history", () => {
    expect(rangeOptions(90)).toEqual([30, 60, 90]);
    expect(rangeOptions(60)).toEqual([30, 60]);
    expect(rangeOptions(45)).toEqual([30, 45]);
    expect(rangeOptions(21)).toEqual([21]);
    expect(rangeOptions(0)).toEqual([]);
  });

  it("starts the visible window at the right day", () => {
    expect(rangeStart(90, 30)).toBe(60);
    expect(rangeStart(90, 90)).toBe(0);
    expect(rangeStart(21, 90)).toBe(0);
  });

  it("maps the pointer to the nearest day, however many days are shown", () => {
    expect(dayIndexFromFraction(0, 60, 89)).toBe(60);
    expect(dayIndexFromFraction(1, 60, 89)).toBe(89);
    expect(dayIndexFromFraction(0.5, 0, 88)).toBe(44);
    expect(dayIndexFromFraction(-3, 10, 20)).toBe(10);
    expect(dayIndexFromFraction(9, 10, 20)).toBe(20);
    expect(dayIndexFromFraction(Number.NaN, 10, 20)).toBe(10);
    expect(dayIndexFromFraction(0.7, 5, 5)).toBe(5);
  });

  it("keeps the selected day inside the range, and today when nothing is picked", () => {
    expect(clampIndex(null, 60, 89)).toBe(89);
    expect(clampIndex(10, 60, 89)).toBe(60);
    expect(clampIndex(95, 60, 89)).toBe(89);
  });
});

describe("story sentence", () => {
  const base = { bankMax: 14, language: "en", preset: REAL };

  it("says decay never started when nobody idled", () => {
    const days = series(30, (i) => ({ lp: 1000 + i }));
    const story = buildStory({ ...base, days, start: 0, decayOn: true }, t);
    expect(story.headline).toBe("No idle days in the last 30 days, so decay never started.");
    expect(story.sub).toBe("LP moved +29 LP over the range, from the formula alone.");
  });

  it("says the grace period held when idle days cost nothing", () => {
    const days = series(30, (i) => (i >= 20 && i < 25 ? { kind: "Idle", focus: RESET, bank: 14 - (i - 19) } : {}));
    const story = buildStory({ ...base, days, start: 0, decayOn: true }, t);
    expect(story.headline).toBe("5 idle days on Mental Reset, and the 14-day grace period held. No LP was lost.");
    expect(story.sub).toBe("Grace period now 14 of 14 days.");
  });

  it("states the cost and the way back when decay bit, naming a player with no team as such", () => {
    const days = series(30, (i) =>
      i >= 18
        ? { kind: "Decay", focus: null, bank: 0, formula_lp: 1000, lp: Math.max(0, 1000 - (i - 17) * 50) }
        : {},
    );
    const story = buildStory({ ...base, days, start: 0, decayOn: true }, t);
    expect(story.headline).toBe("12 idle days without a team cost up to 600 LP.");
    expect(story.sub).toBe("600 LP are still held back. Each SoloQ day wins back 100 LP, about 6 days to clear it.");
  });

  it("names both causes when both happened", () => {
    const days = series(30, (i) => {
      if (i === 10) return { kind: "Idle", focus: RESET };
      if (i === 12) return { kind: "Idle", focus: null };
      return {};
    });
    const story = buildStory({ ...base, days, start: 0, decayOn: true }, t);
    expect(story.headline).toBe("2 idle days on Mental Reset or without a team, and the 14-day grace period held. No LP was lost.");
  });

  it("says everything was won back after a recovery", () => {
    const days = series(30, (i) =>
      i >= 10 && i < 14 ? { kind: "Decay", focus: RESET, bank: 0, lp: 900 } : {},
    );
    const story = buildStory({ ...base, days, start: 0, decayOn: true }, t);
    expect(story.headline).toBe("4 idle days on Mental Reset cost up to 100 LP.");
    expect(story.sub).toBe("All of it has been won back.");
  });

  it("says idle days cost nothing extra while decay is off", () => {
    const days = series(30, (i) => (i < 3 ? { kind: "Idle", focus: RESET } : {}));
    const story = buildStory({ ...base, days, start: 0, decayOn: false, preset: null }, t);
    expect(story.headline).toBe("Decay is off. 3 idle days on Mental Reset cost no extra LP.");
  });

  it("reads only the visible range", () => {
    const days = series(60, (i) => (i < 10 ? { kind: "Idle", focus: RESET } : {}));
    const story = buildStory({ ...base, days, start: 30, decayOn: true }, t);
    expect(story.headline).toBe("No idle days in the last 30 days, so decay never started.");
  });
});

describe("selected day status", () => {
  const ctx = { decayOn: true, language: "en" };

  it("says what the day did, with the cause of the idleness", () => {
    expect(selectedDayStatus(day(3, { kind: "Idle", focus: null, bank: 5 }), null, ctx, t)).toBe(
      "Idle (no team), grace day: 5 days left. No LP lost yet.",
    );
    expect(selectedDayStatus(day(3, { kind: "Idle", focus: RESET, bank: 1 }), null, ctx, t)).toBe(
      "Idle (mental reset), grace day: 1 day left. No LP lost yet.",
    );
  });

  it("says how much a decay day cost, or that the floor was reached", () => {
    const before = day(2, { kind: "Decay", focus: RESET, bank: 0, lp: 950 });
    const cost = day(3, { kind: "Decay", focus: RESET, bank: 0, lp: 900 });
    expect(selectedDayStatus(cost, before, ctx, t)).toBe("Idle (mental reset), grace period used up. Lost 50 LP.");
    const floor = day(4, { kind: "Decay", focus: RESET, bank: 0, lp: 0 });
    const floorBefore = day(3, { kind: "Decay", focus: RESET, bank: 0, lp: 0 });
    expect(selectedDayStatus(floor, floorBefore, ctx, t)).toBe(
      "Idle (mental reset), grace period used up. LP is at the floor, Master 0 LP.",
    );
  });

  it("reads a played day's bank against that day's own maximum", () => {
    const harsh = day(3, { bank: 7, bank_max: 7 });
    expect(selectedDayStatus(harsh, null, ctx, t)).toBe("SoloQ day. Grace period 7 of 7 days.");
  });

  it("keeps match and rest days neutral", () => {
    expect(selectedDayStatus(day(1, { kind: "Match" }), null, ctx, t)).toBe(
      "Match day. Grace period and hidden offset stay as they were.",
    );
    expect(selectedDayStatus(day(1, { kind: "Rest" }), null, { ...ctx, decayOn: false }, t)).toBe("Rest day.");
  });
});

describe("hero chips", () => {
  const base: Parameters<typeof buildChips>[0] = {
    decayOn: true,
    preset: REAL,
    today: { kind: "Played", focus: "Scrims" },
    lp: 1000,
    bank: 14,
    bankMax: 14,
    offset: 0,
    language: "en",
  };
  const texts = (over: Partial<typeof base>) => buildChips({ ...base, ...over }, t).map((chip) => chip.text);

  it("reports a healthy player", () => {
    expect(texts({})).toEqual(["On the ladder today", "Grace period 14 of 14 days", "No LP lost to decay"]);
  });

  it("warns before the loss starts", () => {
    expect(texts({ today: { kind: "Idle", focus: RESET }, bank: 2 })).toEqual([
      "Idle (mental reset)",
      "Grace period low, 2 days left",
      "Loss starts after 3 more idle days",
    ]);
  });

  it("counts the idle days to the floor, and says when it has been reached", () => {
    expect(texts({ today: { kind: "Decay", focus: null }, bank: 0, lp: 300 })).toEqual([
      "Idle (no team)",
      "Grace period used up",
      "Floor in about 6 idle days",
    ]);
    expect(texts({ today: { kind: "Decay", focus: null }, bank: 0, lp: 0 })).toContain("At the floor: Master 0 LP");
  });

  it("says how long the way back is", () => {
    expect(texts({ offset: 300 })).toContain("300 LP held back, back in about 3 SoloQ days");
  });

  it("only says that decay is off when it is off", () => {
    expect(texts({ decayOn: false, preset: null })).toEqual(["Decay is off", "LP follows the formula every day"]);
    expect(texts({ decayOn: false, preset: null, today: { kind: "Idle", focus: null } })[1]).toBe(
      "Idle (no team), LP follows the formula",
    );
  });
});

describe("chart model", () => {
  const input = (days: SoloQHistoryDay[], decayOn = true) => ({
    days,
    start: 0,
    sel: days.length - 1,
    decayOn,
    language: "en",
    headline: "Headline.",
  });

  it("names the tiers and, when the axis reaches 0 LP, the floor", () => {
    const days = series(30, (i) => ({ lp: i < 15 ? 900 : 0, formula_lp: 900, kind: i < 15 ? "Played" : "Decay" }));
    const model = buildChartModel(input(days), t);
    expect(model.lo).toBe(0);
    expect(model.thresholds.map((line) => line.text)).toEqual([
      "Challenger from 1,300 LP",
      "Grandmaster from 800 LP",
      "Floor: Master 0 LP",
    ]);
    expect(model.axisNote).toBeNull();
  });

  it("does not draw a floor line, and says where the axis starts, when LP stays high", () => {
    const model = buildChartModel(input(series(30, () => ({ lp: 1000, formula_lp: 1000 }))), t);
    expect(model.lo).toBe(700);
    expect(model.thresholds.map((line) => line.id)).toEqual(["challenger", "grandmaster"]);
    expect(model.axisNote).toBe("Axis starts at 700 LP");
  });

  it("draws one strip mark per visible day, in the shape of its kind", () => {
    const kinds: SoloQDayKind[] = ["Played", "Idle", "Decay", "Match", "Rest"];
    const days = series(10, (i) => ({ kind: kinds[i % 5], focus: RESET }));
    const model = buildChartModel({ ...input(days), start: 5 }, t);
    expect(model.marks).toHaveLength(5);
    expect(model.marks.map((mark) => mark.glyph)).toEqual(
      days.slice(5).map((entry) => DAY_KIND_VISUALS[entry.kind].glyph),
    );
  });

  it("labels the idle span with its cause and the decay span with the LP lost", () => {
    const days = series(60, (i) => {
      if (i >= 10 && i < 40) return { kind: "Idle", focus: RESET };
      if (i >= 40 && i < 50) return { kind: "Decay", focus: RESET, formula_lp: 1000, lp: 1000 - (i - 39) * 50 };
      return {};
    });
    const model = buildChartModel(input(days), t);
    expect(model.spans.map((span) => span.kind)).toEqual(["Idle", "Decay"]);
    expect(model.spans[0].label).toBe("Mental Reset, 30 days");
    expect(model.spans[1].label).toBe("Decay −500 LP");
    expect(model.decayPath).not.toBe("");
  });

  it("draws the formula line only while decay is on", () => {
    const days = series(10, () => ({}));
    expect(buildChartModel(input(days, true), t).formulaPath).not.toBe("");
    expect(buildChartModel(input(days, false), t).formulaPath).toBe("");
  });

  it("reads Master 0 LP in the accessible description when the player is at the floor", () => {
    const days = series(10, (i) => (i === 9 ? { lp: 0 } : {}));
    expect(buildChartModel(input(days), t).label).toContain("Now Master 0 LP.");
  });

  it("holds a single day", () => {
    const model = buildChartModel(input(series(1)), t);
    expect(model.marks).toHaveLength(1);
    expect(model.mainPath).toMatch(/^M[\d. ]+$/);
  });
});

describe("offset", () => {
  it("is the formula LP minus the displayed LP, and never negative", () => {
    expect(offsetOf({ lp: 700, formula_lp: 1000 })).toBe(300);
    expect(offsetOf({ lp: 0, formula_lp: 520 })).toBe(520);
    expect(offsetOf({ lp: 1000, formula_lp: 900 })).toBe(0);
  });
});
