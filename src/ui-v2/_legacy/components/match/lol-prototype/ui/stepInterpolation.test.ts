import { describe, expect, it } from "vitest";

import type { LolSimV1RuntimeState } from "@/ui-v2/_legacy/components/match/lol-prototype/backend/contract-v1";
import {
  EMPTY_STEP_VIEW,
  interpolateRuntimeState,
  isJump,
  nextStepView,
  smoothClockSec,
  stateToDraw,
  stepAlpha,
  stepDurationMs,
} from "@/ui-v2/_legacy/components/match/lol-prototype/ui/stepInterpolation";

const STEP = 0.6;
const WALK = 0.05;

const unit = (id: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({
  id,
  pos: { x, y },
  alive: true,
  hp: 100,
  maxHp: 100,
  moveSpeed: WALK,
  ...extra,
});

const stateAt = (
  timeSec: number,
  champions: ReturnType<typeof unit>[],
  minions: ReturnType<typeof unit>[] = [],
  extra: Record<string, unknown> = {},
) =>
  ({
    timeSec,
    running: true,
    winner: null,
    speed: 4,
    stepSec: STEP,
    stepAccumSec: 0,
    champions,
    minions,
    structures: [],
    ...extra,
  }) as unknown as LolSimV1RuntimeState;

describe("stepAlpha", () => {
  it("runs from 0 to 1 over the duration and stays inside", () => {
    expect(stepAlpha(0, 150)).toBe(0);
    expect(stepAlpha(75, 150)).toBe(0.5);
    expect(stepAlpha(150, 150)).toBe(1);
    expect(stepAlpha(900, 150)).toBe(1);
    expect(stepAlpha(-5, 150)).toBe(0);
  });

  it("is 1 when there is no duration to wait for", () => {
    expect(stepAlpha(10, 0)).toBe(1);
    expect(stepAlpha(10, Number.NaN)).toBe(1);
  });
});

describe("stepDurationMs", () => {
  it("is the real time a step lasts at the playback speed", () => {
    expect(stepDurationMs(10, 10.6, 4)).toBeCloseTo(150, 6);
    expect(stepDurationMs(10, 10.6, 48)).toBeCloseTo(12.5, 6);
    expect(stepDurationMs(10, 11.2, 4)).toBeCloseTo(300, 6);
  });

  it("is 0 when the speed is 0", () => {
    expect(stepDurationMs(10, 10.6, 0)).toBe(0);
  });
});

describe("isJump", () => {
  const walker = unit("c1", 0.5, 0.5);

  it("is false for a unit that walked a step", () => {
    expect(isJump(walker, unit("c1", 0.5 + WALK * STEP, 0.5), STEP)).toBe(false);
  });

  it("is false for a unit that did not move", () => {
    expect(isJump(walker, unit("c1", 0.5, 0.5), STEP)).toBe(false);
  });

  it("is true for a flash, which covers more than a step of walking", () => {
    expect(isJump(walker, unit("c1", 0.5 + 0.085, 0.5), STEP)).toBe(true);
  });

  it("is true for a recall that lands in the base", () => {
    expect(isJump(walker, unit("c1", 0.1, 0.9), STEP)).toBe(true);
  });

  it("is true for a unit that died or respawned", () => {
    expect(isJump(walker, unit("c1", 0.5, 0.5, { alive: false }), STEP)).toBe(true);
    expect(isJump(unit("c1", 0.5, 0.5, { alive: false }), walker, STEP)).toBe(true);
  });

  it("allows a longer walk when more game time passed between the states", () => {
    const farther = unit("c1", 0.5 + WALK * STEP * 5, 0.5);
    expect(isJump(walker, farther, STEP)).toBe(true);
    expect(isJump(walker, farther, STEP * 5)).toBe(false);
  });

  it("treats a missing move speed as not being able to walk", () => {
    expect(isJump(unit("c1", 0.5, 0.5, { moveSpeed: undefined }), unit("c1", 0.6, 0.5, { moveSpeed: undefined }), STEP)).toBe(true);
  });
});

describe("interpolateRuntimeState", () => {
  const previous = stateAt(60, [unit("c1", 0.5, 0.5)], [unit("m-1", 0.2, 0.2, { moveSpeed: 0.03 })]);
  const current = stateAt(60.6, [unit("c1", 0.53, 0.5)], [unit("m-1", 0.218, 0.2, { moveSpeed: 0.03 })]);

  it("draws the previous step at alpha 0 and the current step at alpha 1", () => {
    const start = interpolateRuntimeState(previous, current, 0);
    expect(start.champions[0].pos.x).toBeCloseTo(0.5, 9);
    expect(start.minions[0].pos.x).toBeCloseTo(0.2, 9);
    expect(interpolateRuntimeState(previous, current, 1)).toBe(current);
  });

  it("moves champions and minions part of the way at alpha 0.5", () => {
    const half = interpolateRuntimeState(previous, current, 0.5);
    expect(half.champions[0].pos.x).toBeCloseTo(0.515, 9);
    expect(half.champions[0].pos.y).toBeCloseTo(0.5, 9);
    expect(half.minions[0].pos.x).toBeCloseTo(0.209, 9);
  });

  it("keeps the health and everything else of the current step", () => {
    const hurt = stateAt(60.6, [unit("c1", 0.53, 0.5, { hp: 40 })], [], { stats: { blue: { kills: 3 } } });
    const half = interpolateRuntimeState(previous, hurt, 0.5);
    expect(half.champions[0].hp).toBe(40);
    expect(half.timeSec).toBe(60.6);
    expect((half as unknown as { stats: unknown }).stats).toEqual({ blue: { kills: 3 } });
  });

  it("does not change the states it was given", () => {
    interpolateRuntimeState(previous, current, 0.5);
    expect(current.champions[0].pos.x).toBe(0.53);
    expect(previous.champions[0].pos.x).toBe(0.5);
  });

  it("draws a unit that is new where it is", () => {
    const spawned = stateAt(60.6, [unit("c1", 0.53, 0.5)], [unit("m-1", 0.218, 0.2), unit("m-2", 0.9, 0.9)]);
    const half = interpolateRuntimeState(previous, spawned, 0.5);
    expect(half.minions.map((minion) => minion.id)).toEqual(["m-1", "m-2"]);
    expect(half.minions[1].pos).toEqual({ x: 0.9, y: 0.9 });
  });

  it("drops a unit that is gone", () => {
    const half = interpolateRuntimeState(previous, stateAt(60.6, [unit("c1", 0.53, 0.5)]), 0.5);
    expect(half.minions).toEqual([]);
  });

  it("does not slide a unit that teleported, died or respawned", () => {
    const recalled = stateAt(60.6, [unit("c1", 0.1, 0.9)]);
    expect(interpolateRuntimeState(previous, recalled, 0.5).champions[0].pos).toEqual({ x: 0.1, y: 0.9 });

    const dead = stateAt(60.6, [unit("c1", 0.5, 0.5, { alive: false })]);
    expect(interpolateRuntimeState(previous, dead, 0.5).champions[0].pos).toEqual({ x: 0.5, y: 0.5 });

    const respawned = stateAt(120.6, [unit("c1", 0.05, 0.95)]);
    const wasDead = stateAt(120, [unit("c1", 0.5, 0.5, { alive: false })]);
    expect(interpolateRuntimeState(wasDead, respawned, 0.5).champions[0].pos).toEqual({ x: 0.05, y: 0.95 });
  });

  it("blends only the units that walked when others jumped", () => {
    const two = stateAt(60, [unit("c1", 0.5, 0.5), unit("c2", 0.3, 0.3)]);
    const next = stateAt(60.6, [unit("c1", 0.53, 0.5), unit("c2", 0.9, 0.1)]);
    const half = interpolateRuntimeState(two, next, 0.5);
    expect(half.champions[0].pos.x).toBeCloseTo(0.515, 9);
    expect(half.champions[1].pos).toEqual({ x: 0.9, y: 0.1 });
  });

  it("returns the current state when game time did not advance", () => {
    expect(interpolateRuntimeState(current, current, 0.5)).toBe(current);
  });

  it("covers several steps run in one tick over the longer span", () => {
    const later = stateAt(61.8, [unit("c1", 0.59, 0.5)]);
    const half = interpolateRuntimeState(previous, later, 0.5);
    expect(half.champions[0].pos.x).toBeCloseTo(0.545, 9);
  });
});

describe("smoothClockSec", () => {
  it("adds the time collected towards the next step and the real time since the answer", () => {
    const state = stateAt(60, [], [], { stepAccumSec: 0.2, speed: 4 });
    expect(smoothClockSec(state, 1000, 1000)).toBeCloseTo(60.2, 9);
    expect(smoothClockSec(state, 1000, 1050)).toBeCloseTo(60.4, 9);
  });

  it("never runs past the next step", () => {
    const state = stateAt(60, [], [], { stepAccumSec: 0.5, speed: 48 });
    expect(smoothClockSec(state, 1000, 6000)).toBeCloseTo(60.6, 9);
  });

  it("does not run backwards when the clocks disagree", () => {
    const state = stateAt(60, [], [], { stepAccumSec: 0.1 });
    expect(smoothClockSec(state, 2000, 1000)).toBeCloseTo(60.1, 9);
  });

  it("stands still when the match is paused or over", () => {
    expect(smoothClockSec(stateAt(60, [], [], { running: false, stepAccumSec: 0.3 }), 0, 5000)).toBe(60);
    expect(smoothClockSec(stateAt(60, [], [], { winner: "blue" }), 0, 5000)).toBe(60);
  });

  it("falls back to the step time when the engine sends no step size", () => {
    expect(smoothClockSec(stateAt(60, [], [], { stepSec: undefined }), 0, 5000)).toBe(60);
  });
});

describe("the step view", () => {
  const first = stateAt(60, [unit("c1", 0.5, 0.5)]);
  const second = stateAt(60.6, [unit("c1", 0.53, 0.5)]);
  const third = stateAt(61.2, [unit("c1", 0.56, 0.5)]);

  it("has nothing to blend from after the first answer", () => {
    const view = nextStepView(EMPTY_STEP_VIEW, null, first, 1000);
    expect(view.previous).toBeNull();
    expect(stateToDraw(view, first, 1000)).toBe(first);
  });

  it("blends a new step over the real time it lasts at the playback speed", () => {
    const view = nextStepView(nextStepView(EMPTY_STEP_VIEW, null, first, 1000), first, second, 1150);
    // The speed is 4, so 0.6 s of game time lasts 150 ms.
    expect(stateToDraw(view, second, 1150).champions[0].pos.x).toBeCloseTo(0.5, 9);
    expect(stateToDraw(view, second, 1225).champions[0].pos.x).toBeCloseTo(0.515, 9);
    expect(stateToDraw(view, second, 1310)).toBe(second);
    expect(stateToDraw(view, second, 5000)).toBe(second);
  });

  it("keeps the blend when an answer brings no new step", () => {
    const stepped = nextStepView(nextStepView(EMPTY_STEP_VIEW, null, first, 1000), first, second, 1150);
    const same = nextStepView(stepped, second, { ...second }, 1200);
    expect(same.previous).toBe(stepped.previous);
    expect(same.stepAtMs).toBe(1150);
    expect(same.receivedAtMs).toBe(1200);
  });

  it("starts the next blend from what was on screen when a step comes early", () => {
    const stepped = nextStepView(nextStepView(EMPTY_STEP_VIEW, null, first, 1000), first, second, 1150);
    const early = nextStepView(stepped, second, third, 1225);
    expect(early.previous?.champions[0].pos.x).toBeCloseTo(0.515, 9);
    expect(stateToDraw(early, third, 1225).champions[0].pos.x).toBeCloseTo(0.515, 9);
  });

  it("forgets the past when the match goes back in time", () => {
    const stepped = nextStepView(nextStepView(EMPTY_STEP_VIEW, null, first, 1000), first, second, 1150);
    const restarted = nextStepView(stepped, second, stateAt(0, [unit("c1", 0.1, 0.1)]), 1300);
    expect(restarted.previous).toBeNull();
  });
});
