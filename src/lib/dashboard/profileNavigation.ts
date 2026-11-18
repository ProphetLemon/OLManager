import type { GameStateData, PlayerSelectionOptions } from "../../store/gameStore";

export interface DashboardNavigateContext {
  messageId?: string;
  /** Competition to preselect when the target tab is Competitions. */
  competitionId?: string;
}

/**
 * A request to move somewhere in the dashboard, from the rail, Home, the lane or
 * the palette. `openRenewal` and `context` are one-shot: they ride this move only.
 */
export type NavIntent =
  | { kind: "tab"; tab: string; context?: DashboardNavigateContext }
  | { kind: "player"; id: string; openRenewal?: boolean }
  | { kind: "team"; id: string }
  | { kind: "staff"; id: string }
  | { kind: "champion"; key: string };

/**
 * Where the user is: a tab, and the profile or champion page open over it. The
 * champion page keeps the profile ids under it, so Back returns to that profile.
 */
export interface DashboardLocation {
  tab: string;
  playerId: string | null;
  teamId: string | null;
  staffId: string | null;
  championKey: string | null;
}

export interface DashboardProfileNavigationState {
  activeTab: string;
  selectedPlayerId: string | null;
  selectedPlayerOptions: PlayerSelectionOptions | null;
  selectedTeamId: string | null;
  selectedStaffId: string | null;
  championKey: string | null;
  initialMessageId: string | null;
  initialCompetitionId: string | null;
  /** The back stack (R19): every location left, oldest first. */
  navHistory: DashboardLocation[];
}

/** Intents consumed by the move that carried them; Back never restores them. */
interface OneShots {
  selectedPlayerOptions?: PlayerSelectionOptions | null;
  initialMessageId?: string | null;
  initialCompetitionId?: string | null;
}

export const HISTORY_CAP = 30;
export const RECENT_CAP = 6;

export function createDashboardProfileNavigationState(
  activeTab: string,
): DashboardProfileNavigationState {
  return atLocation(tabLocation(activeTab), {}, []);
}

function tabLocation(tab: string): DashboardLocation {
  return { tab, playerId: null, teamId: null, staffId: null, championKey: null };
}

export function locationKey(loc: DashboardLocation): string {
  return `${loc.tab}|p:${loc.playerId ?? ""}|t:${loc.teamId ?? ""}|s:${loc.staffId ?? ""}|c:${loc.championKey ?? ""}`;
}

export function sameLocation(a: DashboardLocation, b: DashboardLocation): boolean {
  return locationKey(a) === locationKey(b);
}

export function currentLocation(state: DashboardProfileNavigationState): DashboardLocation {
  return {
    tab: state.activeTab,
    playerId: state.selectedPlayerId,
    teamId: state.selectedTeamId,
    staffId: state.selectedStaffId,
    championKey: state.championKey,
  };
}

function atLocation(
  loc: DashboardLocation,
  oneShots: OneShots,
  navHistory: DashboardLocation[],
): DashboardProfileNavigationState {
  return {
    activeTab: loc.tab,
    selectedPlayerId: loc.playerId,
    selectedPlayerOptions: oneShots.selectedPlayerOptions ?? null,
    selectedTeamId: loc.teamId,
    selectedStaffId: loc.staffId,
    championKey: loc.championKey,
    initialMessageId: oneShots.initialMessageId ?? null,
    initialCompetitionId: oneShots.initialCompetitionId ?? null,
    navHistory,
  };
}

/** The stack with `loc` on top: a duplicate of the top collapses, and the oldest entry drops past the cap. */
function pushHistory(history: DashboardLocation[], loc: DashboardLocation): DashboardLocation[] {
  const top = history[history.length - 1];
  if (top && sameLocation(top, loc)) return history;
  return [...history, loc].slice(-HISTORY_CAP);
}

/**
 * Moves to `next`, pushing the current location unless it is `next` itself.
 * The one-shots given ride this move; any earlier ones are dropped.
 */
export function pushLocation(
  state: DashboardProfileNavigationState,
  next: DashboardLocation,
  oneShots: OneShots = {},
): DashboardProfileNavigationState {
  const here = currentLocation(state);
  const navHistory = sameLocation(here, next) ? state.navHistory : pushHistory(state.navHistory, here);
  return atLocation(next, oneShots, navHistory);
}

/** A tab change: it pushes the current location like every other move (R19). */
export function resetDashboardToTab(
  state: DashboardProfileNavigationState,
  tab: string,
  messageId?: string,
  competitionId?: string,
): DashboardProfileNavigationState {
  return pushLocation(state, tabLocation(tab), {
    initialMessageId: messageId ?? null,
    initialCompetitionId: competitionId ?? null,
  });
}

