import { render, screen } from "@testing-library/react";
import { Profiler } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import en from "@/i18n/locales/en.json";
import { linkEndpoints } from "@/lib/match/live/linkGeometry";
import { MAP_UNITS, bubbleDiameterPx } from "@/lib/match/live/mapGeometry";
import type { LolSimV1RuntimeState } from "@/ui-v2/_legacy/components/match/lol-prototype/backend/contract-v1";

import { ArenaHarness } from "./arenaHarness.testing";
import {
  createTestBus,
  makeChampion,
  makeFrame,
  makeState,
  makeStructure,
  type TestBus,
} from "./arenaFixtures.testing";
import { CONTACT_LEGEND_KEYS, ContactLayer } from "./ContactLayer";
import { RING_CLASSES } from "./ringClasses";
import { useContactView } from "./useContactView";

const SIZE = 540;

function Scene({ state, test, size = SIZE }: { state: LolSimV1RuntimeState; test: TestBus; size?: number }) {
  const { contacts, beams } = useContactView(state);
  return (
    <ArenaHarness bus={test.bus} sizePx={size}>
      <ContactLayer state={state} contacts={contacts} beams={beams} />
    </ArenaHarness>
  );
}

const hitBy = (attackerId: string, at: number) => ({ lastDamagedByChampionId: attackerId, lastDamagedByChampionAt: at });

function duel(over: { korvan?: object; dellan?: object; dx?: number } = {}, timeSec = 100) {
  const dx = over.dx ?? 0.12;
  return makeState({
    timeSec,
    champions: [
      makeChampion("c1", "blue", 0.3, 0.5, { name: "Korvan", ...over.korvan }),
      makeChampion("c2", "red", 0.3 + dx, 0.5, { name: "Dellan", ...over.dellan }),
    ],
  });
}

