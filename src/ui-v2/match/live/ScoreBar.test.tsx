import { render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Profiler } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import type { LolSimV1RuntimeState } from "@/ui-v2/_legacy/components/match/lol-prototype/backend/contract-v1";

import { createTestBus, makeFrame, makeState } from "./arenaFixtures.testing";
import { CLOCK_INTERVAL_MS, ScoreBar, type ScoreStatus } from "./ScoreBar";

const css = readFileSync(resolve(__dirname, "liveMatch.css"), "utf8");

const BLUE = { tag: "EMB", name: "Emberfall" };
const RED = { tag: "TDL", name: "Tidal Lanterns" };

type Buffs = Record<string, unknown>;

/** A runtime state with the stats and team buffs the bar reads; the engine sends more than the types list. */
function stateWith(
  over: {
    timeSec?: number;
    blue?: Partial<{ kills: number; towers: number; dragons: number; barons: number; gold: number }>;
    red?: Partial<{ kills: number; towers: number; dragons: number; barons: number; gold: number }>;
    buffs?: { blue?: Buffs; red?: Buffs };
  } = {},
): LolSimV1RuntimeState {
  const base = makeState({ timeSec: over.timeSec ?? 100 });
  return {
    ...base,
    stats: {
      blue: { kills: 0, towers: 0, dragons: 0, barons: 0, gold: 0, ...over.blue },
      red: { kills: 0, towers: 0, dragons: 0, barons: 0, gold: 0, ...over.red },
    },
    teamBuffs: { blue: over.buffs?.blue ?? {}, red: over.buffs?.red ?? {} },
  } as unknown as LolSimV1RuntimeState;
}

function renderBar(state: LolSimV1RuntimeState, status: ScoreStatus = "live", testBus = createTestBus()) {
  const view = render(<ScoreBar state={state} blue={BLUE} red={RED} status={status} bus={testBus.bus} />);
  return {
    ...view,
    testBus,
    rerenderBar: (next: LolSimV1RuntimeState, nextStatus: ScoreStatus = status) =>
      view.rerender(<ScoreBar state={next} blue={BLUE} red={RED} status={nextStatus} bus={testBus.bus} />),
  };
}

const blueSide = () => screen.getByRole("group", { name: "Emberfall" });
const redSide = () => screen.getByRole("group", { name: "Tidal Lanterns" });
const clock = () => screen.getByRole("timer");

