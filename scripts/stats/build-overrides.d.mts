import type { GamePlayer } from "./lib/game-world.mjs";
import type { MatchResult } from "./lib/identity.mjs";
import type { LeagueLevel, LeagueLevelCounts } from "./lib/levels.mjs";
import type { PlayerIndex } from "./lib/normalize.mjs";
import type { GameRow } from "./lib/skill.mjs";

export const ASSET_VERSION: number;
export const METHOD: string;
export const SOURCE: string;
export const THRESHOLDS: readonly number[];
export const SPOTLIGHT: readonly string[];

export interface OverrideEntry {
  id: string;
  authored_ovr: number;
  games: number;
  confidence: number;
  attributes: Record<string, number>;
  potential_floor: number;
}
export interface OverridesAsset {
  version: number;
  method: string;
  source: string;
  window: { since: string; until: string };
  league_levels: Record<string, LeagueLevel>;
  entries: OverrideEntry[];
}
export interface BuildReport {
  method: string;
  window: { since: string; until: string };
  referenceDate: string;
  levels: Record<string, LeagueLevel & LeagueLevelCounts>;
  totals: Record<string, any>;
  competitions: Array<{ competition: string; players: number; matched: number; estimated: number; entries: number; meanAbsDelta: number; maxAbsDelta: number }>;
  thresholds: Array<{ ovr: number; up: number; down: number }>;
  risers: Array<Record<string, any>>;
  fallers: Array<Record<string, any>>;
  suspects: Array<Record<string, any>>;
  review: MatchResult["review"];
  unmatched: MatchResult["unmatched"];
  pinIssues: string[];
  mismatches: Array<Record<string, any>>;
  spotlight: Array<{ query: string; found: boolean; players: Array<Record<string, any>> }>;
  world?: unknown;
}
export interface BuildArgs {
  rows: string;
  players: string;
  data: string;
  overlay: string;
  teamMap: string;
  pins: string;
  out: string;
  reportDir: string;
  includePlaceholders: boolean;
  help: boolean;
}

export function buildOverrides(input: {
  rows: GameRow[];
  window: { since: string; until: string };
  index: PlayerIndex;
  players: GamePlayer[];
  teamMap: { teams?: Record<string, { title: string | null; name: string }> } | null | undefined;
  pins?: Record<string, string | null>;
  includePlaceholders?: boolean;
}): { asset: OverridesAsset; report: BuildReport };
export function renderReport(report: BuildReport): string;
export function parseArgs(argv: string[]): BuildArgs;
export function runBuild(args: BuildArgs, log?: (message: string) => void): { asset: OverridesAsset; report: BuildReport };
