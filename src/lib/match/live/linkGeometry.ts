import { MAP_UNITS, type MapPoint } from "@/lib/match/live/mapGeometry";
import type { ContactPair } from "@/lib/match/live/contacts";

/**
 * Geometry of the contact links, in the 1000 unit space of the overlay SVG.
 * The link runs between the outer edges of the two bubbles, not between their
 * centres, so it never hides under a bubble, and the dot sits on the attacker.
 */

export interface LinkOptions {
  /** Radius of the second bubble when it differs (a tower beam ends on a champion). */
  radiusBPx?: number;
  /** Clear space between a bubble and the end of the link. */
  gapPx?: number;
  /** Below this length (px) the link is not drawn. */
  minLengthPx?: number;
}

export interface LinkEndpoints {
  /** End next to `a`. */
  x1: number;
  y1: number;
  /** End next to `b`. */
  x2: number;
  y2: number;
  lengthUnits: number;
  /** False when the bubbles touch or overlap: the chip and the rings still show the fight. */
  visible: boolean;
}

export function linkEndpoints(
  a: MapPoint,
  b: MapPoint,
  radiusPx: number,
  sizePx: number,
  options: LinkOptions = {},
): LinkEndpoints {
  const { radiusBPx = radiusPx, gapPx = 1.5, minLengthPx = 2 } = options;
  const ax = a.x * MAP_UNITS;
  const ay = a.y * MAP_UNITS;
  const bx = b.x * MAP_UNITS;
  const by = b.y * MAP_UNITS;
  const dx = bx - ax;
  const dy = by - ay;
  const centres = Math.hypot(dx, dy);
  const unitsPerPx = sizePx > 0 ? MAP_UNITS / sizePx : 0;
  const offsetA = (radiusPx + gapPx) * unitsPerPx;
  const offsetB = (radiusBPx + gapPx) * unitsPerPx;
  const length = centres - offsetA - offsetB;

  if (centres === 0 || unitsPerPx === 0 || length < minLengthPx * unitsPerPx) {
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    return { x1: mx, y1: my, x2: mx, y2: my, lengthUnits: 0, visible: false };
  }
  const ux = dx / centres;
  const uy = dy / centres;
  return {
    x1: ax + ux * offsetA,
    y1: ay + uy * offsetA,
    x2: bx - ux * offsetB,
    y2: by - uy * offsetB,
    lengthUnits: length,
    visible: true,
  };
}

/**
 * Which ends of a pair's link carry the dot: the end of whoever hit. Hits on `b`
 * come from `a`, so the dot is at `a`; both ends when it is mutual.
 */
export function linkDots(pair: Pick<ContactPair, "a" | "b" | "ageByTarget">): { atA: boolean; atB: boolean } {
  return {
    atA: pair.ageByTarget[pair.b] !== undefined,
    atB: pair.ageByTarget[pair.a] !== undefined,
  };
}

/** Where the chip of a link sits: the midpoint of the two centres, same space as the inputs. */
export function chipPosition(a: MapPoint, b: MapPoint): MapPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Opacity of a link or beam by the age of its hit: full, then 0.78, then 0.55. */
export function linkOpacity(ageSec: number): number {
  return ageSec < 1.5 ? 1 : ageSec < 3 ? 0.78 : 0.55;
}
