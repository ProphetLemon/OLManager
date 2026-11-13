import { render, screen } from "@testing-library/react";
import { Profiler } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { MIN_BEAM_PX } from "@/lib/match/live/linkGeometry";
import { MAP_UNITS, bubbleDiameterPx, structureDiameterPx } from "@/lib/match/live/mapGeometry";
import type { LolSimV1RuntimeState } from "@/ui-v2/_legacy/components/match/lol-prototype/backend/contract-v1";

import { ARENA_LAYERS } from "./ArenaMap";
import { createTestBus, makeChampion, makeFrame, makeState, makeStructure, type TestBus } from "./arenaFixtures.testing";
import { ArenaHarness } from "./arenaHarness.testing";
import { RING_CLASSES } from "./ringClasses";
import { TowerFireLayer } from "./TowerFireLayer";
import { useContactView } from "./useContactView";

const SIZE = 540;
const toPx = (units: number) => (units * SIZE) / MAP_UNITS;

function Scene({ state, test }: { state: LolSimV1RuntimeState; test: TestBus }) {
  const { beams } = useContactView(state);
  return (
    <ArenaHarness bus={test.bus} sizePx={SIZE}>
      <TowerFireLayer state={state} beams={beams} />
    </ArenaHarness>
  );
}

/** A blue tower at (0.2, 0.6) shooting Dellan, who stands `dx` of the map to its right. */
function towerShot(over: { lastShotAt?: number; shots?: number; targetAlive?: boolean; dx?: number } = {}) {
  return makeState({
    timeSec: 100,
    champions: [makeChampion("dellan", "red", 0.2 + (over.dx ?? 0.1), 0.6, { name: "Dellan", alive: over.targetAlive ?? true })],
    structures: [
      makeStructure("blue-mid-outer", "blue", "tower", 0.2, 0.6, {
        rampTargetId: "dellan",
        rampShots: over.shots ?? 2,
        rampLastShotAt: over.lastShotAt ?? 97.5,
      }),
    ],
  });
}

const attr = (element: Element | null, name: string) => Number(element?.getAttribute(name));
const part = (name: string) => document.querySelector(`[data-part="${name}"]`);

/** The centre of an anchor placed by `translate(Xpx, Ypx)`, in pixels. */
function anchorCentre(element: Element | null): { x: number; y: number } {
  const match = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec((element as HTMLElement).style.transform);
  if (!match) throw new Error("no translate");
  return { x: Number(match[1]), y: Number(match[2]) };
}

describe("where the layer sits", () => {
  it("is the last slot of the map, above the champions", () => {
    expect(ARENA_LAYERS[ARENA_LAYERS.length - 1]).toBe("callouts");
    expect(ARENA_LAYERS.indexOf("callouts")).toBeGreaterThan(ARENA_LAYERS.indexOf("champions"));
  });
});

