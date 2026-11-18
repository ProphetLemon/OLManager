import { useCallback, useEffect } from "react";
import { create } from "zustand";
import type { LolRole } from "@/lib/home/scoreboard";
import type { FinancialTransactionKind } from "./types";

export type SortDir = "asc" | "desc";

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

export interface SquadTabUiState {
  sortKey: "pos" | "ovr" | "condition" | "fitness" | "morale" | "age";
  sortDir: SortDir;
  search: string;
  roleFilter: "all" | LolRole;
  /** A starter's id: read it through `useValidTabUiField`. */
  selectedId: string | null;
}

export interface TrainingTabUiState {
  view: "training" | "soloq";
}

export interface MetaTabUiState {
  roleFilter: "ALL" | "Top" | "Jungle" | "Mid" | "ADC" | "Support";
}

/** Shared by the club Staff tab and World › Staff, which keep separate copies. `view` is club only. */
export interface StaffTabUiState {
  view: "mystaff" | "available";
  search: string;
  roleFilter: string | null;
  competitionFilter: string | null;
  page: number;
}

export interface FinancesTabUiState {
  view: "overview" | "facilities";
  sortKey: "name" | "position" | "wage" | "value" | "contract";
  sortDir: SortDir;
  ledgerSearch: string;
  ledgerKind: FinancialTransactionKind | "all";
  ledgerSource: string;
}

export interface YouthTabUiState {
  sortKey: "name" | "pos" | "age" | "ovr" | "potential" | "condition";
  sortDir: SortDir;
  searchQuery: string;
}

export interface TabUiStates {
  transfers: TransfersTabUiState;
  scouting: ScoutingTabUiState;
  squad: SquadTabUiState;
  training: TrainingTabUiState;
  meta: MetaTabUiState;
  staff: StaffTabUiState;
  worldStaff: StaffTabUiState;
  finances: FinancesTabUiState;
  youth: YouthTabUiState;
}

const DEFAULT_STAFF_STATE: StaffTabUiState = {
  view: "mystaff",
  search: "",
  roleFilter: null,
  competitionFilter: null,
  page: 0,
};

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
  squad: { sortKey: "pos", sortDir: "asc", search: "", roleFilter: "all", selectedId: null },
  training: { view: "training" },
  meta: { roleFilter: "ALL" },
  staff: DEFAULT_STAFF_STATE,
  worldStaff: DEFAULT_STAFF_STATE,
  finances: {
    view: "overview",
    sortKey: "wage",
    sortDir: "desc",
    ledgerSearch: "",
    ledgerKind: "all",
    ledgerSource: "all",
  },
  youth: { sortKey: "pos", sortDir: "asc", searchQuery: "" },
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

/**
 * Per-tab UI state (view, filters, sort, page, selection) that must survive the
 * tab unmounting while a profile is open (R23). Loading flags, dialogs, drafts
 * and scroll positions stay local to each tab. Reset with the session.
 */
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

/**
 * useTabUiField for a stored entity id. An id that `isValid` rejects (a player
 * released, a message deleted) reads as the default, and the store drops it
 * after the render.
 */
export function useValidTabUiField<T extends keyof TabUiStates, K extends keyof TabUiStates[T]>(
  tab: T,
  key: K,
  isValid: (value: NonNullable<TabUiStates[T][K]>) => boolean,
): [TabUiStates[T][K], (next: Updater<TabUiStates[T][K]>) => void] {
  const [value, setValue] = useTabUiField(tab, key);
  const fallback = DEFAULT_TAB_UI_STATES[tab][key];
  const valid = value == null || value === fallback || isValid(value as NonNullable<TabUiStates[T][K]>);
  useEffect(() => {
    if (!valid) setValue(fallback);
  }, [valid, fallback, setValue]);
  return [valid ? value : fallback, setValue];
}
