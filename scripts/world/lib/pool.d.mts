import type { Person, Tournament, TournamentClass } from "./pool-scope.mjs";
import type { World } from "./world.mjs";
import type { SkillEstimate } from "../../stats/lib/skill.mjs";
import type { Baselines } from "./pool-rating.mjs";

export const POOL_FILTER: "recommended";
export const DEFAULT_POOL_SINCE: string;
export const DEFAULT_QUALIFIER_CAP: number;
export const DEFAULT_POOL_PROBE: string;
export const POOL_LIMITS: Readonly<{ players: number; staff: number; opsPerList: number; overlayBytes: number }>;
export {
  GAME_POSITION, JUDGMENT_DEFAULT_TIER, RATING_GAME_TIER_DEFAULT, RATING_JUDGMENT_DEFAULT, RATING_LEAGUE_DEFAULT, RATING_STATS, RATING_TIER_DEFAULT, TIER_OFFSETS, tierBaselines,
} from "./pool-rating.mjs";
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
  /** The step of the position evidence that chose `role`: a (recent games), b (latest roster row), c (profile role on the roster), d (profile role inside a span), first, profile; null for staff. */
  step: string | null;
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
    sameAsGameRecord: number;
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
  rosterTitles?: { player?: Set<string>; staff?: Set<string> };
  recentRoles?: Map<string, { position: string; games: number; last: string }> | null;
}): PoolSelection;
/** How many of the selected players took each step of the position evidence. */
export function positionSteps(selection: PoolSelection): { a: number; b: number; c: number; d: number; first: number; profile: number };
/** Comparison key of a page title: NFKC, underscores as spaces, collapsed and trimmed whitespace, lower case. */
export function titleKey(title: unknown): string;

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
  /** The game's league levels and defaults: ratings anchor to them instead of to the tier baseline. */
  anchors?: import("./pool-rating.mjs").PoolAnchors | null;
}): { players: PoolOpEntry[]; staff: PoolOpEntry[]; skipped: Array<{ kind: string; subject: string; detail: string }> };
/** Leave out the pool players the world build would fold into a record on a club or hide from the AI; updates `selection` with why. */
export function dropWorldBuildTwins(input: {
  selection: PoolSelection;
  ops: { players: PoolOpEntry[]; staff: PoolOpEntry[]; skipped: Array<{ kind: string; subject: string; detail: string }> };
  contracted: Array<Record<string, any>>;
}): { players: PoolOpEntry[]; staff: PoolOpEntry[]; skipped: Array<{ kind: string; subject: string; detail: string }> };