function towerShot(over: { lastShotAt?: number; shots?: number; targetAlive?: boolean } = {}) {
  return makeState({
    timeSec: 100,
    champions: [makeChampion("dellan", "red", 0.3, 0.6, { name: "Dellan", alive: over.targetAlive ?? true })],
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

describe("fight links", () => {
  it("run between the outer edges of the two bubbles, not between their centres", () => {
    const test = createTestBus();
    const state = duel({ dellan: hitBy("c1", 99.5) });
    render(<Scene state={state} test={test} />);
    test.publish(makeFrame(state));

    const link = part("link");
    const radius = bubbleDiameterPx(SIZE) / 2;
    const toPx = (units: number) => (units * SIZE) / MAP_UNITS;
    // The first end is next to Korvan (300 units), the second next to Dellan (420 units).
    expect(toPx(attr(link, "x1") - 300)).toBeGreaterThanOrEqual(radius);
    expect(toPx(420 - attr(link, "x2"))).toBeGreaterThanOrEqual(radius);
    expect(attr(link, "x1")).toBeLessThan(attr(link, "x2"));

    const expected = linkEndpoints(state.champions[0].pos, state.champions[1].pos, radius, SIZE);
    expect(link?.getAttribute("x1")).toBe(expected.x1.toFixed(1));
    expect(link?.getAttribute("x2")).toBe(expected.x2.toFixed(1));
  });

  it("put the dot on the attacker's end only", () => {
    const test = createTestBus();
    const state = duel({ dellan: hitBy("c1", 99.5) });
    render(<Scene state={state} test={test} />);
    test.publish(makeFrame(state));
    expect(part("dot-a")).not.toBeNull();
    expect(part("dot-b")).toBeNull();
    expect(attr(part("dot-a"), "cx")).toBe(attr(part("link"), "x1"));
  });

  it("put a dot on both ends when the fight is mutual", () => {
    const test = createTestBus();
    const state = duel({ korvan: hitBy("c2", 99), dellan: hitBy("c1", 99.5) });
    render(<Scene state={state} test={test} />);
    test.publish(makeFrame(state));
    expect(part("dot-a")).not.toBeNull();
    expect(part("dot-b")).not.toBeNull();
    expect(attr(part("dot-b"), "cx")).toBe(attr(part("link"), "x2"));
  });

  it("draw nothing for a champion hit by a tower, a minion or ignite", () => {
    const test = createTestBus();
    // `lastDamagedAt` is fresh but the last champion hit is nine seconds old.
    const state = duel({ dellan: { lastDamagedAt: 99.9, ...hitBy("c1", 91) } });
    render(<Scene state={state} test={test} />);
    test.publish(makeFrame(state));
    expect(part("link")).toBeNull();
    expect(screen.queryByTestId("contact-chip")).toBeNull();
  });

  it("follow the champions between answers, from the frame bus", () => {
    const test = createTestBus();
    const state = duel({ dellan: hitBy("c1", 99.5) });
    render(<Scene state={state} test={test} />);
    test.publish(makeFrame(state));
    const before = part("link")?.getAttribute("x2");

    const moved = duel({ dellan: hitBy("c1", 99.5), dx: 0.2 });
    test.publish(makeFrame(moved));
    expect(part("link")?.getAttribute("x2")).not.toBe(before);
    const expected = linkEndpoints(moved.champions[0].pos, moved.champions[1].pos, bubbleDiameterPx(SIZE) / 2, SIZE);
    expect(part("link")?.getAttribute("x2")).toBe(expected.x2.toFixed(1));
  });

  it("do not render React again for a frame", () => {
    const test = createTestBus();
    const state = duel({ dellan: hitBy("c1", 99.5) });
    const onRender = vi.fn();
    render(
      <Profiler id="contacts" onRender={onRender}>
        <Scene state={state} test={test} />
      </Profiler>,
    );
    const afterMount = onRender.mock.calls.length;
    for (let i = 0; i < 40; i += 1) test.publish(makeFrame(duel({ dellan: hitBy("c1", 99.5), dx: 0.12 + i * 0.001 })));
    expect(onRender.mock.calls.length).toBe(afterMount);
  });

  it("hide the line but keep the chip when the bubbles overlap", () => {
    const test = createTestBus();
    const state = duel({ dellan: hitBy("c1", 99.5), dx: 0.03 });
    render(<Scene state={state} test={test} />);
    test.publish(makeFrame(state));
    expect(part("link")?.closest("g")).toHaveAttribute("visibility", "hidden");
    expect(screen.getByTestId("contact-chip")).toBeInTheDocument();
  });

  it("fade with the age of the hit", () => {
    const opacityAt = (age: number) => {
      const test = createTestBus();
      const { unmount } = render(<Scene state={duel({ dellan: hitBy("c1", 100 - age) })} test={test} />);
      const value = part("link")?.closest("g")?.getAttribute("opacity");
      unmount();
      return value;
    };
    expect([opacityAt(0.5), opacityAt(2), opacityAt(3.5)]).toEqual(["1", "0.78", "0.55"]);
  });
});

describe("chip on a fight", () => {
  it("sits at the middle of the two champions and names them", () => {
    const test = createTestBus();
    const state = duel({ dellan: hitBy("c1", 99.5) });
    render(<Scene state={state} test={test} />);
    test.publish(makeFrame(state));
    const chip = screen.getByTestId("contact-chip");
    expect(chip).toHaveAttribute("title", "Korvan and Dellan are fighting");
    expect(chip.parentElement?.style.transform).toBe("translate(194.4px, 270px)");
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
    const state = towerShot();
    render(<Scene state={state} test={test} />);
    test.publish(makeFrame(state));
    const beam = document.querySelector(".arena-beam");
    const toPx = (units: number) => (units * SIZE) / MAP_UNITS;
    expect(toPx(attr(beam, "x1") - 200)).toBeGreaterThan(5);
    expect(toPx(300 - attr(beam, "x2"))).toBeGreaterThanOrEqual(bubbleDiameterPx(SIZE) / 2);
    expect(attr(part("beam-dot"), "cx")).toBe(attr(beam, "x1"));
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
});

describe("for assistive technology and the legend", () => {
  it("hides the lines and the chips", () => {
    const test = createTestBus();
    render(<Scene state={duel({ dellan: hitBy("c1", 99.5) })} test={test} />);
    expect(screen.getByTestId("contact-links")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("contact-chip").closest(".arena-chips")).toHaveAttribute("aria-hidden", "true");
  });

  it("has an entry in the legend for the dot, xN, the beam and both rings", () => {
    const keys = Object.values(CONTACT_LEGEND_KEYS);
    expect(keys).toHaveLength(5);
    for (const key of keys) {
      const value = key.split(".").reduce<unknown>((node, step) => (node as Record<string, unknown>)?.[step], en);
      expect(typeof value, key).toBe("string");
    }
    expect(CONTACT_LEGEND_KEYS.dot).toBe("onAir.match.legend.dot");
    expect(CONTACT_LEGEND_KEYS.shots).toBe("onAir.match.legend.shots");
  });
});

describe("ContactLayer in the Spanish UI", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("es");
  });
  afterAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("names the fight and the shots in Spanish", () => {
    const test = createTestBus();
    const { rerender } = render(<Scene state={duel({ dellan: hitBy("c1", 99.5) })} test={test} />);
    expect(screen.getByTestId("contact-chip")).toHaveAttribute("title", "Korvan y Dellan están peleando");
    rerender(<Scene state={towerShot({ shots: 0 })} test={test} />);
    expect(screen.getByTestId("shots-chip")).toHaveAttribute("title", "La torre dispara a Dellan: 1 disparo");
    rerender(<Scene state={towerShot({ shots: 2 })} test={test} />);
    expect(screen.getByTestId("shots-chip")).toHaveAttribute("title", "La torre dispara a Dellan: 3 disparos");
  });
});
