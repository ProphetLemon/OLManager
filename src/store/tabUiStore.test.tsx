import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useGameStore } from "./gameStore";
import { useTabUiField, useTabUiStore } from "./tabUiStore";

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
});
