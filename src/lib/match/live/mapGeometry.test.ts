import { describe, expect, it } from "vitest";
import {
  BUBBLE_MAX_PX,
  BUBBLE_MIN_PX,
  CAMP_POINTS,
  LANES,
  LANE_HALF_WIDTH_UNITS,
  MAP_UNITS,
  PITS,
  STRUCTURE_SHAPE,
  TEAM_MARKER_SHAPE,
  anchorTransform,
  bubbleDiameterPx,
  distanceToPolyline,
  fromPx,
  isInBase,
  isOnLane,
  pointInPolygon,
  structureDiameterPx,
  toPx,
  toUnits,
} from "@/lib/match/live/mapGeometry";
import { JUNGLE_CAMPS_LAYOUT, NEUTRAL_OBJECTIVES_LAYOUT, STRUCTURES_LAYOUT } from "@/lib/match/lolMapLayout";

describe("structures sit on the drawn terrain", () => {
  it("places every lane structure on its lane stroke and every base structure in its base", () => {
    const offenders: string[] = [];
    for (const s of STRUCTURES_LAYOUT) {
      const p = toUnits(s);
      const ok = s.lane === "base" ? isInBase(p, s.side) : isOnLane(p, s.lane);
      if (!ok) offenders.push(`${s.id} (${s.lane})`);
    }
    expect(offenders).toEqual([]);
    expect(STRUCTURES_LAYOUT).toHaveLength(30);
  });

  it("is not trivially true: a point far from every lane and base is rejected", () => {
    const middleOfNowhere = { x: 480, y: 130 };
    expect(isOnLane(middleOfNowhere, "top")).toBe(false);
    expect(isInBase(middleOfNowhere, "blue")).toBe(false);
    expect(distanceToPolyline(middleOfNowhere, LANES.mid)).toBeGreaterThan(LANE_HALF_WIDTH_UNITS);
  });

  it("starts every lane in the blue base and ends it in the red base", () => {
    for (const lane of Object.values(LANES)) {
      expect(isInBase(lane[0], "blue")).toBe(true);
      expect(isInBase(lane[lane.length - 1], "red")).toBe(true);
    }
  });

  it("mirrors the red base from the blue base", () => {
    expect(isInBase({ x: 120, y: 880 }, "blue")).toBe(true);
    expect(isInBase({ x: MAP_UNITS - 120, y: MAP_UNITS - 880 }, "red")).toBe(true);
    expect(isInBase({ x: 120, y: 880 }, "red")).toBe(false);
  });
});

describe("pits and camps", () => {
  it("takes the pits from the engine layout", () => {
    const baron = NEUTRAL_OBJECTIVES_LAYOUT.find((o) => o.id === "baron-pit")!;
    const dragon = NEUTRAL_OBJECTIVES_LAYOUT.find((o) => o.id === "dragon-pit")!;
    expect(PITS.top).toEqual({ x: baron.x * MAP_UNITS, y: baron.y * MAP_UNITS });
    expect(PITS.dragon).toEqual({ x: dragon.x * MAP_UNITS, y: dragon.y * MAP_UNITS });
  });

  it("keeps every jungle camp inside the map", () => {
    expect(CAMP_POINTS).toHaveLength(JUNGLE_CAMPS_LAYOUT.length);
    for (const camp of CAMP_POINTS) {
      expect(camp.x).toBeGreaterThan(0);
      expect(camp.x).toBeLessThan(MAP_UNITS);
      expect(camp.y).toBeGreaterThan(0);
      expect(camp.y).toBeLessThan(MAP_UNITS);
    }
  });
});

describe("projection", () => {
  it.each([320, 540, 660])("round-trips a position at %i px", (size) => {
    const pos = { x: 0.4016927083333333, y: 0.5755208333333334 };
    const px = toPx(pos, size);
    expect(px.x).toBeCloseTo(pos.x * size, 1);
    expect(px.y).toBeCloseTo(pos.y * size, 1);
    const back = fromPx(px, size);
    expect(back.x).toBeCloseTo(pos.x, 2);
    expect(back.y).toBeCloseTo(pos.y, 2);
  });

  it("maps the corners to the corners", () => {
    expect(toPx({ x: 0, y: 0 }, 540)).toEqual({ x: 0, y: 0 });
    expect(toPx({ x: 1, y: 1 }, 540)).toEqual({ x: 540, y: 540 });
  });

  it("maps to the origin when the map has no size yet", () => {
    expect(fromPx({ x: 10, y: 10 }, 0)).toEqual({ x: 0, y: 0 });
  });

  it("builds the anchor transform with translate, never left or top", () => {
    expect(anchorTransform({ x: 0.5, y: 0.25 }, 540)).toBe("translate(270px, 135px)");
  });
});

describe("hit tests", () => {
  it("finds a point in a polygon and rejects one outside", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false);
  });

  it("measures the distance to a polyline segment, not only to its vertices", () => {
    const l = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    expect(distanceToPolyline({ x: 50, y: 7 }, l)).toBe(7);
    expect(distanceToPolyline({ x: 110, y: 0 }, l)).toBe(10);
  });
});

describe("marker shapes", () => {
  it("separates the teams by shape as well as colour", () => {
    expect(TEAM_MARKER_SHAPE.blue).not.toBe(TEAM_MARKER_SHAPE.red);
    for (const kind of Object.values(STRUCTURE_SHAPE)) {
      expect(kind.blue.shape).not.toBe(kind.red.shape);
    }
  });

  it("grows from tower to inhibitor to nexus", () => {
    expect(STRUCTURE_SHAPE.tower.blue.sizeUnits).toBeLessThan(STRUCTURE_SHAPE.inhib.blue.sizeUnits);
    expect(STRUCTURE_SHAPE.inhib.blue.sizeUnits).toBeLessThan(STRUCTURE_SHAPE.nexus.blue.sizeUnits);
  });
});

describe("bubbleDiameterPx", () => {
  it("never drops below the 24 px touch target, even on the smallest map", () => {
    expect(BUBBLE_MIN_PX).toBe(24);
    expect(bubbleDiameterPx(320)).toBe(24);
    expect(bubbleDiameterPx(0)).toBe(24);
  });

  it("grows with the map in between and stops at 38 px", () => {
    expect(bubbleDiameterPx(540)).toBeCloseTo(25.92, 2);
    expect(bubbleDiameterPx(660)).toBeCloseTo(31.68, 2);
    expect(BUBBLE_MAX_PX).toBe(38);
    expect(bubbleDiameterPx(1000)).toBe(38);
  });
});

describe("structureDiameterPx", () => {
  it("keeps each kind between its floor and its ceiling", () => {
    expect(structureDiameterPx("tower", 320)).toBe(11);
    expect(structureDiameterPx("tower", 1000)).toBe(22);
    expect(structureDiameterPx("inhib", 320)).toBe(15);
    expect(structureDiameterPx("inhib", 1000)).toBe(30);
    expect(structureDiameterPx("nexus", 320)).toBe(24);
    expect(structureDiameterPx("nexus", 1000)).toBe(48);
  });

  it("grows with the map in between and keeps the kinds in order", () => {
    expect(structureDiameterPx("tower", 660)).toBeCloseTo(15.18, 2);
    for (const size of [320, 540, 660, 1000]) {
      expect(structureDiameterPx("tower", size)).toBeLessThan(structureDiameterPx("inhib", size));
      expect(structureDiameterPx("inhib", size)).toBeLessThan(structureDiameterPx("nexus", size));
    }
  });
});
