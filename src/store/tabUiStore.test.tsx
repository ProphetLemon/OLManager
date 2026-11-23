import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGameStore } from "./gameStore";
import {
  DEFAULT_TAB_UI_STATES,
  useTabUiField,
  useOneShotOverride,
  useTabUiStore,
  useValidTabUiField,
} from "./tabUiStore";

describe("tabUiStore", () => {
  beforeEach(() => useTabUiStore.getState().resetTabUi());

  it("writes several fields of one tab in a single update (R67)", () => {
    const seen: { view: string; selectedCid: string | null }[] = [];
    const unsubscribe = useTabUiStore.subscribe((s) => seen.push({ ...s.tabs.competitions }));
    useTabUiStore.getState().setTabFields("competitions", { view: "teams", selectedCid: "lec" });
    unsubscribe();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ view: "teams", selectedCid: "lec" });
    expect(useTabUiStore.getState().tabs.competitions.teamPage).toBe(DEFAULT_TAB_UI_STATES.competitions.teamPage);
  });

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

  it("starts the World and direct tabs from their defaults", () => {
    expect(useTabUiStore.getState().tabs).toMatchObject({
      schedule: { view: "fixtures", selectedDay: null },
      competitions: {
        selectedCid: null,
        view: "standings",
        teamPage: 0,
        playerPage: 0,
        teamSearch: "",
        playerSearch: "",
      },
      players: {
        searchInput: "",
        roles: [],
        statusFilter: "all",
        competitionFilter: null,
        teamFilter: null,
        sort: { key: "ovr", dir: "desc" },
        page: 1,
      },
      teams: { filter: null, search: "", sort: "position", asc: true, page: 0 },
      champions: { search: "", roleFilter: "ALL", page: 0 },
      inbox: { selectedId: null, filter: null, sortOrder: "newest", query: "" },
      news: { category: null, team: null, page: 0 },
      market: { filter: "all" },
    });
  });

  it("resetTabUi clears the World and direct tabs back to their defaults", () => {
    const { setTabField } = useTabUiStore.getState();
    setTabField("schedule", "selectedDay", "2027-01-01");
    setTabField("competitions", "selectedCid", "lec");
    setTabField("players", "roles", ["MID"]);
    setTabField("players", "page", 3);
    setTabField("teams", "asc", false);
    setTabField("champions", "search", "ahri");
    setTabField("inbox", "selectedId", "m1");
    setTabField("news", "category", "Transfer");
    setTabField("market", "filter", "user");

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

describe("useOneShotOverride", () => {
  it("applies the same one-shot again after it went back to null", () => {
    const apply = vi.fn();
    const { result, rerender } = renderHook(
      ({ oneShot }: { oneShot: string | null }) => useOneShotOverride(oneShot, "stored", apply),
      { initialProps: { oneShot: "m2" as string | null } },
    );
    expect(result.current).toBe("m2");
    expect(apply).toHaveBeenCalledTimes(1);

    rerender({ oneShot: null });
    expect(result.current).toBe("stored");

    // A second link to the same id is a new navigation: it wins and is applied again.
    rerender({ oneShot: "m2" });
    expect(result.current).toBe("m2");
    expect(apply).toHaveBeenCalledTimes(2);
  });
});
