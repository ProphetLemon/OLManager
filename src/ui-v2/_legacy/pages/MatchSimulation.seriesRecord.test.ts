import { describe, expect, it, vi } from "vitest";

import type { LolSimV1RuntimeState } from "@/ui-v2/_legacy/components/match/lol-prototype/backend/contract-v1";

import { buildLolMatchReport } from "./MatchSimulation";
import { guardReentry, recordSeriesGame, settleSeriesGame } from "./MatchSimulation.seriesRecord";

function runtime(winner: "blue" | "red"): LolSimV1RuntimeState {
  return {
    timeSec: 1500,
    running: false,
    winner,
    champions: [
      {
        id: "p1",
        name: "P1",
        team: "blue",
        role: "MID",
        kills: 4,
        deaths: 1,
        assists: 3,
        cs: 200,
        gold: 500,
        spentGold: 9000,
        damageDealt: 15000,
      },
      {
        id: "p2",
        name: "P2",
        team: "red",
        role: "MID",
        kills: 1,
        deaths: 4,
        assists: 0,
        cs: 180,
        gold: 300,
        spentGold: 7000,
        damageDealt: 8000,
      },
    ],
    stats: {
      blue: { kills: 4, towers: 6, dragons: 2, barons: 1, gold: 40000 },
      red: { kills: 1, towers: 1, dragons: 1, barons: 0, gold: 30000 },
    },
    events: [],
  } as unknown as LolSimV1RuntimeState;
}

describe("recordSeriesGame", () => {
  it("sends the game number with the report built the way the final one is", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const lolReport = buildLolMatchReport(runtime("blue"));

    const recorded = await recordSeriesGame({ record, gameNumber: 2, lolReport });

    expect(recorded).toBe(true);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({ gameNumber: 2, lolReport });
  });

  it("keeps each champion's own line in what it sends", async () => {
    const record = vi.fn().mockResolvedValue(undefined);

    await recordSeriesGame({
      record,
      gameNumber: 1,
      lolReport: buildLolMatchReport(runtime("red")),
    });

    const sent = record.mock.calls[0][0].lolReport;
    expect(sent.winner).toBe("red");
    expect(sent.champions.map((c: { id: string; kills: number }) => [c.id, c.kills])).toEqual([
      ["p1", 4],
      ["p2", 1],
    ]);
  });

  it("reports failure without throwing so the stage still advances", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const record = vi.fn().mockRejectedValue("series already decided");

    const recorded = await recordSeriesGame({
      record,
      gameNumber: 1,
      lolReport: buildLolMatchReport(runtime("blue")),
    });

    expect(recorded).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("buildLolMatchReport names the blue team", () => {
  it("sends the team that plays blue so a game with no champions is credited right", () => {
    const report = buildLolMatchReport(runtime("blue"), "team-away");

    expect(report.blueTeamId).toBe("team-away");
  });

  it("sends no blue team when the page does not know it", () => {
    const report = buildLolMatchReport(runtime("blue"));

    expect(report).not.toHaveProperty("blueTeamId");
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("guardReentry", () => {
  it("ignores a second call while the first is still running", () => {
    const busy = { current: false };
    const pending = deferred();
    const run = vi.fn(() => pending.promise);
    const guarded = guardReentry(busy, run);

    guarded();
    guarded();

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs again once the first call has finished", async () => {
    const busy = { current: false };
    const pending = deferred();
    const run = vi.fn(() => pending.promise);
    const guarded = guardReentry(busy, run);

    guarded();
    pending.resolve();
    await pending.promise;
    await Promise.resolve();
    guarded();

    expect(run).toHaveBeenCalledTimes(2);
  });

  it("lets go when the run throws before returning", () => {
    const busy = { current: false };
    const guarded = guardReentry(busy, () => {
      throw new Error("boom");
    });

    expect(() => guarded()).toThrow("boom");
    expect(busy.current).toBe(false);
  });
});

describe("settleSeriesGame", () => {
  it("records a game that does not decide the series, then settles", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const finalize = vi.fn().mockResolvedValue(true);
    const onSettled = vi.fn();
    const lolReport = buildLolMatchReport(runtime("blue"));

    await settleSeriesGame({ seriesComplete: false, gameNumber: 1, lolReport, record, finalize, onSettled });

    expect(record).toHaveBeenCalledWith({ gameNumber: 1, lolReport });
    expect(finalize).not.toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("finishes the match with the deciding game's number and does not record it", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const finalize = vi.fn().mockResolvedValue(true);
    const onSettled = vi.fn();
    const lolReport = buildLolMatchReport(runtime("blue"));

    await settleSeriesGame({ seriesComplete: true, gameNumber: 3, lolReport, record, finalize, onSettled });

    expect(finalize).toHaveBeenCalledWith(lolReport, 3);
    expect(record).not.toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("does not settle when finishing the match failed", async () => {
    const onSettled = vi.fn();

    await settleSeriesGame({
      seriesComplete: true,
      gameNumber: 1,
      lolReport: buildLolMatchReport(runtime("blue")),
      record: vi.fn(),
      finalize: vi.fn().mockResolvedValue(false),
      onSettled,
    });

    expect(onSettled).not.toHaveBeenCalled();
  });

  it("still settles when recording the game failed", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const onSettled = vi.fn();

    await settleSeriesGame({
      seriesComplete: false,
      gameNumber: 1,
      lolReport: buildLolMatchReport(runtime("blue")),
      record: vi.fn().mockRejectedValue("nope"),
      finalize: vi.fn(),
      onSettled,
    });

    expect(onSettled).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });
});

describe("a best-of-three the user wins 2-1, with every Continue clicked twice", () => {
  it("records games 1 and 2 once each and finishes with game 3", async () => {
    const busy = { current: false };
    const record = vi.fn().mockResolvedValue(undefined);
    const finalize = vi.fn().mockResolvedValue(true);
    const onSettled = vi.fn();
    const fullTime = guardReentry(busy, (gameNumber: number) =>
      settleSeriesGame({
        seriesComplete: gameNumber === 3,
        gameNumber,
        lolReport: buildLolMatchReport(runtime(gameNumber === 2 ? "red" : "blue")),
        record,
        finalize,
        onSettled,
      }),
    );

    for (const gameNumber of [1, 2, 3]) {
      fullTime(gameNumber);
      fullTime(gameNumber);
      await vi.waitFor(() => expect(onSettled).toHaveBeenCalledTimes(gameNumber));
    }

    expect(record.mock.calls.map(([args]) => args.gameNumber)).toEqual([1, 2]);
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(finalize.mock.calls[0][1]).toBe(3);
  });
});
