export type Role = "Top" | "Jungle" | "Mid" | "Bot" | "Support";

export interface GameRow {
  playerKey: string;
  competition: string;
  role: Role;
  date: string;
  gameMinutes: number;
  kills: number;
  deaths: number;
  assists: number;
  teamKills: number;
  damageToChampions: number;
  teamDamageToChampions: number;
  gold: number;
  teamGold: number;
  cs: number;
  visionScore: number | null;
}

export type FeatureName =
  | "kda"
  | "killParticipation"
  | "damageShare"
  | "damagePerMinute"
  | "csPerMinute"
  | "goldShare"
  | "negDeathsPerGame"
  | "visionPerMinute";
export type Features = Partial<Record<FeatureName, number>>;

export interface SkillOptions {
  referenceDate: string;
  halfLifeDays: number;
  minCohortGames: number;
  minCohortSize: number;
  minWriteGames: number;
  defaultR1: number;
  minR1: number;
  maxR1: number;
  minR1Pairs: number;
  featureWeights: Partial<Record<FeatureName, number>>;
  poolOf: (competition: string) => string | null | undefined;
}

export interface AggregatedPlayer {
  playerKey: string;
  competition: string;
  role: Role;
  features: Features;
  games: number;
  effectiveGames: number;
  rows: GameRow[];
}

export interface SkillEstimate {
  playerKey: string;
  competition: string;
  role: Role;
  games: number;
  effectiveGames: number;
  r1: number;
  reason: "below_min_write_games" | "cohort_too_small" | "no_features" | null;
  cohort: { scope: string; size: number } | null;
  z: number | null;
  rho: number | null;
  zShrunk: number | null;
}

export interface SuspectThresholds {
  flatLow: number;
  flatHigh: number;
  belowMedian: number;
}

export interface BlendOptions {
  tau: number;
  suspectTau: number;
  maxTrust: number;
  sdClamp: { min: number; max: number };
}

export interface BlendResult {
  z: number;
  rho: number;
  zShrunk: number;
  target: number;
  tau: number;
  w: number;
  authoredOvr: number;
  finalOvr: number;
}

export const ROLES: readonly Role[];
export const DEFAULT_OPTIONS: Readonly<Omit<SkillOptions, "referenceDate" | "poolOf">>;
export const DEFAULT_SUSPECT_THRESHOLDS: Readonly<SuspectThresholds>;
export const DEFAULT_BLEND_OPTIONS: Readonly<Omit<BlendOptions, "sdClamp">>;
export const DEFAULT_SD_CLAMP: Readonly<{ min: number; max: number }>;

export function dayNumber(date: string): number;
export function gameFeatures(row: Partial<GameRow> & { role?: string }): Features;
export function recencyWeight(ageDays: number, halfLifeDays?: number): number;
export function spearmanBrown(r1: number, n: number): number;
export function inverseSpearmanBrown(rn: number, n: number): number;
export function rho(n: number, r1: number): number;
export function aggregatePlayers(rows: GameRow[], options: Partial<SkillOptions> & { referenceDate: string }): AggregatedPlayer[];
export function estimateR1(
  entries: Array<{ rows: GameRow[]; stats: unknown }>,
  options: Partial<SkillOptions> & { referenceDate: string },
): { r1: number; source: "split-half" | "default"; pairs: number; halfCorrelation: number | null };
export function estimateSkill(rows: GameRow[], options: Partial<SkillOptions> & { referenceDate: string }): SkillEstimate[];
export function isSuspect(
  input: { attributes: number[] | Record<string, number>; authoredOvr: number; leagueMedian: number },
  thresholds?: Partial<SuspectThresholds>,
): boolean;
export function ovrTarget(leagueMedian: number, leagueSd: number, zShrunk: number, sdClamp?: { min: number; max: number }): number | null;
export function blendRating(
  input: { authoredOvr: number; leagueMedian: number; leagueSd: number; z: number | null | undefined; rho: number | null | undefined; suspect?: boolean },
  options?: Partial<BlendOptions>,
): BlendResult | null;
