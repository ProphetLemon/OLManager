import type { TeamSide } from "@/lib/match/live/mapGeometry";

/**
 * What the end panel says about a finished match. Pure: numbers and sides, never text, so the
 * screen translates it. Fields the engine did not send read as 0.
 */

export interface SideTotals {
  kills: number;
  towers: number;
  dragons: number;
  gold: number;
}

export interface EndSummary {
  winner: TeamSide;
  /** How the match ended for the manager: a win, a loss, or null when they were not playing it. */
  outcome: "victory" | "defeat" | null;
  durationSec: number;
  blue: SideTotals;
  red: SideTotals;
  /** Final gold difference; `side` is null when the teams finished level. */
  lead: { side: TeamSide | null; amount: number };
}

interface StatsLike {
  kills?: number;
  towers?: number;
  dragons?: number;
  gold?: number;
}

export interface FinishedStateLike {
  timeSec?: number;
  winner?: TeamSide | null;
  stats?: { blue?: StatsLike; red?: StatsLike };
}

const whole = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0);

const totalsOf = (stats: StatsLike | undefined): SideTotals => ({
  kills: whole(stats?.kills),
  towers: whole(stats?.towers),
  dragons: whole(stats?.dragons),
  gold: whole(stats?.gold),
});

/** The summary of a finished match, or null while nobody has won. `userSide` is the manager's side, if any. */
export function endSummary(state: FinishedStateLike | null | undefined, userSide: TeamSide | null = null): EndSummary | null {
  if (!state?.winner) return null;
  const blue = totalsOf(state.stats?.blue);
  const red = totalsOf(state.stats?.red);
  const diff = blue.gold - red.gold;
  return {
    winner: state.winner,
    outcome: userSide ? (userSide === state.winner ? "victory" : "defeat") : null,
    durationSec: typeof state.timeSec === "number" && Number.isFinite(state.timeSec) ? Math.max(0, Math.floor(state.timeSec)) : 0,
    blue,
    red,
    lead: { side: diff === 0 ? null : diff > 0 ? "blue" : "red", amount: Math.abs(diff) },
  };
}
