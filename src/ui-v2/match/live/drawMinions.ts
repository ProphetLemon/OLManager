import type { MapPoint } from "@/lib/match/live/mapGeometry";

/** The two team colours the canvas paints with, as CSS colour strings read from the theme tokens. */
export interface MinionColors {
  blue: string;
  red: string;
}

/** What `drawMinions` needs of a minion. The engine's `MinionState` fits. */
export interface MinionLike {
  team: string;
  pos: MapPoint;
  alive: boolean;
  kind: string;
}

/** The calls `drawMinions` makes, so a recording fake can stand in for the real 2D context. */
export type MinionContext = Pick<
  CanvasRenderingContext2D,
  "clearRect" | "beginPath" | "arc" | "fill" | "fillRect" | "fillStyle"
>;

/** A minion is this share of the map, kept between 4 and 8 pixels. */
const MINION_MAP_FRACTION = 0.0085;
const MINION_MIN_PX = 4;
const MINION_MAX_PX = 8;

/** Side of a minion marker in pixels for a map `sizePx` wide. */
export function minionDiameterPx(sizePx: number): number {
  return Math.min(MINION_MAX_PX, Math.max(MINION_MIN_PX, sizePx * MINION_MAP_FRACTION));
}

/**
 * Paints the lane minions in one pass: blue as a circle, red as a square, so the team does not
 * rest on colour alone. Summons and dead minions are left out. The context works in CSS pixels
 * (the caller scales it for the screen's pixel ratio). Returns how many it drew.
 */
export function drawMinions(
  context: MinionContext,
  minions: readonly MinionLike[],
  sizePx: number,
  colors: MinionColors,
): number {
  context.clearRect(0, 0, sizePx, sizePx);
  const diameter = minionDiameterPx(sizePx);
  const radius = diameter / 2;
  let drawn = 0;
  for (const minion of minions) {
    if (!minion.alive || minion.kind === "summon") continue;
    const x = minion.pos.x * sizePx;
    const y = minion.pos.y * sizePx;
    if (minion.team === "red") {
      context.fillStyle = colors.red;
      context.fillRect(x - radius, y - radius, diameter, diameter);
    } else {
      context.fillStyle = colors.blue;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }
    drawn += 1;
  }
  return drawn;
}
