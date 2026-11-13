import { act, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import i18n from "@/i18n";

import { ArenaMap, ARENA_LAYERS } from "./ArenaMap";
import { useArenaBus, useMapSize } from "./arenaMapContext";
import { createFrameBus } from "./frameBus";
import { createFakeScheduler } from "./frameScheduler.testing";
import type { LiveFrame } from "./useLiveSession";

type ObserverCallback = (entries: Array<{ contentRect: { width: number; height: number } }>) => void;

const observers: StubObserver[] = [];

class StubObserver {
  disconnected = false;
  constructor(private readonly callback: ObserverCallback) {
    observers.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  resize(width: number, height: number) {
    this.callback([{ contentRect: { width, height } }]);
  }
}

const originalObserver = globalThis.ResizeObserver;

beforeEach(() => {
  observers.length = 0;
  globalThis.ResizeObserver = StubObserver as unknown as typeof ResizeObserver;
});

afterEach(() => {
  globalThis.ResizeObserver = originalObserver;
});

/** The grid cell of the map takes this size; a square cell when no height is given. */
function resizeTo(width: number, height = width) {
  act(() => {
    observers[observers.length - 1].resize(width, height);
  });
}

const bus = () => createFrameBus<LiveFrame>(createFakeScheduler());

function SizeProbe() {
  return <span data-testid="probe">{useMapSize()}</span>;
}

describe("ArenaMap", () => {
  it.each([320, 540, 660])("hands a map of %i px to its layers", (width) => {
    render(<ArenaMap bus={bus()} layers={{ champions: <SizeProbe /> }} />);
    resizeTo(width);
    expect(screen.getByTestId("probe")).toHaveTextContent(String(width));
    expect(screen.getByTestId("arena-map")).toHaveAttribute("data-size", String(width));
  });

  it("follows the map when it is resized", () => {
    render(<ArenaMap bus={bus()} layers={{ champions: <SizeProbe /> }} />);
    resizeTo(540);
    expect(screen.getByTestId("probe")).toHaveTextContent("540");
    resizeTo(320);
    expect(screen.getByTestId("probe")).toHaveTextContent("320");
  });

  it.each([
    { cell: "600x474", width: 600, height: 474, side: 474 },
    { cell: "400x600", width: 400, height: 600, side: 400 },
    { cell: "474x474", width: 474, height: 474, side: 474 },
    { cell: "640.9x500.9", width: 640.9, height: 500.9, side: 500 },
  ])("is the square that fits a $cell cell: $side px, never beyond either side", ({ width, height, side }) => {
    render(<ArenaMap bus={bus()} layers={{ champions: <SizeProbe /> }} />);
    resizeTo(width, height);
    const map = screen.getByTestId("arena-map");
    expect(screen.getByTestId("probe")).toHaveTextContent(String(side));
    expect(map).toHaveAttribute("data-size", String(side));
    expect(map).toHaveStyle({ width: `${side}px`, height: `${side}px` });
    expect(side).toBeLessThanOrEqual(Math.min(width, height));
  });

  it("measures the cell around the map, not the map, and keeps the map out of the cell's size", () => {
    render(<ArenaMap bus={bus()} />);
    const cell = screen.getByTestId("arena-cell");
    expect(cell).toHaveClass("arena-cell");
    expect(cell.children).toHaveLength(1);
    expect(cell.firstElementChild).toBe(screen.getByTestId("arena-map"));
  });

  it("follows a row that gets shorter than the column while the window stays as wide", () => {
    render(<ArenaMap bus={bus()} layers={{ champions: <SizeProbe /> }} />);
    resizeTo(474, 474);
    expect(screen.getByTestId("probe")).toHaveTextContent("474");
    resizeTo(474, 436);
    expect(screen.getByTestId("probe")).toHaveTextContent("436");
  });

  it("watches the size with one observer and lets go of it on unmount", () => {
    const { unmount } = render(<ArenaMap bus={bus()} />);
    expect(observers).toHaveLength(1);
    unmount();
    expect(observers[0].disconnected).toBe(true);
  });

  it("mounts no layer until the map has a size", () => {
    render(<ArenaMap bus={bus()} layers={{ champions: <SizeProbe /> }} />);
    expect(screen.queryByTestId("probe")).toBeNull();
  });

  it("shares the frame bus it was given with the layers", () => {
    const given = bus();
    let seen: unknown = null;
    function BusProbe() {
      seen = useArenaBus();
      return null;
    }
    render(<ArenaMap bus={given} layers={{ contacts: <BusProbe /> }} />);
    resizeTo(540);
    expect(seen).toBe(given);
  });

  it("refuses a layer used outside a map", () => {
    expect(() => render(<SizeProbe />)).toThrow(/inside ArenaMap/);
  });

  it("stacks terrain, then the layers in a fixed order", () => {
    render(<ArenaMap bus={bus()} />);
    const map = screen.getByTestId("arena-map");
    const children = [...map.children];
    expect(children[0]).toBe(screen.getByTestId("arena-terrain"));
    expect(children.slice(1).map((child) => child.getAttribute("data-layer"))).toEqual([...ARENA_LAYERS]);
  });

  it("is one image named for the viewer, described by the text twin", () => {
    render(
      <>
        <ArenaMap bus={bus()} describedBy="fight-board" />
        <p id="fight-board">Blue and red are trading hits in the top lane.</p>
      </>,
    );
    const map = screen.getByRole("img", {
      name: "Match map. Blue base at the bottom left, red base at the top right.",
    });
    expect(map).toHaveAccessibleDescription("Blue and red are trading hits in the top lane.");
    expect(screen.getByTestId("arena-terrain")).toHaveAttribute("aria-hidden", "true");
  });

  it("says Paused in words, not in colour only", () => {
    const { rerender } = render(<ArenaMap bus={bus()} />);
    expect(screen.queryByTestId("arena-paused")).toBeNull();
    rerender(<ArenaMap bus={bus()} paused />);
    expect(screen.getByTestId("arena-paused")).toHaveTextContent("Paused");
  });
});

describe("ArenaMap in the Spanish UI", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("es");
  });
  afterAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("names the map and the pause in Spanish", () => {
    render(<ArenaMap bus={bus()} paused />);
    expect(
      screen.getByRole("img", {
        name: "Mapa de la partida. Base azul abajo a la izquierda, base roja arriba a la derecha.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("arena-paused")).toHaveTextContent("Pausado");
  });
});
