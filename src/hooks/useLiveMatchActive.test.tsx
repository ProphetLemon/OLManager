import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import { autoSave, setLiveMatchActive } from "@/services/autoSave";
import { useGameStore, type GameStateData } from "@/store/gameStore";
import matchSimulationSource from "@/ui-v2/_legacy/pages/MatchSimulation.tsx?raw";
import { useLiveMatchActive } from "./useLiveMatchActive";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve()) }));

describe("useLiveMatchActive", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockClear();
    setLiveMatchActive(false);
    useGameStore.setState({ gameState: { id: "g" } as unknown as GameStateData, isDirty: true });
  });

  it("blocks auto-saves while the screen is mounted and lets them through once it is gone", async () => {
    const { unmount } = renderHook(() => useLiveMatchActive());
    await autoSave();
    expect(invoke).not.toHaveBeenCalled();

    unmount();
    await autoSave();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("is used by the live match screen", () => {
    expect(matchSimulationSource).toMatch(/\buseLiveMatchActive\(\);/);
  });
});
