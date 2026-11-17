import { beforeEach, describe, expect, it } from "vitest";
import { useGameStore } from "./gameStore";
import { isGroupOpen } from "@/ui-v2/shell/navModel";
import { useNavMemoryStore } from "./navMemoryStore";

describe("navMemoryStore", () => {
  beforeEach(() => useNavMemoryStore.getState().resetNavMemory());

  it("starts empty", () => {
    expect(useNavMemoryStore.getState().activeTab).toBeNull();
    expect(useNavMemoryStore.getState().lastByGroup).toEqual({});
    expect(useNavMemoryStore.getState().openGroups).toEqual({});
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

  describe("openGroups", () => {
    const open = (id: "club" | "market" | "world") => isGroupOpen(useNavMemoryStore.getState().openGroups, id);

    it("reads defaultOpen for an unset entry: Club open, Market and World closed", () => {
      expect([open("club"), open("market"), open("world")]).toEqual([true, false, false]);
      expect(useNavMemoryStore.getState().openGroups).toEqual({});
    });

    it("toggleGroup flips the effective state, starting from the default", () => {
      const { toggleGroup } = useNavMemoryStore.getState();
      toggleGroup("club");
      expect(open("club")).toBe(false);
      toggleGroup("club");
      expect(open("club")).toBe(true);
      toggleGroup("market");
      expect(open("market")).toBe(true);
      expect(open("world")).toBe(false);
    });

    it("rememberTab opens the group of the tab and closes nothing", () => {
      const { toggleGroup, rememberTab } = useNavMemoryStore.getState();
      toggleGroup("club"); // the user collapsed Club
      rememberTab("Transfers");
      expect(open("market")).toBe(true);
      expect(open("club")).toBe(false);
      expect(open("world")).toBe(false);
    });

    it("rememberTab reopens a group the user had collapsed when its tab becomes active", () => {
      const { toggleGroup, rememberTab } = useNavMemoryStore.getState();
      toggleGroup("club");
      rememberTab("Squad");
      expect(open("club")).toBe(true);
    });

    it("rememberTab on a direct stop changes no group", () => {
      useNavMemoryStore.getState().rememberTab("Inbox");
      expect(useNavMemoryStore.getState().openGroups).toEqual({});
    });

    it("resetNavMemory restores the defaults, including club: true", () => {
      const { toggleGroup, rememberTab, resetNavMemory } = useNavMemoryStore.getState();
      toggleGroup("club");
      rememberTab("Players");
      resetNavMemory();
      expect(useNavMemoryStore.getState().openGroups).toEqual({});
      expect([open("club"), open("market"), open("world")]).toEqual([true, false, false]);
    });
  });
});
