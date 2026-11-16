import { describe, expect, it, vi } from "vitest";

import type { LolSimV1RuntimeState } from "@/ui-v2/_legacy/components/match/lol-prototype/backend/contract-v1";

import { buildLolMatchReport } from "./MatchSimulation";
import { recordSeriesGame } from "./MatchSimulation.seriesRecord";

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
