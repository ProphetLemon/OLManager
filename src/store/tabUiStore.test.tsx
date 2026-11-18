import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useGameStore } from "./gameStore";
import {
  DEFAULT_TAB_UI_STATES,
  useTabUiField,
  useTabUiStore,
  useValidTabUiField,
} from "./tabUiStore";

describe("tabUiStore", () => {
  beforeEach(() => useTabUiStore.getState().resetTabUi());

  it("keeps transfers and scouting state across unmount/remount", () => {
    const first = renderHook(() => ({
      view: useTabUiField("transfers", "view"),
      page: useTabUiField("transfers", "page"),
      query: useTabUiField("scouting", "searchQuery"),
    }));
    act(() => {
      first.result.current.view[1]("market");
      first.result.current.page[1]((p) => p + 2);
      first.result.current.query[1]("faker");
    });
    first.unmount();

    const second = renderHook(() => ({
      view: useTabUiField("transfers", "view"),
      page: useTabUiField("transfers", "page"),
      query: useTabUiField("scouting", "searchQuery"),
    }));
    expect(second.result.current.view[0]).toBe("market");
    expect(second.result.current.page[0]).toBe(2);
    expect(second.result.current.query[0]).toBe("faker");
  });

  it("resets tab UI state when the game is cleared", () => {
    useTabUiStore.setState((s) => ({
      tabs: { ...s.tabs, scouting: { ...s.tabs.scouting, searchQuery: "faker" } },
    }));
    useGameStore.getState().clearGame();
    expect(useTabUiStore.getState().tabs.scouting.searchQuery).toBe("");
  });

  it("starts the Club tabs from their defaults", () => {
    expect(useTabUiStore.getState().tabs).toMatchObject({
      squad: { sortKey: "pos", sortDir: "asc", search: "", roleFilter: "all", selectedId: null },
      training: { view: "training" },
      meta: { roleFilter: "ALL" },
      staff: { view: "mystaff", search: "", roleFilter: null, competitionFilter: null, page: 0 },
      worldStaff: { view: "mystaff", search: "", roleFilter: null, competitionFilter: null, page: 0 },
      finances: {
        view: "overview",
        sortKey: "wage",
        sortDir: "desc",
        ledgerSearch: "",
        ledgerKind: "all",
        ledgerSource: "all",
      },
      youth: { sortKey: "pos", sortDir: "asc", searchQuery: "" },
    });
  });

  it("resetTabUi clears every Club tab back to its defaults", () => {
    const { setTabField } = useTabUiStore.getState();
    setTabField("squad", "search", "faker");
    setTabField("squad", "selectedId", "p1");
    setTabField("training", "view", "soloq");
    setTabField("meta", "roleFilter", "Mid");
    setTabField("staff", "page", 3);
    setTabField("worldStaff", "roleFilter", "Coach");
    setTabField("finances", "view", "facilities");
    setTabField("finances", "ledgerKind", "Salary");
    setTabField("youth", "searchQuery", "kid");

    useTabUiStore.getState().resetTabUi();

    expect(useTabUiStore.getState().tabs).toEqual(DEFAULT_TAB_UI_STATES);
  });

  it("reads a stored id that is no longer valid as the default, and clears it", () => {
    useTabUiStore.getState().setTabField("squad", "selectedId", "gone");
    const { result } = renderHook(() =>
      useValidTabUiField("squad", "selectedId", (id) => id === "here"),
    );

    expect(result.current[0]).toBeNull();
    expect(useTabUiStore.getState().tabs.squad.selectedId).toBeNull();
  });

  it("keeps a stored id that is still valid", () => {
    useTabUiStore.getState().setTabField("squad", "selectedId", "here");
    const { result } = renderHook(() =>
      useValidTabUiField("squad", "selectedId", (id) => id === "here"),
    );

    expect(result.current[0]).toBe("here");
    expect(useTabUiStore.getState().tabs.squad.selectedId).toBe("here");
  });
});
