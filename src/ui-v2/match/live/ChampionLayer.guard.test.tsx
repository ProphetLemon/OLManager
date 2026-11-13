import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { detectContacts } from "@/lib/match/live/contacts";
import { GUARD_HOLD_MS } from "@/lib/match/live/tagGuard";

import { ArenaHarness } from "./arenaHarness.testing";
import { createTestBus, makeChampion, makeFrame, makeState, makeStructure } from "./arenaFixtures.testing";
import { ChampionLayer } from "./ChampionLayer";

/**
 * The guard looks at where the markers are drawn on every frame and hides the tag that has ended
 * up on another tag or on a label, through `data-guard` alone. The solve below places both tags
 * clear of each other; the frames then move the markers the way a turn between two solves would.
 */

type Beam = { structureId: string; targetId: string; shots: number; ageSec: number };

function mount(state: ReturnType<typeof makeState>, beams: Beam[] = []) {
  const test = createTestBus();
  const view = render(
    <ArenaHarness bus={test.bus}>
      <ChampionLayer
        state={state}
        championByPlayerId={{}}
        contacts={detectContacts(state.champions, state.timeSec)}
        selectedId={null}
        onSelect={() => {}}
        beams={beams}
      />
    </ArenaHarness>,
  );
  return { ...test, view };
}

const tagOf = (id: string) => within(screen.getByTestId(`champion-${id}`)).getByTestId("tag");
/** "hidden" while the guard holds the tag back, "" once it shows. The stylesheet turns it into opacity 0. */
const opacityOf = (id: string) => (tagOf(id).getAttribute("data-guard") === "hidden" ? "0" : "");

/** Two champions far apart: `high` is above `low`, so it has the priority. */
const apart = () =>
  makeState({
    champions: [makeChampion("high", "blue", 0.3, 0.2, { name: "HIGH" }), makeChampion("low", "red", 0.3, 0.7, { name: "LOW" })],
  });
const crossed = (lowY = 0.215) =>
  makeState({
    champions: [makeChampion("high", "blue", 0.3, 0.2, { name: "HIGH" }), makeChampion("low", "red", 0.3, lowY, { name: "LOW" })],
  });

afterEach(() => vi.restoreAllMocks());

