import { describe, expect, it } from "vitest";

import { endSummary } from "./endSummary";

const finished = {
  winner: "red" as const,
  timeSec: 1923.7,
  stats: {
    blue: { kills: 11, towers: 3, dragons: 2, gold: 61200.4 },
    red: { kills: 19, towers: 9, dragons: 3, gold: 70350 },
  },
};

describe("endSummary", () => {
  it("is null until a nexus has fallen", () => {
    expect(endSummary(null)).toBeNull();
    expect(endSummary({ ...finished, winner: null })).toBeNull();
  });

  it("reads the totals of both sides and the duration in whole seconds", () => {
    const summary = endSummary(finished);
    expect(summary?.blue).toEqual({ kills: 11, towers: 3, dragons: 2, gold: 61200 });
    expect(summary?.red).toEqual({ kills: 19, towers: 9, dragons: 3, gold: 70350 });
    expect(summary?.durationSec).toBe(1923);
  });

  it("names the side that is ahead in gold and how far", () => {
    expect(endSummary(finished)?.lead).toEqual({ side: "red", amount: 9150 });
    const level = { ...finished, stats: { blue: { gold: 5 }, red: { gold: 5 } } };
    expect(endSummary(level)?.lead).toEqual({ side: null, amount: 0 });
  });

  it("is a victory or a defeat only for the manager's own side", () => {
    expect(endSummary(finished, "red")?.outcome).toBe("victory");
    expect(endSummary(finished, "blue")?.outcome).toBe("defeat");
    expect(endSummary(finished, null)?.outcome).toBeNull();
  });

  it("reads missing stats as zero", () => {
    expect(endSummary({ winner: "blue" })).toMatchObject({
      blue: { kills: 0, towers: 0, dragons: 0, gold: 0 },
      durationSec: 0,
    });
  });
});
