import type { FrameScheduler } from "./frameBus";

/** A scheduler the test drives by hand: time moves only when `frame` is called. */
export interface FakeScheduler extends FrameScheduler {
  /** Advances the clock by `ms` and runs the frame callbacks that were waiting. */
  frame(ms?: number): void;
  pending(): number;
  advance(ms: number): void;
}

export function createFakeScheduler(): FakeScheduler {
  let time = 1000;
  let nextId = 1;
  const queue = new Map<number, () => void>();
  return {
    requestFrame(callback) {
      const id = nextId++;
      queue.set(id, callback);
      return id;
    },
    cancelFrame(id) {
      queue.delete(id);
    },
    now: () => time,
    advance(ms) {
      time += ms;
    },
    pending: () => queue.size,
    frame(ms = 1000 / 60) {
      time += ms;
      const callbacks = [...queue.values()];
      queue.clear();
      callbacks.forEach((callback) => callback());
    },
  };
}
