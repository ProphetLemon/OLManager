import { describe, expect, it } from "vitest";

import { projectTravel, type Walker } from "./tagMotion";

const walker = (x: number, y: number, over: Partial<Walker> = {}): Walker => ({
  id: "a",
  pos: { x, y },
  alive: true,
  moveSpeed: 0.05,
  ...over,
});

describe("projectTravel", () => {
  it("starts where the marker is drawn, not where the last answer says it is", () => {
    const travel = projectTravel({
      before: walker(0.4, 0.5),
      after: walker(0.42, 0.5),
      elapsedGameSec: 1,
      aheadGameSec: 0,
      rendered: { x: 0.41, y: 0.5 },
    });
    expect(travel.from).toEqual({ x: 0.41, y: 0.5 });
    expect(travel.to).toEqual({ x: 0.42, y: 0.5 });
  });

  it("carries the walk it was on to the next solve", () => {
    const travel = projectTravel({ before: walker(0.4, 0.5), after: walker(0.42, 0.5), elapsedGameSec: 1, aheadGameSec: 2 });
    expect(travel.to.x).toBeCloseTo(0.42 + 0.02 * 2, 9);
    expect(travel.to.y).toBeCloseTo(0.5, 9);
  });

  it("never lets it go faster than the champion can", () => {
    // It covered 0.02 in a second, which the engine's slack allows, but its own pace is 0.01.
    const travel = projectTravel({
      before: walker(0.4, 0.5, { moveSpeed: 0.01 }),
      after: walker(0.42, 0.5, { moveSpeed: 0.01 }),
      elapsedGameSec: 1,
      aheadGameSec: 10,
    });
    expect(travel.to.x).toBeCloseTo(0.42 + 0.01 * 10, 9);
  });

  it("expects only the answer from a champion that is dead, new, or that jumped", () => {
    const base = { elapsedGameSec: 1, aheadGameSec: 5 };
    expect(projectTravel({ ...base, before: walker(0.4, 0.5), after: walker(0.42, 0.5, { alive: false }) }).to).toEqual({ x: 0.42, y: 0.5 });
    expect(projectTravel({ ...base, before: undefined, after: walker(0.42, 0.5) }).to).toEqual({ x: 0.42, y: 0.5 });
    // A recall: it is across the map after one second.
    expect(projectTravel({ ...base, before: walker(0.4, 0.5), after: walker(0.9, 0.9) }).to).toEqual({ x: 0.9, y: 0.9 });
  });

  it("stands still when no game time passed between the commits", () => {
    expect(projectTravel({ before: walker(0.4, 0.5), after: walker(0.4, 0.5), elapsedGameSec: 0, aheadGameSec: 5 }).to).toEqual({ x: 0.4, y: 0.5 });
  });
});
