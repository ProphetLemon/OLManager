import { describe, expect, it } from "vitest";

import { boxAround, boxesAlong, FIRE_RING_GAP_PX, fireObstacles, towerFireObstacles } from "@/lib/match/live/fireObstacles";
import { bubbleDiameterPx, structureDiameterPx } from "@/lib/match/live/mapGeometry";
import { placeTags, type TagBox, type TagChampion, type TagPlacement } from "@/lib/match/live/tagPlacement";

const SIZE = 474;
const TOWER = { kind: "tower" as const, pos: { x: 0.5, y: 0.5 } };

const overlap = (a: TagBox, b: TagBox) => !(a.x1 < b.x0 || b.x1 < a.x0 || a.y1 < b.y0 || b.y1 < a.y0);
const boxOf = (placement: TagPlacement): TagBox => {
  if (!("box" in placement)) throw new Error("expected a placed tag");
  return placement.box;
};
const champ = (id: string, x: number, y: number): TagChampion => ({ id, pos: { x, y }, name: "ROOSTER" });

describe("boxAround and boxesAlong", () => {
  it("builds a box of the given pixel size around a point of the map", () => {
    const box = boxAround({ x: 0.5, y: 0.25 }, 40, 20, 400);
    expect((box.x1 - box.x0) * 400).toBeCloseTo(40, 8);
    expect((box.y1 - box.y0) * 400).toBeCloseTo(20, 8);
    expect((box.x0 + box.x1) / 2).toBeCloseTo(0.5, 8);
    expect((box.y0 + box.y1) / 2).toBeCloseTo(0.25, 8);
  });

  it("covers a line end to end with no gap between two boxes", () => {
    const from = { x: 0.2, y: 0.2 };
    const to = { x: 0.6, y: 0.45 };
    const boxes = boxesAlong(from, to, 7, SIZE);
    for (let t = 0; t <= 1; t += 0.01) {
      const point = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
      const probe = boxAround(point, 0, 0, SIZE);
      expect(
        boxes.some((box) => overlap(box, probe)),
        `a hole in the line at ${t.toFixed(2)}`,
      ).toBe(true);
    }
  });

  it("leaves room beside a diagonal line, where one box around the whole line would not", () => {
    const boxes = boxesAlong({ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }, 7, SIZE);
    const corner = boxAround({ x: 0.45, y: 0.15 }, 20, 20, SIZE);
    expect(boxes.some((box) => overlap(box, corner))).toBe(false);
  });
});

describe("towerFireObstacles", () => {
  it("includes the dashed ring of the tower, ring gap and stroke included", () => {
    const [ring] = towerFireObstacles(TOWER, { x: 0.5, y: 0.2 }, SIZE);
    const radius = structureDiameterPx("tower", SIZE) / 2 + FIRE_RING_GAP_PX;
    expect((ring.x1 - ring.x0) * SIZE).toBeGreaterThanOrEqual(2 * radius);
    expect((ring.x0 + ring.x1) / 2).toBeCloseTo(0.5, 8);
    expect((ring.y0 + ring.y1) / 2).toBeCloseTo(0.5, 8);
  });

  it("covers a short beam to an adjacent target, which is stretched to its minimum length", () => {
    const target = { x: 0.5, y: 0.5 - (bubbleDiameterPx(SIZE) / 2 + 6) / SIZE };
    const boxes = towerFireObstacles(TOWER, target, SIZE);
    // Ring, at least two boxes of beam, and the chip.
    expect(boxes.length).toBeGreaterThanOrEqual(4);
    const above = boxAround({ x: 0.5, y: 0.5 - 18 / SIZE }, 4, 4, SIZE);
    expect(boxes.some((box) => overlap(box, above))).toBe(true);
  });

  it("puts the chip on the far side of the tower from the target", () => {
    const boxes = towerFireObstacles(TOWER, { x: 0.5, y: 0.3 }, SIZE);
    const chip = boxes[boxes.length - 1];
    expect((chip.y0 + chip.y1) / 2).toBeGreaterThan(0.5);
  });

  it("has nothing on a map with no size yet", () => {
    expect(towerFireObstacles(TOWER, { x: 0.5, y: 0.3 }, 0)).toEqual([]);
  });
});

describe("fireObstacles", () => {
  const structures = [{ id: "t1", kind: "tower" as const, pos: { x: 0.5, y: 0.5 } }];
  const champions = [{ id: "c1", pos: { x: 0.5, y: 0.4 } }];

  it("works out the obstacles of each beam from the tower and the target it names", () => {
    const boxes = fireObstacles([{ structureId: "t1", targetId: "c1" }], structures, champions, SIZE);
    expect(boxes).toEqual(towerFireObstacles(structures[0], champions[0].pos, SIZE));
  });

  it("skips a beam whose tower or target is not in the state", () => {
    expect(fireObstacles([{ structureId: "gone", targetId: "c1" }], structures, champions, SIZE)).toEqual([]);
    expect(fireObstacles([{ structureId: "t1", targetId: "gone" }], structures, champions, SIZE)).toEqual([]);
    expect(fireObstacles([], structures, champions, SIZE)).toEqual([]);
  });
});

describe("tags next to a firing tower", () => {
  // The tower shoots the champion just above it: the tag that would sit below the champion lands
  // on the ring and on the beam (the "ROOSTER Peleando" tag of the real-app check).
  const target = champ("a", 0.5, 0.5 - 24 / SIZE);
  const sizes = { full: { w: 60, h: 18 }, compact: { w: 32, h: 18 } };
  const fire = towerFireObstacles(TOWER, target.pos, SIZE);

  it("would sit below the champion if the tower's mark were not an obstacle", () => {
    const result = placeTags([{ ...target, sizes }], undefined, { sizePx: SIZE });
    expect(result.a).toMatchObject({ slot: "below" });
    expect(fire.some((box) => overlap(box, boxOf(result.a)))).toBe(true);
  });

  it("takes another slot, clear of the ring, the beam and the chip, when it is", () => {
    const result = placeTags([{ ...target, sizes }], undefined, { sizePx: SIZE, obstacles: fire });
    expect(result.a).not.toMatchObject({ slot: "below" });
    expect(result.a.form).not.toBe("none");
    for (const box of fire) expect(overlap(box, boxOf(result.a))).toBe(false);
  });

  it("falls back to a badge for a champion with a state when no slot is clear", () => {
    const wall: TagBox = { x0: 0, y0: 0, x1: 1, y1: 1 };
    const result = placeTags([{ ...target, sizes, sub: "Peleando" }], undefined, { sizePx: SIZE, obstacles: [wall, ...fire] });
    expect(result.a).toEqual({ form: "badge" });
  });
});
