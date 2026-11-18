import { create } from "zustand";
import {
  applyNavIntent,
  clearDashboardOneShots,
  createDashboardProfileNavigationState,
  currentLocation,
  goBackDashboardProfile,
  pushRecent,
  sameLocation,
  type DashboardLocation,
  type DashboardProfileNavigationState,
  type NavIntent,
} from "@/lib/dashboard/profileNavigation";
import { resolveNavTab } from "@/ui-v2/shell/navModel";

type LocationValidator = (loc: DashboardLocation) => boolean;

interface DashboardLocationStore {
  /** The active tab, the open profile or champion page, the one-shots and the back stack. */
  nav: DashboardProfileNavigationState;
  /** The last locations left, newest first, without the current one (capped at 6). */
  recent: DashboardLocation[];
  go: (intent: NavIntent) => void;
  /**
   * Pops to the newest valid entry. The store cannot see the game, so the caller
   * passes `isValid` to skip entries whose player, team, staff or champion is gone.
   */
  back: (isValid?: LocationValidator) => void;
  /** back() while the champion page is open; elsewhere it does nothing. */
  closeChampion: (isValid?: LocationValidator) => void;
  /** Drops the renewal, message and competition intents, keeping the location. */
  clearOneShots: () => void;
  reset: () => void;
}

const initialState = () => ({
  nav: createDashboardProfileNavigationState("Home"),
  recent: [] as DashboardLocation[],
});

/** The new navigation state, with the location left pushed on Recent when the location changed. */
function moveTo(
  s: Pick<DashboardLocationStore, "nav" | "recent">,
  nav: DashboardProfileNavigationState,
): Pick<DashboardLocationStore, "nav" | "recent"> {
  if (nav === s.nav) return s;
  const left = currentLocation(s.nav);
  const here = currentLocation(nav);
  return { nav, recent: sameLocation(left, here) ? s.recent : pushRecent(s.recent, left, here) };
}

/**
 * The only owner of where the user is in the dashboard (R22). It is a store, not
 * DashboardV2 state, so the location and its back stack survive DashboardV2
 * unmounting for Settings or a match. Reset with the session.
 */
export const useDashboardLocationStore = create<DashboardLocationStore>((set) => ({
  ...initialState(),
  go: (intent) =>
    set((s) =>
      moveTo(
        s,
        applyNavIntent(s.nav, intent.kind === "tab" ? { ...intent, tab: resolveNavTab(intent.tab) } : intent),
      ),
    ),
  back: (isValid) => set((s) => moveTo(s, goBackDashboardProfile(s.nav, isValid))),
  closeChampion: (isValid) =>
    set((s) => (s.nav.championKey === null ? s : moveTo(s, goBackDashboardProfile(s.nav, isValid)))),
  clearOneShots: () => set((s) => ({ nav: clearDashboardOneShots(s.nav) })),
  reset: () => set(initialState()),
}));
