import type { Person, Tournament, TournamentClass } from "./pool-scope.mjs";
import type { World } from "./world.mjs";
import type { SkillEstimate } from "../../stats/lib/skill.mjs";
import type { Baselines } from "./pool-rating.mjs";

export const POOL_FILTER: "recommended";
export const DEFAULT_POOL_SINCE: string;
export const DEFAULT_QUALIFIER_CAP: number;
export const DEFAULT_POOL_PROBE: string;
export const POOL_LIMITS: Readonly<{ players: number; staff: number; opsPerList: number; overlayBytes: number }>;
export { GAME_POSITION, RATING_STATS, RATING_TIER_DEFAULT, TIER_OFFSETS, tierBaselines } from "./pool-rating.mjs";
export type { Baselines } from "./pool-rating.mjs";
export function compare(a: string, b: string): -1 | 0 | 1;
export function isoDate(value: unknown): string | null;
export function poolId(kind: "player" | "staff", page: string): string;

export interface PoolTournamentView {
  page: string;
  name: string;
  league: string;
  entries: number;
}
export function poolTournaments(
  tournaments: Tournament[],
  classes: Map<string, TournamentClass>,
  entryCount: Map<string, number>,
  cap?: number,
): { split: { small: string[]; open: string[] }; kept: PoolTournamentView[]; capped: PoolTournamentView[]; keptEntries: number; cappedEntries: number };

export interface PoolEntry {
  page: string;
  kind: "player" | "staff";
  id: string;
  /** Game position (Top, Jungle, Mid, ADC, Support) for a player, game staff role for staff. */
  role: string;
  person: Person;
}
export type PoolStatus =
  | { state: "added"; id: string }
  | { state: "excluded"; code: string; reason: string; id?: string }
  | { state: "refused"; code: string; reason: string };
export interface PoolSelection {
  players: PoolEntry[];
  staff: PoolEntry[];
  counts: {
    considered: number;
    noPage: number;
    inGame: number;
    onGameTeam: number;
    handledByRoster: number;
    uncertain: number;
    nonSportingStaff: number;
    noPosition: number;
    duplicates: number;
    collisions: number;
  };
  refused: Array<{ page: string; kind: "player" | "staff"; code: string; reason: string }>;
  collisions: Array<{ page: string; kind: "player" | "staff"; id: string; with: string }>;
  statuses: Map<string, PoolStatus>;
}
export function selectPool(input: {
  people: Map<string, Person>;
  context: { playerIndex: unknown; staffIndex: unknown; overrides?: unknown; teamKeys: Set<string> };
  world: World;
  rosterIds?: Set<string>;
}): PoolSelection;

export interface PoolOpEntry {
  op: Record<string, any>;
  id: string;
  teamId: null;
  competition: null;
  note: string;
}
export function buildPoolOps(input: {
  selection: PoolSelection;
  tournamentIndex?: Map<string, Tournament>;
  games?: Map<string, number> | null;
  /** Usable skill estimate per player page: a player with one that has enough games is rated from stats. */
  skill?: Map<string, SkillEstimate> | null;
  baselines: Baselines;
}): { players: PoolOpEntry[]; staff: PoolOpEntry[]; skipped: Array<{ kind: string; subject: string; detail: string }> };
