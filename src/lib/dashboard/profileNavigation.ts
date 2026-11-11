import type { PlayerSelectionOptions } from "../../store/gameStore";

export interface DashboardNavigateContext {
  messageId?: string;
  /** Competition to preselect when the target tab is Competitions. */
  competitionId?: string;
}

export interface DashboardProfileHistoryEntry {
  tab: string;
  playerId: string | null;
  teamId: string | null;
  staffId: string | null;
}

export interface DashboardProfileNavigationState {
  activeTab: string;
  selectedPlayerId: string | null;
  selectedPlayerOptions: PlayerSelectionOptions | null;
  selectedTeamId: string | null;
  selectedStaffId: string | null;
  initialMessageId: string | null;
  initialCompetitionId: string | null;
  navHistory: DashboardProfileHistoryEntry[];
}

export function createDashboardProfileNavigationState(
  activeTab: string,
): DashboardProfileNavigationState {
  return {
    activeTab,
    selectedPlayerId: null,
    selectedPlayerOptions: null,
    selectedTeamId: null,
    selectedStaffId: null,
    initialMessageId: null,
    initialCompetitionId: null,
    navHistory: [],
  };
}

export function clearDashboardProfileSelection(
  state: DashboardProfileNavigationState,
): DashboardProfileNavigationState {
  return {
    ...state,
    selectedPlayerId: null,
    selectedPlayerOptions: null,
    selectedTeamId: null,
    selectedStaffId: null,
  };
}

export function resetDashboardToTab(
  state: DashboardProfileNavigationState,
  tab: string,
  messageId?: string,
  competitionId?: string,
): DashboardProfileNavigationState {
  return {
    ...clearDashboardProfileSelection(state),
    activeTab: tab,
    initialMessageId: messageId ?? null,
    initialCompetitionId: competitionId ?? null,
    navHistory: [],
  };
}

export function pushDashboardHistory(
  state: DashboardProfileNavigationState,
): DashboardProfileNavigationState {
  return {
    ...state,
    navHistory: [
      ...state.navHistory,
      {
        tab: state.activeTab,
        playerId: state.selectedPlayerId,
        teamId: state.selectedTeamId,
        staffId: state.selectedStaffId,
      },
    ],
  };
}

export function navigateDashboardProfiles(
  state: DashboardProfileNavigationState,
  tab: string,
  context?: DashboardNavigateContext,
): DashboardProfileNavigationState {
  if (tab === "__selectTeam" && context?.messageId) {
    return {
      ...pushDashboardHistory(state),
      selectedTeamId: context.messageId,
      selectedPlayerId: null,
      selectedPlayerOptions: null,
      selectedStaffId: null,
    };
  }

  if (tab === "__selectPlayer" && context?.messageId) {
    return {
      ...pushDashboardHistory(state),
      selectedPlayerId: context.messageId,
      selectedPlayerOptions: null,
      selectedTeamId: null,
      selectedStaffId: null,
    };
  }

  return resetDashboardToTab(state, tab, context?.messageId, context?.competitionId);
}

export function goBackDashboardProfile(
  state: DashboardProfileNavigationState,
): DashboardProfileNavigationState {
  if (state.navHistory.length === 0) {
    return clearDashboardProfileSelection(state);
  }

  const previous = state.navHistory[state.navHistory.length - 1];

  return {
    ...state,
    activeTab: previous.tab,
    selectedPlayerId: previous.playerId,
    selectedPlayerOptions: null,
    selectedTeamId: previous.teamId,
    selectedStaffId: previous.staffId,
    navHistory: state.navHistory.slice(0, -1),
  };
}

export function selectDashboardPlayer(
  state: DashboardProfileNavigationState,
  id: string,
  options?: PlayerSelectionOptions,
): DashboardProfileNavigationState {
  return {
    ...pushDashboardHistory(state),
    selectedPlayerId: id,
    selectedPlayerOptions: options ?? null,
    selectedTeamId: null,
    selectedStaffId: null,
  };
}

export function selectDashboardTeam(
  state: DashboardProfileNavigationState,
  id: string,
): DashboardProfileNavigationState {
  return {
    ...pushDashboardHistory(state),
    selectedTeamId: id,
    selectedPlayerId: null,
    selectedPlayerOptions: null,
    selectedStaffId: null,
  };
}

export function selectDashboardStaff(
  state: DashboardProfileNavigationState,
  id: string,
): DashboardProfileNavigationState {
  return {
    ...pushDashboardHistory(state),
    selectedStaffId: id,
    selectedPlayerId: null,
    selectedPlayerOptions: null,
    selectedTeamId: null,
  };
}

export function openDashboardSearchPlayer(
  state: DashboardProfileNavigationState,
  id: string,
): DashboardProfileNavigationState {
  return {
    ...state,
    selectedPlayerId: id,
    selectedPlayerOptions: null,
    selectedTeamId: null,
  };
}

export function openDashboardSearchTeam(
  state: DashboardProfileNavigationState,
  id: string,
): DashboardProfileNavigationState {
  return {
    ...state,
    selectedTeamId: id,
    selectedPlayerId: null,
    selectedPlayerOptions: null,
  };
}

export function hasDashboardProfileHistory(
  state: DashboardProfileNavigationState,
): boolean {
  return (
    state.navHistory.length > 0 ||
    state.selectedPlayerId !== null ||
    state.selectedTeamId !== null ||
    state.selectedStaffId !== null
  );
}