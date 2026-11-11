import type { LolSimV1RuntimeState } from "@/ui-v2/_legacy/components/match/lol-prototype/backend/contract-v1";
import type { Vec2 } from "@/ui-v2/_legacy/components/match/lol-prototype/engine/types";

/**
 * The engine advances in fixed steps, so a unit only changes position when a step
 * runs. The view draws a blend of the previous and the current step instead, over
 * the real time the steps between them last at the current playback speed.
 */

/** A unit may cover this many times its own move speed between two steps before the move counts as a jump. */
export const JUMP_SPEED_SLACK = 1.5;
/** Map distance under which a move is never a jump (collision pushes and rounding). */
export const JUMP_MIN_DISTANCE = 0.01;

interface Mover {
  id: string;
  pos: Vec2;
  alive: boolean;
  moveSpeed: number;
}

/** Fraction of the way from the previous step to the current one, from 0 to 1. */
export function stepAlpha(elapsedMs: number, durationMs: number): number {
  if (!(durationMs > 0)) return 1;
  return Math.min(1, Math.max(0, elapsedMs / durationMs));
}

/** Real milliseconds the game time between two states lasts at the playback speed. */
export function stepDurationMs(previousTimeSec: number, currentTimeSec: number, speed: number): number {
  if (!(speed > 0)) return 0;
  return Math.max(0, ((currentTimeSec - previousTimeSec) / speed) * 1000);
}

/**
 * Whether a unit reached its new position some other way than walking: it died,
 * respawned, recalled, flashed, was banished or moved farther than it can walk in
 * the game time between the two states. Those are drawn where they are, not slid.
 */
export function isJump(before: Mover, after: Mover, elapsedGameSec: number): boolean {
  if (before.alive !== after.alive) return true;
  const moved = Math.hypot(after.pos.x - before.pos.x, after.pos.y - before.pos.y);
  const speeds = [before.moveSpeed, after.moveSpeed].filter(Number.isFinite);
  const walkSpeed = speeds.length > 0 ? Math.max(...speeds) : 0;
  return moved > walkSpeed * Math.max(0, elapsedGameSec) * JUMP_SPEED_SLACK + JUMP_MIN_DISTANCE;
}

function blendUnits<T extends Mover>(previous: readonly T[], current: readonly T[], alpha: number, elapsedGameSec: number): T[] {
  const before = new Map(previous.map((unit) => [unit.id, unit]));
  return current.map((unit) => {
    const earlier = before.get(unit.id);
    if (!earlier || isJump(earlier, unit, elapsedGameSec)) return unit;
    return {
      ...unit,
      pos: {
        x: earlier.pos.x + (unit.pos.x - earlier.pos.x) * alpha,
        y: earlier.pos.y + (unit.pos.y - earlier.pos.y) * alpha,
      },
    };
  });
}

/**
 * The state to draw: positions of champions and minions blended between the
 * previous and the current step. Everything else, health bars included, is the
 * current step, so nothing but movement is delayed. A unit that is new, died,
 * respawned or jumped keeps its current position.
 */
export function interpolateRuntimeState(
  previous: LolSimV1RuntimeState,
  current: LolSimV1RuntimeState,
  alpha: number,
): LolSimV1RuntimeState {
  const elapsedGameSec = current.timeSec - previous.timeSec;
  if (alpha >= 1 || elapsedGameSec <= 0) return current;
  const clamped = Math.max(0, alpha);
  return {
    ...current,
    champions: blendUnits(previous.champions, current.champions, clamped, elapsedGameSec),
    minions: blendUnits(previous.minions, current.minions, clamped, elapsedGameSec),
  };
}

/**
 * Game time to show: the last step plus how far into the next one the engine and
 * the real time since the answer have taken the match, so the clock runs smoothly
 * between steps instead of jumping by a whole step.
 */
export function smoothClockSec(state: LolSimV1RuntimeState, receivedAtMs: number, nowMs: number): number {
  const stepSec = state.stepSec ?? 0;
  if (!state.running || state.winner || !(stepSec > 0) || !(state.speed > 0)) return state.timeSec;
  const intoStep = (state.stepAccumSec ?? 0) + (Math.max(0, nowMs - receivedAtMs) / 1000) * state.speed;
  return state.timeSec + Math.min(stepSec, Math.max(0, intoStep));
}

/** What the view remembers about the answers of the engine, to blend between them. */
export interface StepView {
  /** The state the movement is blended from; null until a second step arrives. */
  previous: LolSimV1RuntimeState | null;
  /** When the state last advanced, in milliseconds. */
  stepAtMs: number;
  /** When the last answer arrived, in milliseconds. */
  receivedAtMs: number;
}

export const EMPTY_STEP_VIEW: StepView = { previous: null, stepAtMs: 0, receivedAtMs: 0 };

/** The state to draw at `nowMs`: `current` with its movement blended from the previous step. */
export function stateToDraw(view: StepView, current: LolSimV1RuntimeState, nowMs: number): LolSimV1RuntimeState {
  if (!view.previous) return current;
  const alpha = stepAlpha(
    nowMs - view.stepAtMs,
    stepDurationMs(view.previous.timeSec, current.timeSec, current.speed),
  );
  return interpolateRuntimeState(view.previous, current, alpha);
}

/**
 * The view after the engine answered with `next` while `current` was the last
 * answer. A new step blends from what was on screen, not from the last answer, so
 * a step that arrives early does not make a unit jump. A first answer, or a match
 * that went back in time (a reset), has nothing to blend from.
 */
export function nextStepView(
  view: StepView,
  current: LolSimV1RuntimeState | null,
  next: LolSimV1RuntimeState,
  nowMs: number,
): StepView {
  if (!current || next.timeSec < current.timeSec) {
    return { previous: null, stepAtMs: nowMs, receivedAtMs: nowMs };
  }
  if (next.timeSec > current.timeSec) {
    return { previous: stateToDraw(view, current, nowMs), stepAtMs: nowMs, receivedAtMs: nowMs };
  }
  return { ...view, receivedAtMs: nowMs };
}
