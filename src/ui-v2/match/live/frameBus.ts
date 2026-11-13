/** The three browser facilities a frame loop needs, injectable so a test drives time by hand. */
export interface FrameScheduler {
  requestFrame(callback: () => void): number;
  cancelFrame(id: number): void;
  /** Milliseconds on the clock the frames and the engine answers are stamped with. */
  now(): number;
}

export const browserScheduler: FrameScheduler = {
  requestFrame: (callback) => requestAnimationFrame(() => callback()),
  cancelFrame: (id) => cancelAnimationFrame(id),
  now: () => performance.now(),
};

export type FrameSubscriber<F> = (frame: F) => void;

export interface FrameBus<F> {
  /** Calls `fn` on every frame. A subscriber that arrives late gets the last frame at once. Returns the unsubscribe. */
  subscribe(fn: FrameSubscriber<F>): () => void;
  /**
   * Starts the one animation-frame loop. On every frame `produce` runs with the clock;
   * a frame it returns goes to every subscriber, `null` publishes nothing. Starting again
   * replaces the producer and keeps the single loop.
   */
  start(produce: (nowMs: number) => F | null): void;
  /** Cancels the loop. Subscribers stay, so a later `start` reaches them. */
  stop(): void;
  isRunning(): boolean;
  subscriberCount(): number;
}

/**
 * The frame path of the live screen. Markers, links and the minion canvas subscribe here
 * and write `transform` through refs, so a frame never goes through React.
 */
export function createFrameBus<F>(scheduler: FrameScheduler = browserScheduler): FrameBus<F> {
  const subscribers = new Set<FrameSubscriber<F>>();
  let produce: ((nowMs: number) => F | null) | null = null;
  let frameId: number | null = null;
  let last: { frame: F } | null = null;

  const deliver = (fn: FrameSubscriber<F>, frame: F) => {
    try {
      fn(frame);
    } catch (error) {
      // One broken marker must not freeze the others or stop the loop.
      console.error("[frameBus] subscriber failed", error);
    }
  };

  const loop = () => {
    frameId = null;
    if (!produce) return;
    // Ask for the next frame first, so nothing a subscriber does can end the loop.
    frameId = scheduler.requestFrame(loop);
    const frame = produce(scheduler.now());
    if (frame === null) return;
    last = { frame };
    subscribers.forEach((fn) => deliver(fn, frame));
  };

  return {
    subscribe(fn) {
      subscribers.add(fn);
      if (last) deliver(fn, last.frame);
      return () => {
        subscribers.delete(fn);
      };
    },
    start(next) {
      produce = next;
      if (frameId === null) frameId = scheduler.requestFrame(loop);
    },
    stop() {
      produce = null;
      if (frameId !== null) scheduler.cancelFrame(frameId);
      frameId = null;
    },
    isRunning: () => frameId !== null,
    subscriberCount: () => subscribers.size,
  };
}
