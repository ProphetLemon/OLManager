import { fireEvent, render, screen } from "@testing-library/react";
import { Profiler } from "react";
import { describe, expect, it, vi } from "vitest";

import { markerState } from "@/lib/match/live/championMarker";
import { recallProgress } from "@/lib/match/live/contacts";
import type { TagPlacement } from "@/lib/match/live/tagPlacement";

import { ArenaHarness } from "./arenaHarness.testing";
import { createTestBus, makeChampion, makeFrame, makeState } from "./arenaFixtures.testing";
import { ChampionMarker, type ChampionMarkerProps } from "./ChampionMarker";
import { RING_CLASSES } from "./ringClasses";
import type { MarkerTexts } from "./useMarkerTexts";

const NO_TEXT: MarkerTexts = { sub: "", subCompact: "", badge: "" };
const RING_LENGTH = 2 * Math.PI * 46;

function props(over: Partial<ChampionMarkerProps> = {}): ChampionMarkerProps {
  return {
    champion: makeChampion("korvan", "blue", 0.5, 0.25, { name: "Korvan" }),
    nowSec: 100,
    state: null,
    texts: NO_TEXT,
    tag: undefined,
    fighting: false,
    selected: false,
    dimmed: false,
    onSelect: () => {},
    ...over,
  };
}

function setup(over: Partial<ChampionMarkerProps> = {}, sizePx = 540) {
  const test = createTestBus();
  const view = render(
    <ArenaHarness bus={test.bus} sizePx={sizePx}>
      <ChampionMarker {...props(over)} />
    </ArenaHarness>,
  );
  const rerenderAt = (nextSize: number, next: Partial<ChampionMarkerProps> = over) =>
    view.rerender(
      <ArenaHarness bus={test.bus} sizePx={nextSize}>
        <ChampionMarker {...props(next)} />
      </ArenaHarness>,
    );
  return { ...test, ...view, anchor: () => screen.getByTestId("champion-korvan"), rerenderAt };
}

const frameAt = (x: number, y: number, over = {}) =>
  makeFrame(makeState({ champions: [makeChampion("korvan", "blue", x, y, over)] }));

describe("frame path", () => {
  it("moves the anchor with a translate in pixels after a frame", () => {
    const { anchor, publish } = setup();
    publish(frameAt(0.5, 0.25));
    expect(anchor().style.transform).toBe("translate(270px, 135px)");
    publish(frameAt(0.6, 0.5));
    expect(anchor().style.transform).toBe("translate(324px, 270px)");
  });

  it("moves by transform alone: no left, top or CSS variable", () => {
    const { anchor, publish } = setup();
    publish(frameAt(0.3, 0.7));
    expect(anchor().style.left).toBe("");
    expect(anchor().style.top).toBe("");
    expect(anchor().getAttribute("style")).not.toContain("var(");
    expect(anchor().getAttribute("style")).not.toContain("--");
  });

  it("puts the marker back where it was when the map is resized", () => {
    const { anchor, publish, rerenderAt } = setup();
    publish(frameAt(0.5, 0.25));
    rerenderAt(320);
    expect(anchor().style.transform).toBe("translate(160px, 80px)");
  });

  it("starts at the champion's own position before any frame arrives", () => {
    const { anchor } = setup();
    expect(anchor().style.transform).toBe("translate(270px, 135px)");
  });

  it("ignores a frame that does not mention the champion", () => {
    const { anchor, publish } = setup();
    publish(frameAt(0.5, 0.25));
    publish(makeFrame(makeState({ champions: [makeChampion("other", "red", 0.9, 0.9)] })));
    expect(anchor().style.transform).toBe("translate(270px, 135px)");
  });

  it("renders React once per commit, not once per frame", () => {
    const test = createTestBus();
    const onRender = vi.fn();
    render(
      <Profiler id="marker" onRender={onRender}>
        <ArenaHarness bus={test.bus}>
          <ChampionMarker {...props()} />
        </ArenaHarness>
      </Profiler>,
    );
    const afterMount = onRender.mock.calls.length;
    for (let i = 0; i < 40; i += 1) test.publish(frameAt(0.4 + i * 0.001, 0.25));
    expect(onRender.mock.calls.length).toBe(afterMount);
  });

  it("stops listening when it unmounts", () => {
    const { bus, unmount } = setup();
    expect(bus.subscriberCount()).toBe(1);
    unmount();
    expect(bus.subscriberCount()).toBe(0);
  });
});