describe("the tag guard on the frame path", () => {
  it("shows both tags while the markers stay apart", () => {
    const { publish } = mount(apart());
    publish(makeFrame(apart(), { nowMs: 0 }));
    expect(opacityOf("high")).toBe("");
    expect(opacityOf("low")).toBe("");
  });

  it("hides the lower priority tag of two that end up on each other, and keeps the other", () => {
    const { publish } = mount(apart());
    publish(makeFrame(crossed(), { nowMs: 16 }));
    expect(opacityOf("low")).toBe("0");
    expect(opacityOf("high")).toBe("");
  });

  it("brings the tag back only after the markers have been clear for the hold time", () => {
    const { publish } = mount(apart());
    publish(makeFrame(crossed(), { nowMs: 0 }));
    expect(opacityOf("low")).toBe("0");

    publish(makeFrame(apart(), { nowMs: 100 }));
    publish(makeFrame(apart(), { nowMs: 100 + GUARD_HOLD_MS - 1 }));
    expect(opacityOf("low")).toBe("0");
    publish(makeFrame(apart(), { nowMs: 100 + GUARD_HOLD_MS }));
    expect(opacityOf("low")).toBe("");
  });

  it("hides a tag that a frame puts on the name under a nexus", () => {
    const structures = [makeStructure("nexus-blue", "blue", "nexus", 0.1, 0.88)];
    const at = (x: number, y: number) => makeState({ champions: [makeChampion("solo", "blue", x, y, { name: "SOLO" })], structures });
    const { publish } = mount(at(0.5, 0.5));
    expect(opacityOf("solo")).toBe("");
    // The champion walked home: its tag, below the bubble, now sits where the nexus is named.
    publish(makeFrame(at(0.1, 0.8), { nowMs: 16 }));
    expect(opacityOf("solo")).toBe("0");
  });

  it("hides a tag that the beam of a tower reaches, as its target walks", () => {
    const structures = [makeStructure("tower-red", "red", "tower", 0.2, 0.2)];
    const champions = (target: number) => [
      makeChampion("a", "blue", 0.5, 0.5, { name: "AAA" }),
      makeChampion("t", "blue", 0.8, target, { name: "TTT" }),
    ];
    const beams = [{ structureId: "tower-red", targetId: "t", shots: 2, ageSec: 0.4 }];
    const { publish } = mount(makeState({ champions: champions(0.2), structures }), beams);
    expect(opacityOf("a")).toBe("");
    // The target drops to the foot of the map: the line from the tower to it crosses the tag of A.
    publish(makeFrame(makeState({ champions: champions(0.9), structures }), { nowMs: 16 }));
    expect(opacityOf("a")).toBe("0");
  });

  it("writes the guard attribute and nothing else on a tag, and reads no layout on a frame", () => {
    const { publish } = mount(apart());
    const rect = vi.spyOn(Element.prototype, "getBoundingClientRect");
    const width = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get");
    const height = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get");
    const styleOf = (id: string) => {
      const { style } = tagOf(id);
      return Object.fromEntries(Array.from({ length: style.length }, (_, index) => [style[index], style.getPropertyValue(style[index])]));
    };
    const before = styleOf("low");

    const seen = new Set<string>();
    for (let frame = 0; frame < 30; frame += 1) {
      publish(makeFrame(frame % 12 < 2 ? crossed() : apart(), { nowMs: frame * 40 }));
      seen.add(opacityOf("low"));
    }

    // The tag really was hidden and shown, and its inline style is the one React gave it: no opacity, no transition.
    expect([...seen].sort()).toEqual(["", "0"]);
    expect(styleOf("low")).toEqual(before);
    expect(tagOf("low").style.opacity).toBe("");
    expect(tagOf("low").style.transition).toBe("");
    expect(rect).not.toHaveBeenCalled();
    expect(width).not.toHaveBeenCalled();
    expect(height).not.toHaveBeenCalled();
  });

  it("hides a tag with no transition, and brings it back with the 120 ms fade", () => {
    // The real stylesheet: the guard only flips an attribute, so what the tag does depends on the CSS.
    const style = document.createElement("style");
    style.textContent = readFileSync(resolve(__dirname, "liveMatch.css"), "utf8");
    document.head.append(style);
    try {
      const { publish } = mount(apart());
      const computed = () => getComputedStyle(tagOf("low"));
      expect(computed().transition).toBe("opacity 120ms linear");

      publish(makeFrame(crossed(), { nowMs: 0 }));
      // Hidden: opacity 0 takes effect at once, so it cannot stay drawn over the other tag while it fades.
      expect(computed().opacity).toBe("0");
      expect(computed().transition).toBe("none");

      publish(makeFrame(apart(), { nowMs: 100 }));
      publish(makeFrame(apart(), { nowMs: 100 + GUARD_HOLD_MS }));
      expect(opacityOf("low")).toBe("");
      expect(computed().transition).toBe("opacity 120ms linear");
    } finally {
      style.remove();
    }
  });

  it("never shows a tag the solver did not place: a champion with no tag stays without one", () => {
    // Ten champions on one spot: some get a badge or nothing. A frame does not give them a tag.
    const pile = makeState({
      champions: Array.from({ length: 10 }, (_, index) =>
        makeChampion(`c${index}`, index < 5 ? "blue" : "red", 0.5 + (index % 5) * 0.003, 0.5, { name: `C${index}` }),
      ),
    });
    const { publish } = mount(pile);
    const tagsBefore = document.querySelectorAll("[data-testid='tag']").length;
    publish(makeFrame(pile, { nowMs: 16 }));
    publish(makeFrame(pile, { nowMs: 1000 }));
    expect(document.querySelectorAll("[data-testid='tag']")).toHaveLength(tagsBefore);
  });
});
