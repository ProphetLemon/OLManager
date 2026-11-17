import { beforeEach, describe, expect, it } from "vitest";
import { useGameStore } from "./gameStore";
import { useNavMemoryStore } from "./navMemoryStore";

describe("navMemoryStore", () => {
  beforeEach(() => useNavMemoryStore.getState().resetNavMemory());

  it("starts empty", () => {
    expect(useNavMemoryStore.getState().activeTab).toBeNull();
    expect(useNavMemoryStore.getState().lastByGroup).toEqual({});
  });

  it("remembers the active tab and, for a grouped tab, the last tab of its group", () => {
    const { rememberTab } = useNavMemoryStore.getState();
    rememberTab("Squad");
    rememberTab("Tactics");
    rememberTab("Transfers");
    const state = useNavMemoryStore.getState();
    expect(state.activeTab).toBe("Transfers");
    expect(state.lastByGroup.club).toBe("Tactics");
    expect(state.lastByGroup.market).toBe("Transfers");
  });

  it("keeps a direct stop out of the group memory but still remembers it as active", () => {
    const { rememberTab } = useNavMemoryStore.getState();
    rememberTab("Squad");
    rememberTab("Inbox");
    const state = useNavMemoryStore.getState();
    expect(state.activeTab).toBe("Inbox");
    expect(state.lastByGroup).toEqual({ club: "Squad" });
  });

  it("resets when the game is cleared", () => {
    useNavMemoryStore.getState().rememberTab("Squad");
    useGameStore.getState().clearGame();
    expect(useNavMemoryStore.getState().activeTab).toBeNull();
    expect(useNavMemoryStore.getState().lastByGroup).toEqual({});
  });

  it("resets when a new game or a load activates a game", () => {
    useNavMemoryStore.getState().rememberTab("Squad");
    useGameStore.getState().setGameActive(true, "Coach");
    expect(useNavMemoryStore.getState().activeTab).toBeNull();
    expect(useNavMemoryStore.getState().lastByGroup).toEqual({});
  });
});
