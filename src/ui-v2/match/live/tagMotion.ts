import type { MapPoint } from "@/lib/match/live/mapGeometry";
import { isJump } from "@/ui-v2/_legacy/components/match/lol-prototype/ui/stepInterpolation";

/** What the layer needs of a champion to tell where it is going. */
export interface Walker {
  id: string;
  pos: MapPoint;
  alive: boolean;
  moveSpeed: number;
}

export interface TravelInput {
  /** The champion as of the commit before this one, when there was one. */
  before: Walker | undefined;
  /** The champion as of this commit. */
  after: Walker;
  /** Game seconds between the two commits. */
  elapsedGameSec: number;
  /** Game seconds from this commit to the next one, at the speed of the match. */
  aheadGameSec: number;
  /** Where the marker is drawn at this moment, which the engine's answer may be ahead of. */
  rendered?: MapPoint;
}

export interface Travel {
  from: MapPoint;
  to: MapPoint;
}

/**
 * The stretch a marker covers between this solve and the next. It starts where the marker is
 * drawn now, which is not where the last engine answer puts it (the markers blend towards the
 * answer), and ends where it will be by the next solve: the answer plus the walk it was on, at the
 * pace it kept since the commit before and never faster than the champion can go. A champion that
 * is dead, new, or that jumped (a recall, a flash) is only expected to reach its answer.
 */
export function projectTravel({ before, after, elapsedGameSec, aheadGameSec, rendered }: TravelInput): Travel {
  const from = rendered ?? after.pos;
  const settle: Travel = { from, to: after.pos };
  if (!after.alive || !before || !(elapsedGameSec > 0) || !(aheadGameSec > 0) || isJump(before, after, elapsedGameSec)) return settle;

  let vx = (after.pos.x - before.pos.x) / elapsedGameSec;
  let vy = (after.pos.y - before.pos.y) / elapsedGameSec;
  const pace = Math.hypot(vx, vy);
  if (Number.isFinite(after.moveSpeed) && after.moveSpeed > 0 && pace > after.moveSpeed) {
    vx *= after.moveSpeed / pace;
    vy *= after.moveSpeed / pace;
  }
  return { from, to: { x: after.pos.x + vx * aheadGameSec, y: after.pos.y + vy * aheadGameSec } };
}