describe("recall ring", () => {
  const recalling = makeChampion("korvan", "blue", 0.5, 0.25, {
    name: "Korvan",
    state: "recall",
    recallChannelUntil: 103.25,
  });

  it("is drawn only while the champion recalls", () => {
    const { rerender, bus } = setup();
    expect(screen.queryByTestId("recall-ring")).toBeNull();
    rerender(
      <ArenaHarness bus={bus}>
        <ChampionMarker {...props({ champion: recalling, state: markerState(recalling, false, 100) })} />
      </ArenaHarness>,
    );
    expect(screen.getByTestId("recall-ring")).toBeInTheDocument();
  });

  it("drains with the progress of the recall, frame by frame", () => {
    const { container, publish } = setup({ champion: recalling, state: markerState(recalling, false, 100) });
    const arc = () => container.querySelector(".arena-recall-arc")!.getAttribute("stroke-dasharray")!;

    publish(makeFrame(makeState({ champions: [recalling] }), { clockSec: 100 }));
    const expected = (clock: number) =>
      ((1 - recallProgress(recalling, clock)!) * RING_LENGTH).toFixed(2);
    expect(arc().split(" ")[0]).toBe(expected(100));
    expect(Number(arc().split(" ")[0])).toBeCloseTo(RING_LENGTH / 2, 1);

    publish(makeFrame(makeState({ champions: [recalling] }), { clockSec: 102 }));
    expect(arc().split(" ")[0]).toBe(expected(102));
    expect(Number(arc().split(" ")[0])).toBeLessThan(RING_LENGTH / 2);
  });

  it("is not reset to the last answer when React renders again", () => {
    const { container, publish, rerender, bus } = setup({ champion: recalling, state: markerState(recalling, false, 100) });
    publish(makeFrame(makeState({ champions: [recalling] }), { clockSec: 102 }));
    const drawn = container.querySelector(".arena-recall-arc")!.getAttribute("stroke-dasharray");
    rerender(
      <ArenaHarness bus={bus}>
        <ChampionMarker {...props({ champion: recalling, nowSec: 100.25, state: markerState(recalling, false, 100.25) })} />
      </ArenaHarness>,
    );
    expect(container.querySelector(".arena-recall-arc")!.getAttribute("stroke-dasharray")).toBe(drawn);
  });
});

describe("states", () => {
  it("shows a dead champion's seconds in the bubble, with a dashed outline", () => {
    const dead = makeChampion("korvan", "blue", 0.5, 0.25, { name: "Korvan", alive: false, respawnAt: 112.2 });
    setup({ champion: dead, state: markerState(dead, false, 100) });
    expect(screen.getByTestId("respawn-seconds")).toHaveTextContent("13");
    expect(screen.getByTestId("champion-korvan")).toHaveAttribute("data-dead", "true");
    expect(document.querySelector(".arena-hp")).toBeNull();
  });

  it("marks the followed champion with the club ring and steps the others back", () => {
    const { container } = setup({ selected: true });
    expect(container.querySelector(".arena-bubble")).toHaveClass(RING_CLASSES.selected);
    expect(screen.getByTestId("champion-korvan")).not.toHaveAttribute("data-dim");
  });

  it("dims a champion when another one is followed", () => {
    const { container } = setup({ dimmed: true });
    expect(screen.getByTestId("champion-korvan")).toHaveAttribute("data-dim", "true");
    expect(container.querySelector(".arena-bubble")).not.toHaveClass(RING_CLASSES.selected);
  });

  it("rings a fighting champion twice", () => {
    const { container } = setup({ fighting: true });
    expect(container.querySelector(".arena-bubble")).toHaveClass(RING_CLASSES.fighting);
  });

  it("gives the three rings three different classes", () => {
    expect(new Set(Object.values(RING_CLASSES)).size).toBe(3);
  });

  it("selects the player on click", () => {
    const onSelect = vi.fn();
    const { container } = setup({ onSelect });
    fireEvent.click(container.querySelector(".arena-bubble")!);
    expect(onSelect).toHaveBeenCalledWith("korvan");
  });

  it("is hidden from assistive technology", () => {
    setup();
    expect(screen.getByTestId("champion-korvan")).toHaveAttribute("aria-hidden", "true");
  });

  it("tells the teams apart by attribute, for the shape rules to read", () => {
    const test = createTestBus();
    render(
      <ArenaHarness bus={test.bus}>
        <ChampionMarker {...props()} />
        <ChampionMarker {...props({ champion: makeChampion("dellan", "red", 0.7, 0.3) })} />
      </ArenaHarness>,
    );
    expect(screen.getByTestId("champion-korvan")).toHaveAttribute("data-team", "blue");
    expect(screen.getByTestId("champion-dellan")).toHaveAttribute("data-team", "red");
  });
});