describe("the teams on the bar", () => {
  it("shows the tag and name of each team, blue first", () => {
    renderBar(stateWith());
    expect(within(blueSide()).getByText("EMB")).toBeInTheDocument();
    expect(within(blueSide()).getByText("Emberfall")).toBeInTheDocument();
    expect(within(redSide()).getByText("TDL")).toBeInTheDocument();
    expect(blueSide().compareDocumentPosition(redSide()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("reads the kills as a sentence with the team named", () => {
    renderBar(stateWith({ blue: { kills: 11 }, red: { kills: 4 } }));
    expect(screen.getByText("Blue kills 11")).toBeInTheDocument();
    expect(screen.getByText("Red kills 4")).toBeInTheDocument();
  });

  it("gives every icon a name: towers, gold, voidgrubs and barons", () => {
    renderBar(stateWith({ blue: { towers: 3, gold: 12350, barons: 1 }, red: { towers: 5, gold: 640 } }));
    const blue = blueSide();
    expect(blue).toHaveTextContent("Tower 3");
    expect(blue).toHaveTextContent("Gold 12.4k");
    expect(blue).toHaveTextContent("Voidgrub 0");
    expect(blue).toHaveTextContent("Baron 1");
    expect(redSide()).toHaveTextContent("Tower 5");
    expect(redSide()).toHaveTextContent("Gold 640");
  });

  it("counts the voidgrubs from the team buffs", () => {
    renderBar(stateWith({ buffs: { red: { voidgrub_stacks: 2 } } }));
    expect(redSide()).toHaveTextContent("Voidgrub 2");
  });
});

describe("the dragon pips", () => {
  it("always draws four: the kinds taken, an unknown one, and dashed empty ones", () => {
    renderBar(
      stateWith({ blue: { dragons: 3 }, buffs: { blue: { dragon_history: ["infernal", "ocean"] } } }),
    );
    const group = within(blueSide()).getByRole("group", { name: "Dragon" });
    expect([...group.querySelectorAll(".arena-pip")].map((pip) => pip.getAttribute("data-kind"))).toEqual([
      "infernal",
      "ocean",
      "unknown",
      "empty",
    ]);
    expect(within(blueSide()).getByAltText("Infernal Dragon")).toBeInTheDocument();
    expect(within(blueSide()).getByAltText("Ocean Dragon")).toBeInTheDocument();
  });

  it("draws four empty pips for a team with no dragon", () => {
    renderBar(stateWith());
    expect([...redSide().querySelectorAll(".arena-pip")].map((pip) => pip.getAttribute("data-kind"))).toEqual([
      "empty",
      "empty",
      "empty",
      "empty",
    ]);
  });
});

describe("the match status", () => {
  it("says Live, Paused or Ended, and each is a different chip, not a different colour", () => {
    const texts: Record<string, string> = {};
    for (const status of ["live", "paused", "final"] as const) {
      const { unmount } = renderBar(stateWith(), status);
      const chip = screen.getByTestId("match-status");
      texts[status] = chip.textContent ?? "";
      expect(chip).toHaveAttribute("data-status", status);
      unmount();
    }
    expect(texts).toEqual({ live: "Live", paused: "Paused", final: "Ended" });
  });

  it("draws the chips with different outlines and glyphs in the stylesheet", () => {
    expect(css).toMatch(/\.arena-bar-status\[data-status="paused"\]\s*\{[^}]*border-style:\s*dashed/);
    expect(css).toMatch(/\.arena-bar-status\[data-status="paused"\]::before\s*\{[^}]*border-inline/);
    expect(css).toMatch(/\.arena-bar-status\[data-status="final"\]\s*\{[^}]*background:\s*var\(--foreground\)/);
  });
});

describe("the Baron and Elder buffs and the soul", () => {
  it("shows the Baron buff with its time left, then removes it at expiry without changing the bar", () => {
    const first = stateWith({ timeSec: 600, buffs: { blue: { baron_until: 761 } } });
    const { rerenderBar } = renderBar(first);
    const slot = blueSide().querySelector(".arena-bar-buffs");
    const childrenBefore = blueSide().children.length;
    expect(within(blueSide()).getByText("Baron 2:41")).toBeInTheDocument();

    rerenderBar(stateWith({ timeSec: 761, buffs: { blue: { baron_until: 761 } } }));
    expect(within(blueSide()).queryByText(/^Baron \d/)).toBeNull();
    // The slot is still there and the side still holds the same parts: nothing reflows.
    expect(blueSide().querySelector(".arena-bar-buffs")).toBe(slot);
    expect(blueSide().children.length).toBe(childrenBefore);
  });

  it("reserves the space of the buff slot in the stylesheet", () => {
    expect(css).toMatch(/\.arena-bar-buffs\s*\{[^}]*min-width:\s*7\.5rem/);
  });

  it("shows the Elder buff and the soul kind next to it", () => {
    renderBar(
      stateWith({
        timeSec: 1500,
        buffs: { red: { elder_until: 1565, soul_kind: "infernal", baron_until: 1600 } },
      }),
    );
    const buffs = within(redSide()).getByRole("group", { name: "Active buffs" });
    expect(within(buffs).getByText("Soul: Infernal Dragon")).toBeInTheDocument();
    expect(within(buffs).getByText("Elder Dragon 1:05")).toBeInTheDocument();
    expect(within(buffs).getByText("Baron 1:40")).toBeInTheDocument();
  });

  it("names no group when nothing is active", () => {
    renderBar(stateWith());
    expect(within(blueSide()).queryByRole("group", { name: "Active buffs" })).toBeNull();
  });
});

describe("the clock", () => {
  it("starts at the time of the engine answer", () => {
    renderBar(stateWith({ timeSec: 100 }));
    expect(clock()).toHaveTextContent("1:40");
  });

  it("follows the clock of the frames, rounded down", () => {
    const { testBus } = renderBar(stateWith({ timeSec: 100 }));
    testBus.publish(makeFrame(stateWith(), { clockSec: 754.9, nowMs: 1000 }));
    expect(clock()).toHaveTextContent("12:34");
  });

  it("writes at most ten times a second", () => {
    const { testBus } = renderBar(stateWith());
    testBus.publish(makeFrame(stateWith(), { clockSec: 200, nowMs: 1000 }));
    expect(clock()).toHaveTextContent("3:20");

    testBus.publish(makeFrame(stateWith(), { clockSec: 205, nowMs: 1000 + CLOCK_INTERVAL_MS - 1 }));
    expect(clock()).toHaveTextContent("3:20");

    testBus.publish(makeFrame(stateWith(), { clockSec: 205, nowMs: 1000 + CLOCK_INTERVAL_MS }));
    expect(clock()).toHaveTextContent("3:25");
  });

  it("holds the time of the engine once the match is paused or over", () => {
    const { testBus, rerenderBar } = renderBar(stateWith({ timeSec: 299 }));
    testBus.publish(makeFrame(stateWith(), { clockSec: 299.4, nowMs: 1000 }));
    expect(clock()).toHaveTextContent("4:59");
    rerenderBar(stateWith({ timeSec: 301 }), "final");
    expect(clock()).toHaveTextContent("5:01");
  });

  it("is a timer that is not announced as it changes", () => {
    renderBar(stateWith());
    expect(clock()).toHaveAccessibleName("Match time");
    expect(clock()).not.toHaveAttribute("aria-live", "polite");
  });

  it("never renders React on a frame", () => {
    const onRender = vi.fn();
    const testBus = createTestBus();
    render(
      <Profiler id="bar" onRender={onRender}>
        <ScoreBar state={stateWith()} blue={BLUE} red={RED} status="live" bus={testBus.bus} />
      </Profiler>,
    );
    const commits = onRender.mock.calls.length;
    for (let frame = 0; frame < 30; frame += 1) {
      testBus.publish(makeFrame(stateWith(), { clockSec: 100 + frame, nowMs: 1000 + frame * 16 }));
    }
    expect(onRender.mock.calls.length).toBe(commits);
    expect(clock()).not.toHaveTextContent("1:40");
  });
});

describe("ScoreBar in the Spanish UI", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("es");
  });
  afterAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("speaks Spanish and shows no raw key", () => {
    const { container } = renderBar(
      stateWith({
        timeSec: 600,
        blue: { kills: 11, towers: 2, gold: 12350 },
        buffs: { blue: { baron_until: 700, soul_kind: "ocean" } },
      }),
      "paused",
    );
    expect(screen.getByText("Asesinatos de Azul: 11")).toBeInTheDocument();
    expect(screen.getByTestId("match-status")).toHaveTextContent("Pausado");
    expect(blueSide()).toHaveTextContent("Torre 2");
    expect(blueSide()).toHaveTextContent("Oro 12,4k");
    expect(within(blueSide()).getByText("Alma: Dragón oceánico")).toBeInTheDocument();
    expect(within(blueSide()).getByText("Barón 1:40")).toBeInTheDocument();
    expect(clock()).toHaveAccessibleName("Tiempo de partida");
    expect(container.textContent).not.toMatch(/onAir\.match\.|match\.liveA11y/);
  });
});
