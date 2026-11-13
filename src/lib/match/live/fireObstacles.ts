import type { TowerBeam } from "@/lib/match/live/contacts";
import { beamGeometry } from "@/lib/match/live/linkGeometry";
import { MAP_UNITS, bubbleDiameterPx, structureDiameterPx, type MapPoint, type StructureKind } from "@/lib/match/live/mapGeometry";
import type { TagBox } from "@/lib/match/live/tagPlacement";

/**
 * The boxes a firing tower takes on the map, for the name tags to keep clear of: its dashed ring,
 * the beam to its target and the xN chip behind it. The callouts layer is drawn above the
 * champions, so a tag under any of these would be covered by it. Pure, in map units (0..1), and
 * worked out once per committed answer like the tags themselves.
 */

/** Clear space between a firing tower and its dashed ring, in pixels (the ring of `TowerFireLayer`). */
export const FIRE_RING_GAP_PX = 5;
/** Stroke of the ring and the beam's halo, which stand outside the radius and the line. */
const RING_STROKE_PX = 2;
/** Half the width a beam takes: its line, its halo and the arrowhead's arm. */
const BEAM_HALF_PX = 7;
/** Size of the xN chip. */
const CHIP_PX = { w: 34, h: 18 };

/** Box of `wPx` by `hPx` pixels centred on a point of the map. */
export function boxAround(center: MapPoint, wPx: number, hPx: number, sizePx: number): TagBox {
  const halfW = wPx / 2 / sizePx;
  const halfH = hPx / 2 / sizePx;
  return { x0: center.x - halfW, y0: center.y - halfH, x1: center.x + halfW, y1: center.y + halfH };
}

/**
 * A line as a row of squares along it, each `2 * halfPx` wide, so that a tag may sit beside a
 * diagonal beam and is only kept off the beam itself, not off the whole box around it.
 */
export function boxesAlong(from: MapPoint, to: MapPoint, halfPx: number, sizePx: number): TagBox[] {
  const lengthPx = Math.hypot(to.x - from.x, to.y - from.y) * sizePx;
  const count = Math.max(1, Math.ceil(lengthPx / (2 * halfPx)));
  const boxes: TagBox[] = [];
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    const point = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    boxes.push(boxAround(point, 2 * halfPx, 2 * halfPx, sizePx));
  }
  return boxes;
}

export interface FiringTower {
  kind: StructureKind;
  pos: MapPoint;
}

/** Ring, beam and chip of one tower shooting a target at `target`. A map with no size has none. */
export function towerFireObstacles(tower: FiringTower, target: MapPoint, sizePx: number): TagBox[] {
  if (!(sizePx > 0)) return [];
  const ringPx = structureDiameterPx(tower.kind, sizePx) / 2 + FIRE_RING_GAP_PX;
  const geometry = beamGeometry(tower.pos, target, ringPx, bubbleDiameterPx(sizePx) / 2, sizePx);
  const unit = (value: number) => value / MAP_UNITS;
  const ring = boxAround(tower.pos, 2 * (ringPx + RING_STROKE_PX), 2 * (ringPx + RING_STROKE_PX), sizePx);
  const beam = boxesAlong(
    { x: unit(geometry.x1), y: unit(geometry.y1) },
    { x: unit(geometry.x2), y: unit(geometry.y2) },
    BEAM_HALF_PX,
    sizePx,
  );
  return [ring, ...beam, boxAround(geometry.chip, CHIP_PX.w, CHIP_PX.h, sizePx)];
}

/** The obstacles of every tower that is shooting, from the committed positions. */
export function fireObstacles(
  beams: readonly Pick<TowerBeam, "structureId" | "targetId">[],
  structures: ReadonlyArray<{ id: string; kind: StructureKind; pos: MapPoint }>,
  champions: ReadonlyArray<{ id: string; pos: MapPoint }>,
  sizePx: number,
): TagBox[] {
  const towerById = new Map(structures.map((structure) => [structure.id, structure]));
  const targetById = new Map(champions.map((champion) => [champion.id, champion.pos]));
  return beams.flatMap((beam) => {
    const tower = towerById.get(beam.structureId);
    const target = targetById.get(beam.targetId);
    return tower && target ? towerFireObstacles(tower, target, sizePx) : [];
  });
}
