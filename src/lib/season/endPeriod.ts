import { resolveUserLeague } from "@/lib/userLeague";
import type { GameStateData } from "@/store/types";

/**
 * What the end screen is closing: a split that leaves later splits in the same
 * season, or the season itself. `advance_to_next_season` runs in both cases; the
 * backend only wraps the season when the finished split was the last one of the
 * league's manifest (`split_index + 1 >= splits.len()`), and this mirrors that rule.
 * Without a manifest the legacy single-schedule rollover runs, which is a season.
 */
export type EndPeriod = { kind: "season" } | { kind: "split"; name: string | null };

export function resolveEndPeriod(gameState: GameStateData | null | undefined): EndPeriod {
  const league = resolveUserLeague(gameState);
  const competitionId = gameState?.user_competition_id;
  const splits = competitionId ? gameState?.competition_configs?.[competitionId]?.schedule?.splits : undefined;
  if (!league || !splits) return { kind: "season" };
  const index = league.split_index ?? 0;
  if (index + 1 >= splits.length) return { kind: "season" };
  const name = splits[index]?.name?.trim();
  return { kind: "split", name: name ? name : null };
}
