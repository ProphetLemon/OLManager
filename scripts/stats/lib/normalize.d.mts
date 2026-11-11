import type { GameRow } from "./skill.mjs";
import type { RawRow } from "./queries.mjs";

export const ROLE_MAP: Readonly<Record<string, GameRow["role"]>>;
export const TEAM_SIZE: number;
export const DROP_REASONS: Readonly<{
  duplicate: string;
  teamSize: string;
  teamDamage: string;
  role: string;
  date: string;
  minutes: string;
  link: string;
  stat: string;
}>;

export interface NormalizeStats {
  inputRows: number;
  rows: number;
  games: number;
  players: number;
}
export interface PlayerIndexEntry {
  /** In-game names seen for this Link, sorted. */
  names: string[];
  /** One entry per (team, competition), newest `lastDate` first. */
  teams: Array<{ team: string; competition: string; games: number; lastDate: string }>;
  /** Games per role, in Top, Jungle, Mid, Bot, Support order. */
  roles: Record<string, number>;
  games: number;
  firstDate: string;
  lastDate: string;
}
export type PlayerIndex = Record<string, PlayerIndexEntry>;

export interface NormalizeResult {
  rows: GameRow[];
  /** Per Leaguepedia Link, built from the kept rows only. */
  index: PlayerIndex;
  /** Dropped row counts by reason (see DROP_REASONS); only non-zero reasons, sorted by name. */
  dropped: Record<string, number>;
  stats: NormalizeStats;
}

export function dateOf(dateTime: unknown): string | null;
export function normalizeRows(rows: RawRow[], options: { competition: string }): NormalizeResult;
export function mergePlayerIndexes(indexes: PlayerIndex[]): PlayerIndex;
