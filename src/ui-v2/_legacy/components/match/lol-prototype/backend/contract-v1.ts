import type { MatchSnapshot } from "@/ui-v2/_legacy/components/match/types";
import type { ChampionCombatProfile } from "@/ui-v2/_legacy/components/match/lol-prototype/engine/simulation";
import type { MatchState, TeamId } from "@/ui-v2/_legacy/components/match/lol-prototype/engine/types";

/**
 * Simulation Contract v1 for LoL simulator migration (TS <-> Tauri Rust).
 *
 * Contract-first goal: preserve current UI behavior while moving runtime ownership
 * to Rust incrementally.
 */

export type LolSimV1EventType = "kill" | "tower" | "dragon" | "baron" | "nexus" | "spawn" | "recall" | "info";
export type LolSimV1AiMode = "rules" | "hybrid";

export interface LolChampionUltimateProfile {
  archetype: string;
  icon: string;
}

export interface LolSimV1PolicyConfig {
  noDiveHpMin?: number;
  tradeRetreatHpRatio?: number;
  tradeHpDisadvantageAllowance?: number;
  laneChaseLeashRadius?: number;
  hybridOpenTradeConfidenceHigh?: number;
  hybridDisengageConfidenceLow?: number;
}

export interface LolSimV1SimEvent {
  t: number;
  text: string;
  type: LolSimV1EventType;
}

export interface LolSimV1TeamStats {
  kills: number;
  towers: number;
  dragons: number;
  barons: number;
  gold: number;
}

/**
 * Runtime state subset consumed by the live match screen (ui-v2/match).
 * NOTE: Keep aligned with fields actually read by UI, not full engine internals.
 */
export type LolSimV1RuntimeState = Pick<
  MatchState,
  "timeSec" | "running" | "winner" | "showWalls" | "champions" | "minions" | "structures" | "objectives" | "neutralTimers" | "stats" | "events"
> & {
  speed: number;
  /** Game seconds one engine step advances; the same at every playback speed. */
  stepSec?: number;
  /** Game seconds of the next step already collected, from 0 to `stepSec`. */
  stepAccumSec?: number;
  goldDiffTimeline?: Array<{ minute: number; diff: number }>;
};

export function createEmptyNeutralTimersState(): LolSimV1RuntimeState["neutralTimers"] {
  return {
    dragonSoulUnlocked: false,
    elderUnlocked: false,
    entities: {} as LolSimV1RuntimeState["neutralTimers"]["entities"],
  };
}

export function createDefaultObjectivesState(): LolSimV1RuntimeState["objectives"] {
  return {
    dragon: { key: "dragon", pos: { x: 0.68, y: 0.58 }, alive: false, nextSpawnAt: 5 * 60 },
    baron: { key: "baron", pos: { x: 0.32, y: 0.42 }, alive: false, nextSpawnAt: 20 * 60 },
  };
}

export interface LolSimV1InitRequest {
  sessionId: string;
  seed: string;
  aiMode?: LolSimV1AiMode;
  policy?: LolSimV1PolicyConfig;
  snapshot: MatchSnapshot;
  championByPlayerId: Record<string, string>;
  championProfilesById: Record<string, ChampionCombatProfile>;
  championUltimatesById?: Record<string, LolChampionUltimateProfile>;
  /**
   * Legacy bootstrap field kept for backwards compatibility.
   * Rust v2 now creates state natively and ignores this payload.
   */
  initialState?: LolSimV1RuntimeState;
}

export interface LolSimV1StateResponse {
  sessionId: string;
  state: LolSimV1RuntimeState;
}

export interface LolSimV1TickRequest {
  sessionId: string;
  dtSec: number;
  running: boolean;
  speed: number;
}

export interface LolSimV1ResetRequest {
  sessionId: string;
  seed: string;
  aiMode?: LolSimV1AiMode;
  policy?: LolSimV1PolicyConfig;
  initialState?: LolSimV1RuntimeState;
}

export interface LolSimV1DisposeRequest {
  sessionId: string;
}

export interface LolSimV1DisposeResponse {
  sessionId: string;
  disposed: boolean;
}

export interface LolSimV1RunToCompletionRequest {
  seed: string;
  aiMode?: LolSimV1AiMode;
  policy?: LolSimV1PolicyConfig;
  snapshot: MatchSnapshot;
  championByPlayerId: Record<string, string>;
  championProfilesById: Record<string, ChampionCombatProfile>;
  championUltimatesById?: Record<string, LolChampionUltimateProfile>;
  dtSec: number;
  speed: number;
  maxTicks: number;
}

export interface LolSimV1RunToCompletionResponse {
  winner: TeamId | null;
  ticks: number;
  elapsedSimulatedSec: number;
}

export interface LolSimV1SkipToEndRequest {
  sessionId: string;
  dtSec?: number;
  speed?: number;
  maxTicks?: number;
}

export interface LolSimV1SkipToEndResponse {
  sessionId: string;
  state: LolSimV1RuntimeState;
  winner: TeamId | null;
  ticks: number;
  elapsedSimulatedSec: number;
}

export interface LolSimV1MatchReportEventInput {
  t: number;
  text: string;
  type: LolSimV1EventType;
}

export interface LolSimV1MatchReportTeamStatsInput {
  kills: number;
  deaths: number;
  gold: number;
  towers: number;
  dragons: number;
  barons: number;
}

export interface LolSimV1MatchReportChampionInput {
  id: string;
  name: string;
  team: TeamId;
  role: "TOP" | "JGL" | "MID" | "ADC" | "SUP";
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  gold: number;
  spentGold: number;
  /** Damage dealt to enemy champions; the engine counts it, an older one sends none. */
  damageDealt?: number;
}

export interface LolSimV1MatchReportInput {
  winner: TeamId | null;
  timeSec: number;
  events: LolSimV1MatchReportEventInput[];
  stats: {
    blue: LolSimV1MatchReportTeamStatsInput;
    red: LolSimV1MatchReportTeamStatsInput;
  };
  champions: LolSimV1MatchReportChampionInput[];
}

export interface LolSimV1ControlSnapshot {
  sessionId: string;
  seed: string;
  running: boolean;
  speed: number;
  winner: TeamId | null;
}
