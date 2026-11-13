import { render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Profiler } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { structureDiameterPx } from "@/lib/match/live/mapGeometry";
import type { LolSimV1RuntimeState } from "@/ui-v2/_legacy/components/match/lol-prototype/backend/contract-v1";

import { ArenaHarness } from "./arenaHarness.testing";
import {
  createTestBus,
  makeChampion,
  makeFrame,
  makeState,
  makeStructureSet,
  type TestBus,
} from "./arenaFixtures.testing";
import { ContactLayer } from "./ContactLayer";
import { TowerFireLayer } from "./TowerFireLayer";
import { RING_CLASSES } from "./ringClasses";
import { PUSH_KEYS, StructureLayer } from "./StructureLayer";
import { useContactView } from "./useContactView";

const SIZE = 540;
const css = readFileSync(resolve(__dirname, "liveMatch.css"), "utf8");

function Scene({ state, test, size = SIZE }: { state: LolSimV1RuntimeState; test: TestBus; size?: number }) {
  const { beams } = useContactView(state);
  return (
    <ArenaHarness bus={test.bus} sizePx={size}>
      <StructureLayer state={state} beams={beams} />
    </ArenaHarness>
  );
}

/** The engine sends fields the TypeScript state does not list. */
function withExtras(state: LolSimV1RuntimeState, extras: Record<string, unknown>): LolSimV1RuntimeState {
  return { ...state, ...extras } as LolSimV1RuntimeState;
}

const fullMap = (over?: Parameters<typeof makeStructureSet>[0], extras: Record<string, unknown> = {}) =>
  withExtras(makeState({ timeSec: 600, structures: makeStructureSet(over) }), extras);

const structure = (id: string) => screen.getByTestId(`structure-${id}`);

afterEach(() => vi.restoreAllMocks());