export function navigateDashboardProfiles(
  state: DashboardProfileNavigationState,
  tab: string,
  context?: DashboardNavigateContext,
): DashboardProfileNavigationState {
  if (tab === "__selectTeam" && context?.messageId) {
    return selectDashboardTeam(state, context.messageId);
  }

  if (tab === "__selectPlayer" && context?.messageId) {
    return selectDashboardPlayer(state, context.messageId);
  }

  return resetDashboardToTab(state, tab, context?.messageId, context?.competitionId);
}

/**
 * Back (R19): pops to the newest entry that is still valid and is not where the
 * user already is; skipped entries are dropped, and nothing is pushed forward.
 * With no such entry, an open profile or champion page closes to its tab.
 */
export function goBackDashboardProfile(
  state: DashboardProfileNavigationState,
  isValid: (loc: DashboardLocation) => boolean = () => true,
): DashboardProfileNavigationState {
  const here = currentLocation(state);
  const history = [...state.navHistory];
  while (history.length > 0) {
    const entry = history.pop() as DashboardLocation;
    if (isValid(entry) && !sameLocation(entry, here)) return atLocation(entry, {}, history);
  }

  const tab = tabLocation(state.activeTab);
  if (!sameLocation(tab, here)) return atLocation(tab, {}, []);
  return state.navHistory.length === 0 ? state : { ...state, navHistory: [] };
}

export function selectDashboardPlayer(
  state: DashboardProfileNavigationState,
  id: string,
  options?: PlayerSelectionOptions,
): DashboardProfileNavigationState {
  return pushLocation(
    state,
    { ...tabLocation(state.activeTab), playerId: id },
    { selectedPlayerOptions: options ?? null },
  );
}

export function selectDashboardTeam(
  state: DashboardProfileNavigationState,
  id: string,
): DashboardProfileNavigationState {
  return pushLocation(state, { ...tabLocation(state.activeTab), teamId: id });
}

export function selectDashboardStaff(
  state: DashboardProfileNavigationState,
  id: string,
): DashboardProfileNavigationState {
  return pushLocation(state, { ...tabLocation(state.activeTab), staffId: id });
}

/** The champion page opens over the current location, which Back returns to. */
export function selectDashboardChampion(
  state: DashboardProfileNavigationState,
  key: string,
): DashboardProfileNavigationState {
  return pushLocation(state, { ...currentLocation(state), championKey: key });
}

export function applyNavIntent(
  state: DashboardProfileNavigationState,
  intent: NavIntent,
): DashboardProfileNavigationState {
  switch (intent.kind) {
    case "tab":
      return navigateDashboardProfiles(state, intent.tab, intent.context);
    case "player":
      return selectDashboardPlayer(state, intent.id, intent.openRenewal ? { openRenewal: true } : undefined);
    case "team":
      return selectDashboardTeam(state, intent.id);
    case "staff":
      return selectDashboardStaff(state, intent.id);
    case "champion":
      return selectDashboardChampion(state, intent.key);
  }
}

/** The same location with every one-shot intent consumed. */
export function clearDashboardOneShots(
  state: DashboardProfileNavigationState,
): DashboardProfileNavigationState {
  if (
    state.selectedPlayerOptions === null &&
    state.initialMessageId === null &&
    state.initialCompetitionId === null
  ) {
    return state;
  }
  return atLocation(currentLocation(state), {}, state.navHistory);
}

/**
 * Whether a location's player, team or staff member still exists, so Back can
 * skip a released or retired entity. Champions are static data and never go.
 */
export function isLocationInGame(
  loc: DashboardLocation,
  game: Pick<GameStateData, "players" | "teams" | "staff">,
): boolean {
  if (loc.playerId !== null && !game.players.some((p) => p.id === loc.playerId)) return false;
  if (loc.teamId !== null && !game.teams.some((t) => t.id === loc.teamId)) return false;
  if (loc.staffId !== null && !game.staff.some((m) => m.id === loc.staffId)) return false;
  return true;
}

/**
 * Whether a profile is open. The header's current Back button follows this
 * until NR2.3 replaces it, so it still shows only over a profile.
 */
export function hasDashboardProfileHistory(state: DashboardProfileNavigationState): boolean {
  return (
    state.selectedPlayerId !== null ||
    state.selectedTeamId !== null ||
    state.selectedStaffId !== null
  );
}

/**
 * Recent: `left` first, deduped by location, without `current`, capped at 6.
 * Entries whose entity is gone are dropped where Recent is read.
 */
export function pushRecent(
  recent: DashboardLocation[],
  left: DashboardLocation,
  current?: DashboardLocation,
): DashboardLocation[] {
  const leftKey = locationKey(left);
  const currentKey = current ? locationKey(current) : null;
  return [left, ...recent.filter((loc) => locationKey(loc) !== leftKey)]
    .filter((loc) => locationKey(loc) !== currentKey)
    .slice(0, RECENT_CAP);
}
