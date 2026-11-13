import { describe, expect, it } from "vitest";

import {
  GUARD_HOLD_MS,
  createGuardState,
  guardTagsFor,
  stepTagGuard,
  type GuardFrame,
  type GuardState,
  type GuardTag,
} from "./tagGuard";
import { placeTags, type TagBox, type TagChampion } from "./tagPlacement";

const GAP = 0.001;

/** A tag 0.1 wide and 0.04 tall, hanging 0.03 below its marker. */
const tag = (id: string): GuardTag => ({
  id,
  from: { x: 0, y: 0 },
  offset: { x0: -0.05, y0: 0.03, x1: 0.05, y1: 0.07 },
});

function setup(ids: string[], anchors: number[], obstacles: TagBox[] = []) {
  const tags = ids.map(tag);
  const state: GuardState = createGuardState(ids);
  const step = (nowMs: number, at: number[] = anchors, extra: TagBox[] = obstacles) =>
    stepTagGuard({ tags, anchors: at, obstacles: extra, gap: GAP, nowMs } satisfies GuardFrame, state);
  return { tags, state, step };
}

describe("stepTagGuard", () => {
  it("shows every tag when nothing touches", () => {
    const { state, step } = setup(["a", "b"], [0.2, 0.2, 0.8, 0.8]);
    expect(step(0)).toBe(false);
    expect(state.shown).toEqual([true, true]);
  });

  it("hides the lower priority tag of a pair that crosses, and keeps the higher one", () => {
    const { state, step } = setup(["high", "low"], [0.5, 0.5, 0.52, 0.5]);
    expect(step(0)).toBe(true);
    expect(state.shown).toEqual([true, false]);
  });

  it("decides in priority order: a tag that was hidden does not block the one below it", () => {
    // Each touches the next: the first wins, the second goes, and the third is clear of the only shown tag above it.
    const { state, step } = setup(["a", "b", "c"], [0.5, 0.5, 0.58, 0.5, 0.66, 0.5]);
    step(0);
    expect(state.shown).toEqual([true, false, true]);
  });

  it("holds a hidden tag back until it has been clear for the hold time", () => {
    const apart = [0.5, 0.5, 0.9, 0.5];
    const { state, step } = setup(["a", "b"], [0.5, 0.5, 0.52, 0.5]);
    step(0);
    expect(state.shown[1]).toBe(false);

    step(1000, apart);
    expect(state.shown[1]).toBe(false);
    step(1000 + GUARD_HOLD_MS - 1, apart);
    expect(state.shown[1]).toBe(false);
    expect(step(1000 + GUARD_HOLD_MS, apart)).toBe(true);
    expect(state.shown[1]).toBe(true);
  });

  it("restarts the hold when the pair touches again before it ran out", () => {
    const apart = [0.5, 0.5, 0.9, 0.5];
    const close = [0.5, 0.5, 0.52, 0.5];
    const { state, step } = setup(["a", "b"], close);
    step(0);
    step(100, apart);
    step(200, close);
    step(300, apart);
    // 250 ms after the first clear frame, but only 100 ms after the last one.
    step(400, apart);
    expect(state.shown[1]).toBe(false);
    step(300 + GUARD_HOLD_MS, apart);
    expect(state.shown[1]).toBe(true);
  });

  it("hides a tag that touches an obstacle and holds it back as well", () => {
    const label: TagBox = { x0: 0.45, y0: 0.55, x1: 0.55, y1: 0.6 };
    const { state, step } = setup(["a"], [0.5, 0.5], [label]);
    step(0);
    expect(state.shown).toEqual([false]);
    step(10, [0.5, 0.5], []);
    expect(state.shown).toEqual([false]);
    step(10 + GUARD_HOLD_MS, [0.5, 0.5], []);
    expect(state.shown).toEqual([true]);
  });

  it("keeps a clear space: a tag that is a hair away from an obstacle counts as touching", () => {
    // The tag spans y 0.53..0.57; the obstacle starts 0.0005 under it.
    const label: TagBox = { x0: 0.45, y0: 0.5705, x1: 0.55, y1: 0.6 };
    const { state, step } = setup(["a"], [0.5, 0.5], [label]);
    step(0);
    expect(state.shown).toEqual([false]);
  });

  it("never lets a tag the solver did not place appear: it has no entry to show", () => {
    const champions: TagChampion[] = [
      { id: "a", pos: { x: 0.5, y: 0.5 }, name: "ABC" },
      { id: "b", pos: { x: 0.5, y: 0.5 }, name: "DEF" },
    ];
    const placements = placeTags(champions);
    const withBadge = { ...placements, b: { form: "badge" as const } };
    expect(guardTagsFor(champions, withBadge).map((entry) => entry.id)).toEqual(["a"]);
    expect(guardTagsFor(champions, { ...placements, b: { form: "none" as const } }).map((entry) => entry.id)).toEqual(["a"]);
  });

  it("lists the placed tags in the order the solver chose: state first, then top to bottom", () => {
    const champions: TagChampion[] = [
      { id: "low", pos: { x: 0.5, y: 0.8 }, name: "LOW" },
      { id: "top", pos: { x: 0.5, y: 0.2 }, name: "TOP" },
      { id: "timer", pos: { x: 0.5, y: 0.9 }, name: "TIM", sub: "R 3.9" },
    ];
    expect(guardTagsFor(champions, placeTags(champions)).map((entry) => entry.id)).toEqual(["timer", "top", "low"]);
  });

  it("keeps the offset of the box from the marker it was solved for", () => {
    const champions: TagChampion[] = [{ id: "a", pos: { x: 0.4, y: 0.4 }, name: "ABC" }];
    const placements = placeTags(champions);
    const placement = placements.a;
    if (!("box" in placement)) throw new Error("expected a tag");
    const [entry] = guardTagsFor(champions, placements);
    expect(0.4 + entry.offset.x0).toBeCloseTo(placement.box.x0, 9);
    expect(0.4 + entry.offset.y1).toBeCloseTo(placement.box.y1, 9);
  });
});

