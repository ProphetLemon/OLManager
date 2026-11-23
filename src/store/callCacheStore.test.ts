import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useCallCacheStore } from "./callCacheStore";
import { useGameStore } from "./gameStore";

const blockers = [{ id: "incomplete_lineup", severity: "warn", text: "Lineup", tab: "Squad" }];

describe("callCacheStore", () => {
  beforeEach(() => useCallCacheStore.getState().reset());

  it("starts empty", () => {
    expect(useCallCacheStore.getState().lastBlockers).toBeNull();
  });

  it("keeps lastBlockers across an unmount and remount", () => {
    const first = renderHook(() => useCallCacheStore((s) => s.lastBlockers));
    useCallCacheStore
      .getState()
      .setLastBlockers({ blockers, canContinueAnyway: true, date: "2025-06-19" });
    first.unmount();

    const second = renderHook(() => useCallCacheStore((s) => s.lastBlockers));
    expect(second.result.current).toEqual({ blockers, canContinueAnyway: true, date: "2025-06-19" });
  });

  it("takes an updater that sees the previous value", () => {
    const { setLastBlockers } = useCallCacheStore.getState();
    setLastBlockers({ blockers, canContinueAnyway: false, date: "2025-06-19" });
    setLastBlockers((prev) => (prev ? { ...prev, canContinueAnyway: true } : prev));
    expect(useCallCacheStore.getState().lastBlockers?.canContinueAnyway).toBe(true);
  });

  it("empties on reset()", () => {
    useCallCacheStore
      .getState()
      .setLastBlockers({ blockers, canContinueAnyway: false, date: "2025-06-19" });
    useCallCacheStore.getState().reset();
    expect(useCallCacheStore.getState().lastBlockers).toBeNull();
  });

  it("empties when the game is cleared, and when a new game or a load activates one", () => {
    const { setLastBlockers } = useCallCacheStore.getState();
    setLastBlockers({ blockers, canContinueAnyway: false, date: "2025-06-19" });
    useGameStore.getState().clearGame();
    expect(useCallCacheStore.getState().lastBlockers).toBeNull();

    setLastBlockers({ blockers, canContinueAnyway: false, date: "2025-06-19" });
    useGameStore.getState().setGameActive(true, "Coach");
    expect(useCallCacheStore.getState().lastBlockers).toBeNull();
  });
});
