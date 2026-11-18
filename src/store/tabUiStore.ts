import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { create } from "zustand";
import type { LolRole } from "@/lib/home/scoreboard";
import type { MessageSortOrder } from "@/lib/inbox/helpers";
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

export interface ScheduleTabUiState {
  view: "fixtures" | "calendar";
  /** The week card's day (YYYY-MM-DD) whose matches are listed. */
  selectedDay: string | null;
}

export interface CompetitionsTabUiState {
  /** A competition id: read it through `useValidTabUiField`. */
  selectedCid: string | null;
  view: "standings" | "calendar" | "teams" | "players";
  teamPage: number;
  playerPage: number;
  teamSearch: string;
  playerSearch: string;
}

export interface PlayersTabUiState {
  /** The typed search; the tab keeps its own debounced copy. */
  searchInput: string;
  roles: LolRole[];
  statusFilter: "all" | "transfer" | "loan";
  competitionFilter: string | null;
  teamFilter: string | null;
  sort: {
    key: "pos" | "name" | "age" | "nationality" | "team" | "value" | "ovr" | "status";
    dir: SortDir;
  };
  /** 1-based, unlike the other tabs. */
  page: number;
}

export interface TeamsTabUiState {
  filter: string | null;
  search: string;
  sort: "position" | "name" | "ovr" | "value" | "rep" | "wr" | "players";
  asc: boolean;
  page: number;
}

export interface ChampionsTabUiState {
  search: string;
  roleFilter: "ALL" | LolRole;
  page: number;
}

export interface InboxTabUiState {
  /** A message id: read it through `useValidTabUiField`. */
  selectedId: string | null;
  filter: string | null;
  sortOrder: MessageSortOrder;
  query: string;
}

export interface NewsTabUiState {
  category: string | null;
  team: string | null;
  page: number;
}

export interface MarketTabUiState {
  filter: "all" | "user" | "ai";
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
  schedule: ScheduleTabUiState;
  competitions: CompetitionsTabUiState;
  players: PlayersTabUiState;
  teams: TeamsTabUiState;
  champions: ChampionsTabUiState;
  inbox: InboxTabUiState;
  news: NewsTabUiState;
  market: MarketTabUiState;
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
    // Only the stale id this render read is dropped: a link applied before paint
    // (useOneShotOverride) may already have replaced it in the store.
    if (!valid && useTabUiStore.getState().tabs[tab][key] === value) setValue(fallback);
  }, [valid, value, fallback, setValue, tab, key]);
  return [valid ? value : fallback, setValue];
}

/**
 * Lets a one-shot selection carried by a navigation (`initialMessageId`,
 * `initialCompetitionId`) override the stored one. It wins on the render that
 * carries it, and `apply` writes it to the store before paint, along with
 * whatever the tab resets so the link is shown as a fresh mount showed it. The
 * same value is never applied twice, so a later pick by the user stays while
 * the prop is unchanged, and a remount without it (Back) shows the stored
 * selection.
 */
export function useOneShotOverride<V>(
  oneShot: V | null | undefined,
  stored: V | null,
  apply: (linked: V) => void,
): V | null {
  const consumed = useRef<V | null>(null);
  // Once the link is gone, the same id carried again later is a new navigation.
  if (oneShot == null) consumed.current = null;
  const pending = oneShot != null && consumed.current !== oneShot ? oneShot : null;
  useLayoutEffect(() => {
    if (pending == null) return;
    consumed.current = pending;
    apply(pending);
  }, [pending, apply]);
  return pending ?? stored;
}
