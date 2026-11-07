import { useCallback } from "react";
import { create } from "zustand";

export interface TransfersTabUiState {
  view: string;
  search: string;
  posFilter: string | null;
  competitionFilter: string | null;
  sort: { key: string; direction: string } | null;
  page: number;
}

export interface ScoutingTabUiState {
  searchQuery: string;
  posFilter: string;
  page: number;
}

export interface TabUiStates {
  transfers: TransfersTabUiState;
  scouting: ScoutingTabUiState;
}

export const DEFAULT_TAB_UI_STATES: TabUiStates = {
  transfers: {
    view: "my_list",
    search: "",
    posFilter: null,
    competitionFilter: null,
    sort: { key: "ovr", direction: "desc" },
    page: 0,
  },
  scouting: { searchQuery: "", posFilter: "All", page: 0 },
};

interface TabUiStore {
  tabs: TabUiStates;
  setTabField: <T extends keyof TabUiStates, K extends keyof TabUiStates[T]>(
    tab: T,
    key: K,
    value: TabUiStates[T][K],
  ) => void;
  resetTabUi: () => void;
}

/** Per-tab UI state that must survive the tab unmounting while a profile is open. */
export const useTabUiStore = create<TabUiStore>((set) => ({
  tabs: DEFAULT_TAB_UI_STATES,
  setTabField: (tab, key, value) =>
    set((s) => ({ tabs: { ...s.tabs, [tab]: { ...s.tabs[tab], [key]: value } } })),
  resetTabUi: () => set({ tabs: DEFAULT_TAB_UI_STATES }),
}));

type Updater<V> = V | ((prev: V) => V);

/** useState-like hook backed by useTabUiStore. */
export function useTabUiField<T extends keyof TabUiStates, K extends keyof TabUiStates[T]>(
  tab: T,
  key: K,
): [TabUiStates[T][K], (next: Updater<TabUiStates[T][K]>) => void] {
  const value = useTabUiStore((s) => s.tabs[tab][key]);
  const setter = useCallback(
    (next: Updater<TabUiStates[T][K]>) => {
      const store = useTabUiStore.getState();
      const resolved =
        typeof next === "function"
          ? (next as (prev: TabUiStates[T][K]) => TabUiStates[T][K])(store.tabs[tab][key])
          : next;
      store.setTabField(tab, key, resolved);
    },
    [tab, key],
  );
  return [value, setter];
}
