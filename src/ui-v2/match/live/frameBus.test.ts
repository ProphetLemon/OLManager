import { describe, expect, it, vi } from "vitest";

import { createFrameBus } from "./frameBus";
import { createFakeScheduler } from "./frameScheduler.testing";

describe("createFrameBus", () => {
  it("calls every subscriber on every frame, from one scheduled callback", () => {
    const scheduler = createFakeScheduler();
    const bus = createFrameBus<number>(scheduler);
    const a = vi.fn();
    const b = vi.fn();
    bus.subscribe(a);
    bus.subscribe(b);
    let n = 0;
    bus.start(() => ++n);

    expect(scheduler.pending()).toBe(1);
    for (let i = 0; i < 30; i += 1) scheduler.frame();

    expect(a).toHaveBeenCalledTimes(30);
    expect(b).toHaveBeenCalledTimes(30);
    expect(a).toHaveBeenLastCalledWith(30);
    expect(scheduler.pending()).toBe(1);
  });

  it("stops asking for frames after stop, and drops the callback already waiting", () => {
    const scheduler = createFakeScheduler();
    const bus = createFrameBus<number>(scheduler);
    const produce = vi.fn(() => 1);
    bus.start(produce);
    scheduler.frame();
    bus.stop();

    expect(scheduler.pending()).toBe(0);
    scheduler.frame();
    expect(produce).toHaveBeenCalledTimes(1);
    expect(bus.isRunning()).toBe(false);
  });

  it("does not publish when the producer has nothing yet, but keeps going", () => {
    const scheduler = createFakeScheduler();
    const bus = createFrameBus<number>(scheduler);
    const sub = vi.fn();
    bus.subscribe(sub);
    let ready = false;
    bus.start(() => (ready ? 7 : null));

    scheduler.frame();
    expect(sub).not.toHaveBeenCalled();
    ready = true;
    scheduler.frame();
    expect(sub).toHaveBeenCalledWith(7);
  });

  it("gives a late subscriber the last frame at once, and none after it unsubscribes", () => {
    const scheduler = createFakeScheduler();
    const bus = createFrameBus<number>(scheduler);
    bus.start(() => 5);
    scheduler.frame();

    const late = vi.fn();
    const unsubscribe = bus.subscribe(late);
    expect(late).toHaveBeenCalledWith(5);

    unsubscribe();
    scheduler.frame();
    expect(late).toHaveBeenCalledTimes(1);
    expect(bus.subscriberCount()).toBe(0);
  });

  it("keeps the loop and the other subscribers alive when one subscriber throws", () => {
    const scheduler = createFakeScheduler();
    const bus = createFrameBus<number>(scheduler);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const healthy = vi.fn();
    bus.subscribe(() => {
      throw new Error("marker gone");
    });
    bus.subscribe(healthy);
    bus.start(() => 1);

    scheduler.frame();
    scheduler.frame();

    expect(healthy).toHaveBeenCalledTimes(2);
    expect(scheduler.pending()).toBe(1);
    errors.mockRestore();
  });

  it("starting again replaces the producer without a second loop", () => {
    const scheduler = createFakeScheduler();
    const bus = createFrameBus<string>(scheduler);
    const sub = vi.fn();
    bus.subscribe(sub);
    bus.start(() => "old");
    bus.start(() => "new");

    expect(scheduler.pending()).toBe(1);
    scheduler.frame();
    expect(sub).toHaveBeenCalledTimes(1);
    expect(sub).toHaveBeenCalledWith("new");
  });
});
