import { beforeEach, describe, expect, it } from "vitest";

import { currentLocation } from "@/lib/dashboard/profileNavigation";
import { useCallCacheStore } from "./callCacheStore";
import { useDashboardLocationStore } from "./dashboardLocationStore";
import { useGameStore } from "./gameStore";
import { useNavMemoryStore } from "./navMemoryStore";
import { usePaletteStore } from "./paletteStore";
import { resetSessionNavigation } from "./sessionReset";
import { useTabUiStore } from "./tabUiStore";

const dirtyTabUi = () =>
  useTabUiStore.setState((s) => ({
    tabs: {
      ...s.tabs,
      transfers: { ...s.tabs.transfers, view: "market", search: "faker", page: 3 },
      scouting: { ...s.tabs.scouting, searchQuery: "caps" },
      scrims: { dayResults: { date: "2025-06-19", bySlot: {} } },
    },
  }));

/** One save's navigation: a remembered group, tab UI, a location with history, and blockers. */
function dirtySession() {
  dirtyTabUi();
  useNavMemoryStore.getState().rememberTab("Transfers");
  usePaletteStore.setState({ open: true, openerId: "util:go" });
  useDashboardLocationStore.getState().go({ kind: "tab", tab: "Squad" });
  useDashboardLocationStore.getState().go({ kind: "player", id: "p1" });
  useCallCacheStore.getState().setLastBlockers({
    blockers: [{ id: "incomplete_lineup", severity: "warn", text: "Lineup", tab: "Squad" }],
    canContinueAnyway: false,
    date: "2025-06-19",
  });
}

function expectFreshSession() {
  expect(useTabUiStore.getState().tabs.transfers.view).toBe("my_list");
  expect(useTabUiStore.getState().tabs.scouting.searchQuery).toBe("");
  expect(useTabUiStore.getState().tabs.scrims.dayResults).toBeNull();
  expect(useNavMemoryStore.getState().lastByGroup).toEqual({});
  expect(usePaletteStore.getState()).toMatchObject({ open: false, openerId: null });
  expect(useNavMemoryStore.getState().openGroups).toEqual({});
  const { nav, recent } = useDashboardLocationStore.getState();
  expect(currentLocation(nav)).toEqual({
    tab: "Home",
    playerId: null,
    teamId: null,
    staffId: null,
    championKey: null,
  });
  expect(nav.navHistory).toEqual([]);
  expect(recent).toEqual([]);
  expect(useCallCacheStore.getState().lastBlockers).toBeNull();
}

describe("session reset (R22)", () => {
  beforeEach(() => resetSessionNavigation());

  it("drops the previous save's tab UI state when a new game or a load activates a game", () => {
    dirtyTabUi();
    useGameStore.getState().setGameActive(true, "Coach");
    const { transfers, scouting } = useTabUiStore.getState().tabs;
    expect(transfers.view).toBe("my_list");
    expect(transfers.search).toBe("");
    expect(transfers.page).toBe(0);
    expect(scouting.searchQuery).toBe("");
  });

  it("resetSessionNavigation() resets every navigation store", () => {
    dirtySession();
    resetSessionNavigation();
    expectFreshSession();
  });

  it("runs on a new game or a load", () => {
    dirtySession();
    useGameStore.getState().setGameActive(true, "Coach");
    expectFreshSession();
  });

  it("runs when the game is cleared", () => {
    dirtySession();
    useGameStore.getState().clearGame();
    expectFreshSession();
  });
});
