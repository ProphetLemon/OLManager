import { describe, expect, it } from "vitest";

import { LANE_EVEN_BAND, laneStripView, progressAlong, type LaneMinion } from "@/lib/match/live/laneStrip";
import { LANES, MAP_UNITS, type LaneKey, type MapPoint } from "@/lib/match/live/mapGeometry";

/** A point of a lane in the engine's 0..1 space, `t` along it from the blue base. */
function at(lane: LaneKey, t: number): MapPoint {
  const points = LANES[lane];
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  const total = lengths.reduce((sum, value) => sum + value, 0);
  let left = t * total;
  for (let i = 0; i < lengths.length; i += 1) {
    if (left <= lengths[i] || i === lengths.length - 1) {
      const k = lengths[i] === 0 ? 0 : Math.min(1, left / lengths[i]);
      return {
        x: (points[i].x + (points[i + 1].x - points[i].x) * k) / MAP_UNITS,
        y: (points[i].y + (points[i + 1].y - points[i].y) * k) / MAP_UNITS,
      };
    }
    left -= lengths[i];
  }
  return { x: 0, y: 0 };
}

const minion = (team: "blue" | "red", lane: LaneKey, t: number, over: Partial<LaneMinion> = {}): LaneMinion => ({
  team,
  lane,
  pos: at(lane, t),
  alive: true,
  kind: "melee",
  ...over,
});

const view = (minions: LaneMinion[], champions: Array<{ id: string; pos: MapPoint; alive?: boolean }> = [], fightingIds: string[] = []) =>
  laneStripView({ minions, champions: champions.map((c) => ({ alive: true, ...c })), fightingIds });
const of = (lanes: ReturnType<typeof view>, lane: LaneKey) => lanes.find((entry) => entry.lane === lane)!;

describe("progressAlong", () => {
  it("is 0 at the first point of the polyline and 1 at the last, and grows in between", () => {
    const line = LANES.mid;
    expect(progressAlong(line, line[0])).toBeCloseTo(0, 3);
    expect(progressAlong(line, line[line.length - 1])).toBeCloseTo(1, 3);
    expect(progressAlong(line, { x: 500, y: 500 })).toBeCloseTo(0.5, 2);
    expect(progressAlong(line, { x: 402, y: 576 })).toBeLessThan(progressAlong(line, { x: 596, y: 441 }));
  });
});

describe("laneStripView: which way each lane's wave pushes", () => {
  it("lists the three lanes in reading order, each with no wave and no fight on an empty map", () => {
    expect(view([])).toEqual([
      { lane: "top", push: "none", front: null, fight: false },
      { lane: "mid", push: "none", front: null, fight: false },
      { lane: "bot", push: "none", front: null, fight: false },
    ]);
  });

  it("reads the waves meeting in the middle as even", () => {
    const lanes = view([minion("blue", "mid", 0.45), minion("red", "mid", 0.55)]);
    expect(of(lanes, "mid").push).toBe("even");
    expect(of(lanes, "mid").front).toBeCloseTo(0.5, 1);
  });

  it("says blue pushes when the waves meet on the red half, and red when they meet on the blue half", () => {
    const blue = view([minion("blue", "top", 0.6), minion("red", "top", 0.8)]);
    expect(of(blue, "top").push).toBe("blue");
    expect(of(blue, "top").front!).toBeGreaterThan(0.5 + LANE_EVEN_BAND);
    const red = view([minion("blue", "bot", 0.15), minion("red", "bot", 0.35)]);
    expect(of(red, "bot").push).toBe("red");
    expect(of(red, "bot").front!).toBeLessThan(0.5 - LANE_EVEN_BAND);
  });

  it("gives a wave with nobody against it to its own side, wherever it stands", () => {
    // Fresh blue minions near the blue base with the red wave dead are blue's, not red's.
    const lanes = view([minion("blue", "mid", 0.1), minion("blue", "mid", 0.14)]);
    expect(of(lanes, "mid").push).toBe("blue");
    expect(of(view([minion("red", "mid", 0.9)]), "mid").push).toBe("red");
  });

  it("weighs each side once, so a wave of six against a wave of two still meets in between", () => {
    const six = Array.from({ length: 6 }, (_, i) => minion("blue", "mid", 0.3 + i * 0.01));
    const lanes = view([...six, minion("red", "mid", 0.7), minion("red", "mid", 0.71)]);
    expect(of(lanes, "mid").front).toBeCloseTo(0.5, 1);
    expect(of(lanes, "mid").push).toBe("even");
  });

  it("ignores dead minions and summons, and reads each minion on the lane it is assigned to", () => {
    const lanes = view([
      minion("blue", "mid", 0.5, { alive: false }),
      minion("red", "mid", 0.95, { kind: "summon" }),
      minion("blue", "top", 0.6),
    ]);
    expect(of(lanes, "mid").push).toBe("none");
    expect(of(lanes, "top").push).toBe("blue");
    expect(of(lanes, "bot").push).toBe("none");
  });
});

describe("laneStripView: where the fights are", () => {
  const champ = (id: string, lane: LaneKey, t: number, over: { alive?: boolean } = {}) => ({ id, pos: at(lane, t), ...over });

  it("marks the lane a fighting champion stands on, and only that one", () => {
    const lanes = view([], [champ("a", "bot", 0.5), champ("b", "bot", 0.52), champ("c", "mid", 0.3)], ["a", "b"]);
    expect(of(lanes, "bot").fight).toBe(true);
    expect(of(lanes, "mid").fight).toBe(false);
    expect(of(lanes, "top").fight).toBe(false);
  });

  it("does not mark a fight in the jungle, far from every lane", () => {
    const lanes = view([], [{ id: "a", pos: { x: 0.3, y: 0.45 } }], ["a"]);
    expect(lanes.every((lane) => !lane.fight)).toBe(true);
  });

  it("does not mark a fight in a base, where the three lanes run together", () => {
    const lanes = view([], [{ id: "a", pos: { x: 0.14, y: 0.87 } }, { id: "b", pos: { x: 0.9, y: 0.12 } }], ["a", "b"]);
    expect(lanes.every((lane) => !lane.fight)).toBe(true);
  });

  it("gives a fight in the middle of the map to the nearest lane only", () => {
    const lanes = view([], [{ id: "a", pos: { x: 0.5, y: 0.5 } }], ["a"]);
    expect(lanes.filter((lane) => lane.fight).map((lane) => lane.lane)).toEqual(["mid"]);
  });

  it("ignores a champion who is not in a fight, and one who is dead", () => {
    const lanes = view([], [champ("a", "top", 0.5), champ("b", "mid", 0.5, { alive: false })], ["b"]);
    expect(lanes.every((lane) => !lane.fight)).toBe(true);
  });
});
