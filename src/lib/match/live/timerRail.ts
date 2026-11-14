import { readTeamBuffs, type DragonKind } from "@/lib/match/live/liveEvents";
import type { TeamSide } from "@/lib/match/live/mapGeometry";
import {
  BARON_BUFF_SEC,
  ELDER_BUFF_SEC,
  pitViews,
  statusOf,
  type ObjectivesStateLike,
  type PitStatus,
  type TimerLike,
} from "@/lib/match/live/objectivesView";

export type RailTimerId = "dragon" | "voidgrubs" | "herald" | "baron";

/** A team's running Baron or Elder buff, shown on the tile of the monster that gave it. */
export interface RailBuff {
  side: TeamSide;
  remainingSec: number;
  totalSec: number;
}

export interface RailTimer {
  id: RailTimerId;
  /** What the dragon tile holds: the dragon, or the Elder once it is unlocked. */
  entity: "dragon" | "elder" | "voidgrubs" | "herald" | "baron";
  dragonKind: DragonKind | null;
  status: PitStatus;
  /** Herald tile only: the side whose champion carries the charge. */
  carrier: TeamSide | null;
  buff: RailBuff | null;
}

const SIDES: readonly TeamSide[] = ["blue", "red"];

/** The side with time left on a buff, and how much; at most one side holds Baron or Elder at a time. */
function runningBuff(state: ObjectivesStateLike, field: "baronUntil" | "elderUntil", totalSec: number): RailBuff | null {
  let best: RailBuff | null = null;
  for (const side of SIDES) {
    const remainingSec = readTeamBuffs(state, side)[field] - state.timeSec;
    if (remainingSec > 0 && (!best || remainingSec > best.remainingSec)) best = { side, remainingSec, totalSec };
  }
  return best;
}

/**
 * The objective timers the screen keeps on show: the dragon (the Elder once unlocked), the
 * Voidgrubs, the Herald and Baron, each from the engine's own timer for it, plus a running Baron
 * or Elder buff on the tile that gave it. Only what the engine sends: a timer with no next spawn
 * reads as over, and there is no inhibitor timer because the engine sends none.
 */
export function timerRailView(state: ObjectivesStateLike): RailTimer[] {
  const [dragon, top] = pitViews(state);
  const entities = state.neutralTimers?.entities;
  const timer = (id: "voidgrubs" | "herald" | "baron", fallback?: TimerLike): RailTimer => ({
    id,
    entity: id,
    dragonKind: null,
    status: statusOf(entities?.[id] ?? fallback, id === "baron" ? state.objectives?.baron?.nextSpawnAt : null, state.timeSec),
    carrier: id === "herald" ? (top.heraldCarrier?.side ?? null) : null,
    buff: id === "baron" ? runningBuff(state, "baronUntil", BARON_BUFF_SEC) : null,
  });
  return [
    {
      id: "dragon",
      entity: dragon.entity === "elder" ? "elder" : "dragon",
      dragonKind: dragon.dragonKind,
      status: dragon.status,
      carrier: null,
      buff: runningBuff(state, "elderUntil", ELDER_BUFF_SEC),
    },
    timer("voidgrubs"),
    timer("herald"),
    timer("baron", state.objectives?.baron ? { alive: state.objectives.baron.alive } : undefined),
  ];
}
