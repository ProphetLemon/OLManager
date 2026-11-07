import { create } from 'zustand';
import type { GameStateData } from './types';
import { useTabUiStore } from './tabUiStore';

// Re-export all types so existing imports from gameStore keep working
export type {
  CompetitionSummary,
  TeamSummary,
  LeagueSelectionData,
  TeamColors,
  TeamSeasonRecord,
  TeamRolesData,
  TeamKind,
  AcademyLifecycle,
  ErlAssignmentRule,
  ErlAssignmentData,
  AcademyMetadataData,
  AcademySourceIdentityData,
  AcademyAcquisitionOptionData,
  AcademyAcquisitionOptionsResponseData,
  AcquireAcademyTeamRequestData,
  AcademyCreationOptionData,
  AcademyCreationOptionsResponseData,
  LolTacticsData,
  FinancialTransactionKind,
  FinancialTransactionData,
  TeamData,
  MatchOutcome,
  TeamSide,
  LolRole,
  MatchEndReason,
  PlayerSeasonStats,
  PlayerMatchStatsRecord,
  TeamMatchStatsRecord,
  MatchResult,
  CareerEntry,
  PlayerAttributes,
  PlayerMatchHistoryEntryData,
  PlayerData,
  TransferOfferData,
  StaffData,
  MessageAction,
  MessageActionOption,
  MessageContext,
  DelegatedRenewalCaseMessageData,
  DelegatedRenewalReportMessageData,
  PlayerSelectionOptions,
  ScoutReportData,
  MessageData,
  ManagerCareerStats,
  ManagerCareerEntry,
  FixtureData,
  StandingData,
  LeagueData,
  SeasonPhase,
  TransferWindowStatus,
  TransferWindowContextData,
  SeasonContextData,
  NewsMatchScore,
  NewsArticle,
  SocialAuthorType,
  SocialSentiment,
  SocialPostCategory,
  SocialPostData,
  SocialAccountData,
  SocialTemplateData,
  BoardObjective,
  ScoutingAssignment,
  ScrimStatus,
  ScrimFocus,
  ScrimIssue,
  PostScrimDecision,
  ScrimChampionPickData,
  ScrimReportData,
  ChampionMasteryEntryData,
  ChampionMetaEntryData,
  ChampionPatchNoteData,
  ChampionPatchStateData,
  ChampionData,
  GameStateData,
  DayPhase,
} from './types';

export {
  compareStandingsByLolScore,
  getStandingKillDiff,
  getStandingKillsAgainst,
  getStandingKillsFor,
} from './types';

// ─── Competition selectors (multi-league) ──────────────────────────────

/** Return the player's active league */
export function useActiveLeague(state: GameStateData) {
  if (state.user_competition_id) {
    return state.leagues.find((l) => l.competition_id === state.user_competition_id);
  }
  return state.leagues[0];
}

/** Return all competitions (for browsing/switching) */
export function useAllLeagues(state: GameStateData) {
  return state.leagues;
}

/** Return background leagues (leagues[1..]) */
export function useBackgroundLeagues(state: GameStateData) {
  return state.leagues.slice(1);
}

/** Return a specific league by ID */
export function useLeagueById(state: GameStateData, id: string) {
  return state.leagues.find((l) => l.id === id) ?? null;
}

interface GameStore {
  hasActiveGame: boolean;
  managerName: string | null;
  gameState: GameStateData | null;
  isDirty: boolean;
  showFiredModal: boolean;
  setGameActive: (active: boolean, managerName?: string) => void;
  setGameState: (state: GameStateData) => void;
  markClean: () => void;
  setShowFiredModal: (show: boolean) => void;
  clearGame: () => void;
}

export const useGameStore = create<GameStore>((set) => ({
  hasActiveGame: false,
  managerName: null,
  gameState: null,
  isDirty: false,
  showFiredModal: false,
  setGameActive: (active, managerName) => {
    console.log("[store] setGameActive called:", { active, managerName });
    set({
      hasActiveGame: active,
      managerName: managerName || null
    });
  },
  setGameState: (state) => set((prev) => ({
    gameState: { ...state, champions: state.champions ?? prev.gameState?.champions },
    isDirty: true,
  })),
  markClean: () => set({ isDirty: false }),
  setShowFiredModal: (show) => set({ showFiredModal: show }),
  clearGame: () => {
    useTabUiStore.getState().resetTabUi();
    set({
      hasActiveGame: false,
      managerName: null,
      gameState: null,
      isDirty: false,
      showFiredModal: false,
    });
  },
}));