describe("tower beams", () => {
  it("show while the last shot is under 3 seconds old and go after", () => {
    const test = createTestBus();
    const { rerender } = render(<Scene state={towerShot({ lastShotAt: 97.1 })} test={test} />);
    expect(document.querySelector(".arena-beam")).not.toBeNull();
    rerender(<Scene state={towerShot({ lastShotAt: 96.9 })} test={test} />);
    expect(document.querySelector(".arena-beam")).toBeNull();
    expect(screen.queryByTestId("shots-chip")).toBeNull();
  });

  it("count the shots as rampShots plus one", () => {
    const test = createTestBus();
    render(<Scene state={towerShot({ shots: 2 })} test={test} />);
    expect(screen.getByTestId("shots-chip")).toHaveTextContent("x3");
  });

  it("start outside the firing tower's ring and end outside the target's bubble", () => {
    const test = createTestBus();
    const state = towerShot({ dx: 0.1 });
    render(<Scene state={state} test={test} />);
    test.publish(makeFrame(state));
    const beam = document.querySelector(".arena-beam");
    expect(toPx(attr(beam, "x1") - 200)).toBeGreaterThan(5);
    expect(toPx(300 - attr(beam, "x2"))).toBeGreaterThanOrEqual(bubbleDiameterPx(SIZE) / 2);
    expect(attr(part("beam-dot"), "cx")).toBe(attr(beam, "x1"));
  });

  it("end in an arrowhead on the target's end", () => {
    const test = createTestBus();
    const state = towerShot();
    render(<Scene state={state} test={test} />);
    const head = part("beam-head")?.getAttribute("points") ?? "";
    const [, tip] = head.split(" ");
    const beam = document.querySelector(".arena-beam");
    expect(tip).toBe(`${attr(beam, "x2").toFixed(1)},${attr(beam, "y2").toFixed(1)}`);
    expect(head.split(" ")).toHaveLength(3);
  });

  it("draw nothing for a dead target", () => {
    const test = createTestBus();
    render(<Scene state={towerShot({ targetAlive: false })} test={test} />);
    expect(document.querySelector(".arena-beam")).toBeNull();
  });

  it("ring the firing tower with a dashed ring, apart from the fight and follow rings", () => {
    const test = createTestBus();
    render(<Scene state={towerShot()} test={test} />);
    expect(document.querySelectorAll(`.${RING_CLASSES.fire}`)).toHaveLength(1);
    expect(RING_CLASSES.fire).not.toBe(RING_CLASSES.fighting);
    expect(RING_CLASSES.fire).not.toBe(RING_CLASSES.selected);
  });

  it("say how many hits in the chip's title, with the right plural", () => {
    const test = createTestBus();
    const { rerender } = render(<Scene state={towerShot({ shots: 0 })} test={test} />);
    expect(screen.getByTestId("shots-chip")).toHaveAttribute("title", "Tower fire on Dellan: 1 hit");
    rerender(<Scene state={towerShot({ shots: 2 })} test={test} />);
    expect(screen.getByTestId("shots-chip")).toHaveAttribute("title", "Tower fire on Dellan: 3 hits");
  });

  it("do not render React again for a frame", () => {
    const test = createTestBus();
    const onRender = vi.fn();
    render(
      <Profiler id="fire" onRender={onRender}>
        <Scene state={towerShot()} test={test} />
      </Profiler>,
    );
    const afterMount = onRender.mock.calls.length;
    for (let i = 0; i < 30; i += 1) test.publish(makeFrame(towerShot({ dx: 0.1 + i * 0.001 })));
    expect(onRender.mock.calls.length).toBe(afterMount);
  });

  it("hide the lines and the chips from assistive technology", () => {
    const test = createTestBus();
    render(<Scene state={towerShot()} test={test} />);
    expect(screen.getByTestId("tower-fire")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("shots-chip").closest(".arena-chips")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("a target standing next to the tower", () => {
  // 0.03 of a 540 px map is 16 px: the bubble is already touching the tower's ring.
  const adjacent = () => towerShot({ dx: 0.03 });

  it("still gets a beam of the minimum length, instead of a 5 px stub or nothing", () => {
    const test = createTestBus();
    const state = adjacent();
    render(<Scene state={state} test={test} />);
    test.publish(makeFrame(state));
    const beam = document.querySelector(".arena-beam");
    const length = toPx(Math.hypot(attr(beam, "x2") - attr(beam, "x1"), attr(beam, "y2") - attr(beam, "y1")));
    expect(length).toBeGreaterThanOrEqual(MIN_BEAM_PX - 0.2);
    // It starts on the tower's ring and points at the target.
    const ring = structureDiameterPx("tower", SIZE) / 2;
    expect(toPx(attr(beam, "x1") - 200)).toBeGreaterThanOrEqual(ring);
    expect(attr(beam, "x2")).toBeGreaterThan(attr(beam, "x1"));
  });

  it("puts the xN chip outside the target's bubble, behind the tower", () => {
    const test = createTestBus();
    const state = adjacent();
    render(<Scene state={state} test={test} />);
    test.publish(makeFrame(state));
    const chip = anchorCentre(screen.getByTestId("shots-chip").parentElement);
    const target = { x: 0.23 * SIZE, y: 0.6 * SIZE };
    const half = bubbleDiameterPx(SIZE) / 2;
    const CHIP_HALF = 14;
    const overlapsBubble =
      chip.x + CHIP_HALF > target.x - half &&
      chip.x - CHIP_HALF < target.x + half &&
      chip.y + CHIP_HALF > target.y - half &&
      chip.y - CHIP_HALF < target.y + half;
    expect(overlapsBubble).toBe(false);
    // Behind the tower: on the other side from the target.
    expect(chip.x).toBeLessThan(0.2 * SIZE);
  });

  it("keeps the chip behind the tower when the target is on the other side", () => {
    const test = createTestBus();
    const state = towerShot({ dx: -0.1 });
    render(<Scene state={state} test={test} />);
    expect(anchorCentre(screen.getByTestId("shots-chip").parentElement).x).toBeGreaterThan(0.2 * SIZE);
  });
});

describe("TowerFireLayer in the Spanish UI", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("es");
  });
  afterAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("names the shots in Spanish", () => {
    const test = createTestBus();
    const { rerender } = render(<Scene state={towerShot({ shots: 0 })} test={test} />);
    expect(screen.getByTestId("shots-chip")).toHaveAttribute("title", "La torre dispara a Dellan: 1 disparo");
    rerender(<Scene state={towerShot({ shots: 2 })} test={test} />);
    expect(screen.getByTestId("shots-chip")).toHaveAttribute("title", "La torre dispara a Dellan: 3 disparos");
  });
});