describe("createGuardState", () => {
  it("keeps what a tag had across a new list and starts a new tag shown", () => {
    const first = createGuardState(["a", "b"]);
    first.shown[1] = false;
    first.clearSince[1] = 40;
    const next = createGuardState(["b", "c"], { ids: ["a", "b"], state: first });
    expect(next.shown).toEqual([false, true]);
    expect(next.clearSince).toEqual([40, -1]);
  });
});

/** A small deterministic generator, so a failing walk can be replayed. */
function seeded(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 2 ** 32;
  };
}

describe("a randomised cluster on the move", () => {
  const intersect = (a: TagBox, b: TagBox) => a.x0 < b.x1 + GAP && b.x0 < a.x1 + GAP && a.y0 < b.y1 + GAP && b.y0 < a.y1 + GAP;

  it.each([1, 7, 42, 2024])("never shows two tags that touch, nor a tag on an obstacle (seed %i)", (seed) => {
    const random = seeded(seed);
    const count = 10;
    const ids = Array.from({ length: count }, (_, index) => `c${index}`);
    const tags = ids.map(tag);
    const obstacles: TagBox[] = [
      { x0: 0.4, y0: 0.4, x1: 0.5, y1: 0.46 },
      { x0: 0.55, y0: 0.5, x1: 0.62, y1: 0.55 },
    ];
    const anchors = ids.flatMap(() => [0.45 + random() * 0.1, 0.45 + random() * 0.1]);
    const velocity = ids.flatMap(() => [(random() - 0.5) * 0.004, (random() - 0.5) * 0.004]);
    const state = createGuardState(ids);
    let hiddenFrames = 0;

    for (let frame = 0; frame < 600; frame += 1) {
      for (let k = 0; k < anchors.length; k += 1) {
        // Champions change their mind: the direction turns now and then.
        if (random() < 0.04) velocity[k] = (random() - 0.5) * 0.004;
        anchors[k] = Math.min(0.9, Math.max(0.1, anchors[k] + velocity[k]));
      }
      stepTagGuard({ tags, anchors, obstacles, gap: GAP, nowMs: frame * 16 }, state);

      const boxes = tags.map((entry, i) => ({
        x0: anchors[2 * i] + entry.offset.x0,
        y0: anchors[2 * i + 1] + entry.offset.y0,
        x1: anchors[2 * i] + entry.offset.x1,
        y1: anchors[2 * i + 1] + entry.offset.y1,
      }));
      const shown = boxes.filter((_, i) => state.shown[i]);
      hiddenFrames += count - shown.length;
      for (const box of shown) expect(obstacles.some((o) => intersect(box, o))).toBe(false);
      for (let a = 0; a < shown.length; a += 1) {
        for (let b = a + 1; b < shown.length; b += 1) expect(intersect(shown[a], shown[b])).toBe(false);
      }
    }
    // The walk really is crowded: a guard that hid nothing would pass the checks above for nothing.
    expect(hiddenFrames).toBeGreaterThan(100);
  });
});