describe("structures", () => {
  it("renders the 30 structures of a full map", () => {
    render(<Scene state={fullMap()} test={createTestBus()} />);
    expect(document.querySelectorAll(".arena-struct")).toHaveLength(30);
    expect(document.querySelectorAll('.arena-struct[data-team="blue"]')).toHaveLength(15);
    expect(document.querySelectorAll('.arena-struct[data-team="red"]')).toHaveLength(15);
  });

  it("places each one with a transform and sizes it by its kind", () => {
    render(<Scene state={fullMap()} test={createTestBus()} />);
    const tower = structure("blue-mid-outer");
    expect(tower.style.transform).toMatch(/^translate\(\d+(\.\d+)?px, \d+(\.\d+)?px\)$/);
    expect(tower.style.left).toBe("");
    expect(tower.style.top).toBe("");
    const bodyWidth = (id: string) => Number.parseFloat((structure(id).firstElementChild as HTMLElement).style.width);
    expect(bodyWidth("blue-mid-outer")).toBeCloseTo(structureDiameterPx("tower", SIZE));
    expect(bodyWidth("blue-inhib-mid")).toBeCloseTo(structureDiameterPx("inhib", SIZE));
    expect(bodyWidth("red-nexus")).toBeCloseTo(structureDiameterPx("nexus", SIZE));
    expect(bodyWidth("blue-inhib-mid")).toBeGreaterThan(bodyWidth("blue-mid-outer"));
    expect(bodyWidth("red-nexus")).toBeGreaterThan(bodyWidth("blue-inhib-mid"));
  });

  it("tells the teams apart by shape: round for blue, a diamond for red", () => {
    render(<Scene state={fullMap()} test={createTestBus()} />);
    expect(structure("blue-mid-outer")).toHaveAttribute("data-team", "blue");
    expect(structure("red-mid-outer")).toHaveAttribute("data-team", "red");
    expect(css).toMatch(/\.arena-struct\[data-team="blue"\] \.arena-struct-body[^{]*\{[^}]*border-radius:\s*50%/);
    expect(css).toMatch(/\.arena-struct\[data-team="red"\] \.arena-struct-body[^{]*\{[^}]*clip-path:\s*polygon\(50% 0, 100% 50%, 50% 100%, 0 50%\)/);
  });

  it("labels the nexus of both teams and nothing else", () => {
    render(<Scene state={fullMap()} test={createTestBus()} />);
    expect(within(structure("blue-nexus")).getByText("Nexus")).toBeInTheDocument();
    expect(within(structure("red-nexus")).getByText("Nexus")).toBeInTheDocument();
    expect(document.querySelectorAll(".arena-struct-label")).toHaveLength(2);
  });

  it("shows a health bar only for a structure that is damaged and standing", () => {
    const state = fullMap((id) => (id === "red-mid-inner" ? { hp: 750 } : {}));
    render(<Scene state={state} test={createTestBus()} />);
    expect(screen.getAllByTestId("structure-hp")).toHaveLength(1);
    const bar = within(structure("red-mid-inner")).getByTestId("structure-hp");
    expect(bar.firstElementChild).toHaveStyle({ width: "25%" });
    expect(within(structure("blue-mid-inner")).queryByTestId("structure-hp")).toBeNull();
  });

  it("hatches a destroyed structure and gives it no health bar", () => {
    const state = fullMap((id) => (id === "blue-mid-outer" ? { alive: false, hp: 0 } : {}));
    render(<Scene state={state} test={createTestBus()} />);
    expect(structure("blue-mid-outer")).toHaveAttribute("data-dead", "true");
    expect(structure("blue-mid-inner")).not.toHaveAttribute("data-dead");
    expect(within(structure("blue-mid-outer")).queryByTestId("structure-hp")).toBeNull();
    expect(css).toMatch(/\.arena-struct\[data-dead\] \.arena-struct-body\s*\{[^}]*repeating-linear-gradient/);
  });

  it("is hidden from assistive technology: the Fight board is the text twin", () => {
    render(<Scene state={fullMap()} test={createTestBus()} />);
    expect(screen.getByTestId("structure-layer")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("camps and wards", () => {
  const timers = {
    neutralTimers: {
      dragonSoulUnlocked: false,
      elderUnlocked: false,
      entities: { "wolves-blue": { alive: true }, "gromp-red": { alive: false }, "scuttle-top": { alive: true } },
    },
  };

  it("draws a camp up or cleared from its timer", () => {
    render(<Scene state={withExtras(makeState(), timers)} test={createTestBus()} />);
    const camps = screen.getAllByTestId("camp");
    expect(camps).toHaveLength(3);
    const state = (id: string) => camps.find((camp) => camp.getAttribute("data-camp") === id)?.getAttribute("data-alive");
    expect(state("blue-wolves")).toBe("true");
    expect(state("red-gromp")).toBe("false");
    expect(css).toMatch(/\.arena-camp\[data-alive="false"\] \.arena-camp-dot\s*\{[^}]*dashed/);
  });

  it("draws the wards of both teams and drops the expired ones", () => {
    const wards = [
      { id: "w1", team: "blue", ownerChampionId: "c1", pos: { x: 0.3, y: 0.4 }, expiresAt: 700 },
      { id: "w2", team: "red", ownerChampionId: "c2", pos: { x: 0.6, y: 0.5 }, expiresAt: 700 },
      { id: "w3", team: "red", ownerChampionId: "c2", pos: { x: 0.7, y: 0.5 }, expiresAt: 590 },
    ];
    render(<Scene state={withExtras(makeState({ timeSec: 600 }), { wards })} test={createTestBus()} />);
    const drawn = screen.getAllByTestId("ward");
    expect(drawn.map((ward) => ward.getAttribute("data-team"))).toEqual(["blue", "red"]);
    expect(css).toMatch(/\.arena-ward\[data-team="blue"\] \.arena-ward-dot\s*\{[^}]*border-radius:\s*50%/);
  });
});

describe("tower fire", () => {
  function firing() {
    const champions = [makeChampion("dellan", "red", 0.3, 0.6, { name: "Dellan" })];
    return makeState({
      timeSec: 100,
      champions,
      structures: makeStructureSet((id) =>
        id === "blue-mid-outer"
          ? { pos: { x: 0.2, y: 0.6 }, rampTargetId: "dellan", rampShots: 1, rampLastShotAt: 98 }
          : {},
      ),
    });
  }

  function Both({ state, test }: { state: LolSimV1RuntimeState; test: TestBus }) {
    const { contacts, beams } = useContactView(state);
    return (
      <ArenaHarness bus={test.bus} sizePx={SIZE}>
        <StructureLayer state={state} beams={beams} />
        <ContactLayer state={state} contacts={contacts} />
        <TowerFireLayer state={state} beams={beams} />
      </ArenaHarness>
    );
  }

  it("flags the firing tower, and only that one", () => {
    render(<Scene state={firing()} test={createTestBus()} />);
    expect(structure("blue-mid-outer")).toHaveAttribute("data-firing", "true");
    expect(document.querySelectorAll(".arena-struct[data-firing]")).toHaveLength(1);
  });

  it("rings it once, with the dashed ring the tower fire layer owns", () => {
    render(<Both state={firing()} test={createTestBus()} />);
    expect(document.querySelectorAll(`.${RING_CLASSES.fire}`)).toHaveLength(1);
    expect(document.querySelectorAll(`.arena-struct .${RING_CLASSES.fire}`)).toHaveLength(0);
    expect(structure("blue-mid-outer")).toHaveAttribute("data-firing", "true");
  });

  it("stops flagging the tower once the beam is gone", () => {
    const stale = makeState({
      ...firing(),
      structures: makeStructureSet((id) =>
        id === "blue-mid-outer" ? { rampTargetId: "dellan", rampShots: 1, rampLastShotAt: 90 } : {},
      ),
    });
    render(<Scene state={stale} test={createTestBus()} />);
    expect(document.querySelector(".arena-struct[data-firing]")).toBeNull();
  });
});

describe("push badge", () => {
  const plan = (targetId: string, over: Record<string, unknown> = {}) => ({
    active: true,
    targetId,
    windowEndsAt: 631,
    ...over,
  });
  const idle = { active: false, targetId: null };
  const pushState = (teamPush: unknown[], over?: Parameters<typeof makeStructureSet>[0]) =>
    fullMap(over, { teamPush });

  /** The badge is placed by a translate to its centre, then moved back by half its own size. */
  function centreOf(badge: HTMLElement) {
    const match = /translate\(([\d.-]+)px, ([\d.-]+)px\) translate\(-50%, -50%\)/.exec(badge.style.transform);
    if (!match) throw new Error(`unexpected transform: ${badge.style.transform}`);
    return { x: Number(match[1]), y: Number(match[2]) };
  }

  function stubSize(w: number, h: number) {
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(w);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(h);
  }

  function expectInside(badge: HTMLElement, w: number, h: number, size = SIZE) {
    const { x, y } = centreOf(badge);
    expect(x - w / 2).toBeGreaterThanOrEqual(0);
    expect(y - h / 2).toBeGreaterThanOrEqual(0);
    expect(x + w / 2).toBeLessThanOrEqual(size);
    expect(y + h / 2).toBeLessThanOrEqual(size);
  }

  it("counts down the advantage in the badge", () => {
    render(<Scene state={pushState([plan("red-mid-outer"), idle])} test={createTestBus()} />);
    const badge = screen.getByTestId("push-badge");
    expect(badge).toHaveTextContent("Push 0:31");
    expect(badge).toHaveAttribute("data-team", "blue");
    expect(badge).toHaveAttribute("data-target", "red-mid-outer");
  });

  it("says Push alone when no end is in sight, and Final push for the nexus", () => {
    const { rerender } = render(
      <Scene state={pushState([plan("red-mid-outer", { windowEndsAt: 590 }), idle])} test={createTestBus()} />,
    );
    expect(screen.getByTestId("push-badge")).toHaveTextContent(/^Push$/);
    rerender(
      <Scene state={pushState([plan("red-nexus", { ending: true, windowEndsAt: 660 }), idle])} test={createTestBus()} />,
    );
    expect(screen.getByTestId("push-badge")).toHaveTextContent("Final push");
    expect(Object.keys(PUSH_KEYS)).toEqual(["countdown", "open", "ending"]);
  });

  it("shows one badge per team that pushes, and none otherwise", () => {
    const both = pushState([plan("red-mid-outer"), plan("blue-mid-inner")]);
    const { rerender } = render(<Scene state={both} test={createTestBus()} />);
    expect(screen.getAllByTestId("push-badge").map((badge) => badge.getAttribute("data-team"))).toEqual(["blue", "red"]);
    rerender(<Scene state={pushState([idle, idle])} test={createTestBus()} />);
    expect(screen.queryByTestId("push-badge")).toBeNull();
  });

  it("stays whole inside the map for a push on the left edge", () => {
    stubSize(120, 26);
    render(<Scene state={pushState([plan("blue-top-outer"), idle])} test={createTestBus()} />);
    expectInside(screen.getByTestId("push-badge"), 120, 26);
  });

  it("stays whole inside the map for a push on the bottom edge", () => {
    stubSize(120, 26);
    render(<Scene state={pushState([plan("blue-bot-outer"), idle])} test={createTestBus()} />);
    expectInside(screen.getByTestId("push-badge"), 120, 26);
  });

  it("stays whole inside the map for every structure, small map included", () => {
    stubSize(140, 26);
    for (const size of [320, 540]) {
      for (const point of makeStructureSet()) {
        const { unmount } = render(
          <Scene state={pushState([plan(point.id), idle])} test={createTestBus()} size={size} />,
        );
        expectInside(screen.getByTestId("push-badge"), 140, 26, size);
        unmount();
      }
    }
  });

  it("places the badge from its measured size, not a guess", () => {
    const left = (width: number) => {
      stubSize(width, 26);
      const { unmount } = render(<Scene state={pushState([plan("blue-top-outer"), idle])} test={createTestBus()} />);
      const { x } = centreOf(screen.getByTestId("push-badge"));
      unmount();
      return x;
    };
    expect(left(200)).toBeGreaterThanOrEqual(104);
    expect(left(200)).toBeGreaterThan(left(60));
  });

  it("does not render again for a frame: nothing here moves between answers", () => {
    const test = createTestBus();
    const state = pushState([plan("red-mid-outer"), idle]);
    const onRender = vi.fn();
    render(
      <Profiler id="structures" onRender={onRender}>
        <Scene state={state} test={test} />
      </Profiler>,
    );
    const afterMount = onRender.mock.calls.length;
    for (let i = 0; i < 30; i += 1) test.publish(makeFrame(state));
    expect(onRender.mock.calls.length).toBe(afterMount);
  });
});

describe("StructureLayer in the Spanish UI", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("es");
  });
  afterAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("names the nexus and the push in Spanish", () => {
    const state = fullMap(undefined, { teamPush: [{ active: true, targetId: "red-mid-outer", windowEndsAt: 631 }, null] });
    render(<Scene state={state} test={createTestBus()} />);
    expect(within(structure("red-nexus")).getByText("Nexo")).toBeInTheDocument();
    expect(screen.getByTestId("push-badge")).toHaveTextContent("Empuje 0:31");
  });
});
