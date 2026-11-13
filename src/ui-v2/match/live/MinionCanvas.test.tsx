import { render, screen, waitFor } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MinionState } from "@/ui-v2/_legacy/components/match/lol-prototype/engine/types";

import { ArenaHarness } from "./arenaHarness.testing";
import { createTestBus, makeFrame, makeState, type TestBus } from "./arenaFixtures.testing";
import { createRecordingContext, type RecordingContext } from "./canvasContext.testing";
import { MinionCanvas } from "./MinionCanvas";

const SIZE = 540;

function minion(id: string, team: "blue" | "red", x: number, y: number, over: Partial<MinionState> = {}): MinionState {
  return {
    id,
    team,
    lane: "mid",
    pos: { x, y },
    hp: 400,
    maxHp: 400,
    alive: true,
    kind: "melee",
    lastHitByChampionId: null,
    attackCdUntil: 0,
    moveSpeed: 325,
    attackRange: 110,
    attackDamage: 12,
    path: [],
    pathIndex: 0,
    ...over,
  };
}

const wave = [
  minion("b1", "blue", 0.3, 0.7),
  minion("b2", "blue", 0.32, 0.68),
  minion("r1", "red", 0.6, 0.4),
  minion("s1", "blue", 0.5, 0.5, { kind: "summon" }),
];

let recorder: RecordingContext;
const tokens: Record<string, string> = { "--team-blue": "blue-from-theme", "--team-red": "red-from-theme" };

beforeEach(() => {
  recorder = createRecordingContext();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(recorder.context as never);
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    () => ({ getPropertyValue: (name: string) => tokens[name] ?? "" }) as unknown as CSSStyleDeclaration,
  );
  Object.defineProperty(window, "devicePixelRatio", { value: 1, configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  tokens["--team-blue"] = "blue-from-theme";
  tokens["--team-red"] = "red-from-theme";
});

function Scene({ test, size = SIZE }: { test: TestBus; size?: number }) {
  return (
    <ArenaHarness bus={test.bus} sizePx={size}>
      <MinionCanvas />
    </ArenaHarness>
  );
}

const lastOf = <T,>(items: T[]): T | undefined => items[items.length - 1];
const canvas = () => screen.getByTestId("minion-canvas") as HTMLCanvasElement;
const frameWith = (minions: MinionState[]) => makeFrame(makeState({ minions }));

describe("MinionCanvas", () => {
  it("is hidden from assistive technology", () => {
    render(<Scene test={createTestBus()} />);
    expect(canvas()).toHaveAttribute("aria-hidden", "true");
  });

  it("draws the minions of the frame it is handed, summons left out", () => {
    const test = createTestBus();
    render(<Scene test={test} />);
    recorder.clear();
    test.publish(frameWith(wave));
    expect(recorder.named("arc")).toHaveLength(2);
    expect(recorder.named("fillRect")).toHaveLength(1);
  });

  it("sizes its backing store to the map times the pixel ratio", () => {
    Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });
    const test = createTestBus();
    const { rerender } = render(<Scene test={test} size={540} />);
    expect(canvas().width).toBe(1080);
    expect(canvas().height).toBe(1080);
    rerender(<Scene test={test} size={320} />);
    expect(canvas().width).toBe(640);
  });

  it("paints in css pixels by scaling the context to the pixel ratio", () => {
    Object.defineProperty(window, "devicePixelRatio", { value: 1.5, configurable: true });
    const test = createTestBus();
    render(<Scene test={test} />);
    test.publish(frameWith(wave));
    const scale = lastOf(recorder.named("setTransform"));
    expect(scale).toEqual(["setTransform", 1.5, 0, 0, 1.5, 0, 0]);
  });

  it("draws again at once after a resize, from the last frame", () => {
    const test = createTestBus();
    const { rerender } = render(<Scene test={test} size={540} />);
    test.publish(frameWith(wave));
    recorder.clear();
    rerender(<Scene test={test} size={400} />);
    expect(recorder.named("arc")).toHaveLength(2);
    const [, , x] = recorder.named("arc")[0] as unknown[];
    expect(x).toBeCloseTo(0.3 * 400);
  });

  it("does not render React again for a frame", () => {
    const test = createTestBus();
    const onRender = vi.fn();
    render(
      <Profiler id="minions" onRender={onRender}>
        <Scene test={test} />
      </Profiler>,
    );
    const afterMount = onRender.mock.calls.length;
    for (let i = 0; i < 40; i += 1) test.publish(frameWith(wave));
    expect(onRender.mock.calls.length).toBe(afterMount);
    expect(recorder.named("clearRect").length).toBeGreaterThanOrEqual(40);
  });

  it("paints with the team colours read from the theme tokens", () => {
    const test = createTestBus();
    render(<Scene test={test} />);
    test.publish(frameWith(wave));
    expect(lastOf(recorder.named("arc"))?.[1]).toBe("blue-from-theme");
    expect(lastOf(recorder.named("fillRect"))?.[1]).toBe("red-from-theme");
  });

  it("reads the colours again when the theme changes, and redraws with them", async () => {
    const test = createTestBus();
    render(<Scene test={test} />);
    test.publish(frameWith(wave));

    tokens["--team-blue"] = "blue-high-contrast";
    tokens["--team-red"] = "red-high-contrast";
    recorder.clear();
    document.documentElement.setAttribute("data-contrast", "high");

    await waitFor(() => expect(recorder.named("arc").length).toBeGreaterThan(0));
    expect(lastOf(recorder.named("arc"))?.[1]).toBe("blue-high-contrast");
    expect(lastOf(recorder.named("fillRect"))?.[1]).toBe("red-high-contrast");
    document.documentElement.removeAttribute("data-contrast");
  });

  it("stops watching the theme and the frames when it unmounts", () => {
    const test = createTestBus();
    const { unmount } = render(<Scene test={test} />);
    const before = test.bus.subscriberCount();
    unmount();
    expect(test.bus.subscriberCount()).toBe(before - 1);
  });
});
