import { describe, expect, it, vi } from "vitest";

import { finalizeLiveMatch } from "@/ui-v2/_legacy/pages/MatchSimulation.finalize";
import type { GameStateData } from "@/store/gameStore";

const game = { id: "g" } as unknown as GameStateData;
const picksGame = { id: "g-picks" } as unknown as GameStateData;

describe("finalizeLiveMatch", () => {
  it("finalizes and stores the updated game on success", async () => {
    const onGame = vi.fn();
    const ok = await finalizeLiveMatch({
      finish: () => Promise.resolve({ game }),
      recordPicks: () => Promise.resolve(picksGame),
      refetchGame: () => Promise.resolve(game),
      onGame,
    });
    expect(ok).toBe(true);
    expect(onGame).toHaveBeenNthCalledWith(1, game);
    expect(onGame).toHaveBeenNthCalledWith(2, picksGame);
  });

  it("treats 'No active live match' as already finalized", async () => {
    const onGame = vi.fn();
    const ok = await finalizeLiveMatch({
      finish: () => Promise.reject("No active live match"),
      recordPicks: null,
      refetchGame: () => Promise.resolve(game),
      onGame,
    });
    expect(ok).toBe(true);
    expect(onGame).toHaveBeenCalledTimes(1);
    expect(onGame).toHaveBeenCalledWith(game);
  });

  it("still advances and logs when the already-finalized refetch fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const onGame = vi.fn();
    const ok = await finalizeLiveMatch({
      finish: () => Promise.reject("No active live match"),
      recordPicks: null,
      refetchGame: () => Promise.reject(new Error("offline")),
      onGame,
    });
    expect(ok).toBe(true);
    expect(onGame).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("keeps real finish errors visible and reports failure", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const recordPicks = vi.fn();
    const ok = await finalizeLiveMatch({
      finish: () => Promise.reject(new Error("database is locked")),
      recordPicks,
      refetchGame: vi.fn(),
      onGame: vi.fn(),
    });
    expect(ok).toBe(false);
    expect(recordPicks).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("does not block the stage change when the picks call fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const onGame = vi.fn();
    const ok = await finalizeLiveMatch({
      finish: () => Promise.resolve({ game }),
      recordPicks: () => Promise.reject(new Error("picks failed")),
      refetchGame: vi.fn(),
      onGame,
    });
    expect(ok).toBe(true);
    expect(onGame).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