describe("bubble content", () => {
  it("draws the champion tile and hides it from the reader", () => {
    const { container } = setup({ championKey: "Ahri" });
    const image = container.querySelector("img")!;
    expect(image).toHaveAttribute("src", "/champion-tiles/Ahri.webp");
    expect(image).toHaveAttribute("alt", "");
  });

  it("falls back to initials when the tile is missing or fails to load", () => {
    const { container } = setup({ championKey: "Ahri" });
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".arena-initials")).toHaveTextContent("KO");
  });

  it("shows initials when the player has no champion yet", () => {
    const { container } = setup();
    expect(container.querySelector(".arena-initials")).toHaveTextContent("KO");
  });

  it("sizes the bubble from the map and centres it on the anchor", () => {
    const { container } = setup({}, 320);
    const bubble = container.querySelector<HTMLElement>(".arena-bubble")!;
    expect(bubble.style.width).toBe("24px");
    expect(bubble.style.left).toBe("-12px");
    expect(bubble.style.top).toBe("-12px");
  });

  it("shows level and a health bar for a living champion", () => {
    const { container } = setup();
    expect(container.querySelector(".arena-level")).toHaveTextContent("6");
    expect(container.querySelector<HTMLElement>(".arena-hp i")!.style.width).toBe("80%");
  });
});

describe("tags", () => {
  const texts: MarkerTexts = { sub: "Recall 3.9s", subCompact: "R 3.9", badge: "R 3.9" };
  const box = { x0: 0, y0: 0, x1: 0, y1: 0 };
  const placed = (slot: "below" | "above" | "right" | "left", align: "center" | "start" | "end" = "center", form: "full" | "compact" = "full"): TagPlacement => ({
    form,
    slot,
    align,
    box,
  });

  it("puts the tag in the slot the solver chose, clear of the bubble", () => {
    const { container } = setup({ tag: placed("below"), texts }, 540);
    const tag = container.querySelector<HTMLElement>(".arena-tag")!;
    expect(tag).toHaveAttribute("data-slot", "below");
    expect(tag.style.top).toBe("23.96px");
    expect(tag).toHaveTextContent("Recall 3.9s");
  });

  it.each([
    ["above", "bottom", "20.96px"],
    ["right", "left", "20.96px"],
    ["left", "right", "20.96px"],
  ] as const)("anchors a %s tag with %s", (slot, property, value) => {
    const { container } = setup({ tag: placed(slot), texts }, 540);
    expect(container.querySelector<HTMLElement>(".arena-tag")!.style[property]).toBe(value);
  });

  it("anchors an edge tag by its start or its end", () => {
    const start = setup({ tag: placed("below", "start"), texts });
    expect(start.container.querySelector<HTMLElement>(".arena-tag")!.style.left).toBe("-18.96px");
    start.unmount();
    const end = setup({ tag: placed("above", "end"), texts });
    expect(end.container.querySelector<HTMLElement>(".arena-tag")!.style.right).toBe("-18.96px");
  });

  it("carries both forms of the name and of the state, for the small map to choose", () => {
    const { container } = setup({ tag: placed("below"), texts });
    expect(container.querySelector(".arena-tag b .arena-tag-long")).toHaveTextContent("Korvan");
    expect(container.querySelector(".arena-tag b .arena-tag-short")).toHaveTextContent("Kor");
    expect(container.querySelector(".arena-tag-sub.arena-tag-short")).toHaveTextContent("R 3.9");
  });

  it("shows the badge on the bubble when the tag found no slot", () => {
    setup({ tag: { form: "badge" }, texts });
    expect(screen.getByTestId("state-badge")).toHaveTextContent("R 3.9");
    expect(screen.queryByTestId("tag")).toBeNull();
  });

  it("shows no badge when the champion has no state", () => {
    setup({ tag: { form: "none" } });
    expect(screen.queryByTestId("state-badge")).toBeNull();
    expect(screen.queryByTestId("tag")).toBeNull();
  });
});
