import { act, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import i18n from "@/i18n";

import { ArenaMap, ARENA_LAYERS } from "./ArenaMap";
import { useArenaBus, useMapSize } from "./arenaMapContext";
import { createFrameBus } from "./frameBus";
import { createFakeScheduler } from "./frameScheduler.testing";
import type { LiveFrame } from "./useLiveSession";

type ObserverCallback = (entries: Array<{ contentRect: { width: number } }>) => void;

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
  resize(width: number) {
    this.callback([{ contentRect: { width } }]);
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

function resizeTo(width: number) {
  act(() => {
    observers[observers.length - 1].resize(width);
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
