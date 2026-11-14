import { championDisplayName } from "./championNames";
import { CHAMPION_COUNTERS, canonicalChampionId } from "./championRelationships";

/**
 * Entries shown per list. Five fits a card without scrolling, covers the strong counters
 * (values 3-5) of most champions, and matches the five rows of the page's win-rate matchup blocks.
 */
export const MATCHUP_LIMIT = 5;

export interface ChampionMatchup {
  /** Canonical id of the other champion, as stored in the counter dataset. */
  championId: string;
  /** Counter strength: 1 slight edge, 2 clear lane advantage, 3 strong, 4 hard counter, 5 near-unplayable. */
  value: number;
}

export interface ChampionMatchups {
  /** Champions this one counters. */
  strongAgainst: ChampionMatchup[];
  /** Champions that counter this one. */
  weakAgainst: ChampionMatchup[];
}

function byValueThenName(a: ChampionMatchup, b: ChampionMatchup): number {
  return b.value - a.value || championDisplayName(a.championId).localeCompare(championDisplayName(b.championId));
}

/**
 * Strongest and weakest matchups of a champion from the counter dataset, where a row
 * `{ source, target, value }` means `source` counters `target`.
 */
export function getChampionMatchups(championId: string, limit: number = MATCHUP_LIMIT): ChampionMatchups {
  const id = canonicalChampionId(championId);
  if (!id || limit <= 0) return { strongAgainst: [], weakAgainst: [] };
  const strongAgainst: ChampionMatchup[] = [];
  const weakAgainst: ChampionMatchup[] = [];
  for (const { source, target, value } of CHAMPION_COUNTERS) {
    if (source === id) strongAgainst.push({ championId: target, value });
    else if (target === id) weakAgainst.push({ championId: source, value });
  }
  return {
    strongAgainst: strongAgainst.sort(byValueThenName).slice(0, limit),
    weakAgainst: weakAgainst.sort(byValueThenName).slice(0, limit),
  };
}
