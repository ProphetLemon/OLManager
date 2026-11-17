import { create } from "zustand";
import { groupForTab, isGroupOpen, type RailGroupId } from "@/ui-v2/shell/navModel";

interface NavMemoryStore {
  /** The dashboard tab the user was on, or null before any visit in this game. */
  activeTab: string | null;
  /** The last tab seen inside each rail group, so a launcher reopens where the user left. */
  lastByGroup: Partial<Record<RailGroupId, string>>;
  /** User choice per group; an unset entry reads the group's `defaultOpen` (Club open, others closed). */
  openGroups: Partial<Record<RailGroupId, boolean>>;
  rememberTab: (tab: string) => void;
  toggleGroup: (id: RailGroupId) => void;
  resetNavMemory: () => void;
}

/**
 * Where the user is in the dashboard, kept for the session only so it outlives
 * DashboardV2 unmounting for Settings or a match. Reset on clear, new game and load.
 */
export const useNavMemoryStore = create<NavMemoryStore>((set) => ({
  activeTab: null,
  lastByGroup: {},
  openGroups: {},
  rememberTab: (tab) =>
    set((s) => {
      const group = groupForTab(tab);
      return {
        activeTab: tab,
        lastByGroup: group ? { ...s.lastByGroup, [group]: tab } : s.lastByGroup,
        // The active row can never be hidden: its group opens, and nothing else closes.
        openGroups: group ? { ...s.openGroups, [group]: true } : s.openGroups,
      };
    }),
  toggleGroup: (id) =>
    set((s) => ({ openGroups: { ...s.openGroups, [id]: !isGroupOpen(s.openGroups, id) } })),
  resetNavMemory: () => set({ activeTab: null, lastByGroup: {}, openGroups: {} }),
}));
