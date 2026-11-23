import { create } from "zustand";
import type { BlockerData } from "@/services/advanceTimeService";

/** What blocked the advance the last time it was checked, kept for "Needs your call". */
export interface RetainedBlockers {
  blockers: BlockerData[];
  canContinueAnyway: boolean;
  /** Game date the list was last confirmed for. */
  date: string | null;
}

type Updater<V> = V | ((prev: V) => V);

interface CallCacheStore {
  lastBlockers: RetainedBlockers | null;
  setLastBlockers: (next: Updater<RetainedBlockers | null>) => void;
  reset: () => void;
}

/**
 * The last known blockers, kept for the session so they outlive DashboardV2
 * unmounting for Settings or a match: the chip and Home start from them instead
 * of from 0 until the backend refresh answers. Reset with the session.
 */
export const useCallCacheStore = create<CallCacheStore>((set) => ({
  lastBlockers: null,
  setLastBlockers: (next) =>
    set((s) => ({
      lastBlockers: typeof next === "function" ? next(s.lastBlockers) : next,
    })),
  reset: () => set({ lastBlockers: null }),
}));
