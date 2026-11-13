import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ComponentProps } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import type { MatchSnapshot } from "@/ui-v2/_legacy/components/match/types";

import { makeChampion, makeState } from "./live/arenaFixtures.testing";
import LiveMatchV2 from "./LiveMatchV2";

type Answer = ReturnType<typeof makeState>;

const engine = vi.hoisted(() => ({
  built: 0,
  disposes: 0,
  resets: 0,
  initState: null as unknown,
  skipImpl: null as null | (() => Promise<unknown>),
  fetches: 0,
}));

vi.mock("@/ui-v2/_legacy/components/match/lol-prototype/assets/map", () => ({ getWalls: () => [] }));
vi.mock("@/ui-v2/_legacy/components/match/lol-prototype/engine/navigation", () => ({ NavGrid: class {} }));
vi.mock("@/ui-v2/_legacy/components/match/lol-prototype/engine/simulation", () => ({
  PrototypeSimulation: class {
    state = { winner: null, timeSec: 0, events: [], champions: [], stats: undefined };
    constructor() {
      engine.built += 1;
    }
    setRunning() {}
    tick() {}
    reset() {}
  },
}));
vi.mock("@/ui-v2/_legacy/components/match/lol-prototype/backend/tauri-client", () => ({
  LolSimV2Client: class {
    init() {
      return Promise.resolve({ sessionId: "s", state: engine.initState });
    }
    tick() {
      return Promise.resolve({ sessionId: "s", state: engine.initState });
    }
    reset() {
      engine.resets += 1;
      return Promise.resolve({ sessionId: "s", state: engine.initState });
    }
    skipToEnd() {
      return engine.skipImpl ? engine.skipImpl() : Promise.reject(new Error("no skip"));
    }
    dispose() {
      engine.disposes += 1;
      return Promise.resolve({ sessionId: "s", disposed: true });
    }
  },
}));

// The map measures itself, and layers mount only once it has a size.
const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 540 });
  // jsdom has no canvas; the minions are drawn in their own tests.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

const team = (id: string, name: string) => ({ id, name, players: [] });
const snapshot = {
  phase: "Live",
  current_minute: 0,
  home_score: 0,
  away_score: 0,
  home_team: team("home", "Embers Esports"),
  away_team: team("away", "Tides"),
  events: [],
} as unknown as MatchSnapshot;

const ROLES = ["TOP", "JGL", "MID", "ADC", "SUP"] as const;

/** Ten champions, the top laners in a fight, and optionally the end of the match. */
function matchState(over: Partial<Answer> = {}, winner: "blue" | "red" | null = null): Answer {
  const champions = ROLES.flatMap((role, index) => [
    makeChampion(`b-${role}`, "blue", 0.2 + index * 0.05, 0.7 - index * 0.04, {
      name: `Blue ${role}`,
      role,
      ...(role === "TOP" ? { lastDamagedByChampionId: "r-TOP", lastDamagedByChampionAt: 98 } : {}),
    }),
    makeChampion(`r-${role}`, "red", 0.26 + index * 0.05, 0.64 - index * 0.04, { name: `Red ${role}`, role }),
  ]);
  return makeState({
    timeSec: 100,
    champions,
    winner,
    stats: {
      blue: { kills: 3, towers: 2, dragons: 1, barons: 0, gold: 12500 },
      red: { kills: 7, towers: 5, dragons: 2, barons: 0, gold: 15300 },
    },
    events: [{ t: 90, text: "Blue TOP killed Red TOP", type: "kill" }],
    ...over,
  });
}

const finishedState = () => matchState({ timeSec: 1923 }, "red");

type Props = ComponentProps<typeof LiveMatchV2>;

function mount(extra: Partial<Props> = {}) {
  const handlers = {
    onSnapshotUpdate: vi.fn<Props["onSnapshotUpdate"]>(),
    onImportantEvent: vi.fn<Props["onImportantEvent"]>(),
    onFullTime: vi.fn<Props["onFullTime"]>(),
  };
  const view = render(<LiveMatchV2 gameState={null} snapshot={snapshot} {...handlers} {...extra} />);
  return { ...view, ...handlers };
}

async function openMenu() {
  const trigger = screen.getByRole("button", { name: "Match options" });
  act(() => trigger.focus());
  fireEvent.mouseDown(trigger);
  fireEvent.mouseUp(trigger);
  fireEvent.click(trigger);
  await screen.findByRole("menu");
}

async function skipFromTheMenu() {
  await openMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: "Skip match" }));
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Show the result" }));
}

beforeEach(() => {
  engine.built = 0;
  engine.disposes = 0;
  engine.resets = 0;
  engine.initState = matchState();
  engine.skipImpl = null;
  engine.fetches = 0;
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the screen", () => {
  it("wires the session, the layers and the panels to one engine answer", async () => {
    mount();
    await screen.findByTestId("champion-b-TOP");
    // The contact view is computed once and reaches both the markers and the links.
    expect(screen.getByTestId("champion-b-TOP")).toHaveAttribute("data-fighting");
    expect(screen.getByTestId("champion-r-TOP")).toHaveAttribute("data-fighting");
    expect(screen.getByTestId("contact-chip")).toBeInTheDocument();
    // The score bar, the feed, the caption, the board and the controls read the same state.
    expect(screen.getByTestId("score-bar")).toHaveTextContent("EESP");
    expect(screen.getByTestId("event-ticker")).toHaveTextContent("Blue TOP");
    expect(screen.getByTestId("spotlight-caption")).toBeInTheDocument();
    expect(screen.getByTestId("fight-board")).toBeInTheDocument();
    expect(screen.getByTestId("match-controls")).toBeInTheDocument();
    expect(screen.getByTestId("map-legend")).toBeInTheDocument();
  });

  it("points the map at the Fight board, which is in the page", async () => {
    mount();
    const map = await screen.findByTestId("arena-map");
    const id = map.getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    expect(document.getElementById(id as string)).toBe(screen.getByTestId("fight-board"));
  });

  it("shows the feed on a 900 px tall coarse-pointer touch window, where the old screen hid it", async () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
    Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 5 });
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    mount();
    await screen.findByTestId("champion-b-TOP");
    expect(screen.getByTestId("event-ticker")).toBeVisible();
    expect(screen.getByRole("list", { name: /event feed/i })).toBeInTheDocument();
  });

  it("keeps the landmarks in reading order: bar, map, feed, controls, blue cards, red cards", async () => {
    mount();
    await screen.findByTestId("champion-b-TOP");
    const order = [
      screen.getByTestId("score-bar"),
      screen.getByTestId("arena-map"),
      screen.getByTestId("event-ticker"),
      screen.getByTestId("match-controls"),
      screen.getByRole("region", { name: "Embers Esports players" }),
      screen.getByRole("region", { name: "Tides players" }),
    ];
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING, `landmark ${i}`).toBeTruthy();
    }
  });

  it("lists five cards per team, top to support", async () => {
    mount();
    const blue = await screen.findByRole("region", { name: "Embers Esports players" });
    const names = within(blue)
      .getAllByRole("button")
      .map((card) => card.getAttribute("aria-label") ?? card.textContent ?? "");
    expect(names).toHaveLength(5);
    expect(names.map((name) => ROLES.findIndex((role) => name.includes(role)))).toEqual([0, 1, 2, 3, 4]);
  });

  it("follows a player from a card and lets go on a second press", async () => {
    mount();
    const blue = await screen.findByRole("region", { name: "Embers Esports players" });
    const card = within(blue).getAllByRole("button")[0];
    fireEvent.click(card);
    await waitFor(() => expect(screen.getByTestId("champion-b-TOP")).toHaveAttribute("data-selected"));
    expect(within(await screen.findByRole("region", { name: "Embers Esports players" })).getAllByRole("button")[0]).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(within(screen.getByRole("region", { name: "Embers Esports players" })).getAllByRole("button")[0]);
    await waitFor(() => expect(screen.getByTestId("champion-b-TOP")).not.toHaveAttribute("data-selected"));
  });

  it("downloads nothing and builds the simulation once", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mount();
    await screen.findByTestId("champion-b-TOP");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(engine.built).toBe(1);
  });
});

describe("the finish", () => {
  beforeEach(() => {
    engine.initState = finishedState();
  });

  it("hands the winner on once and waits for Continue before the match moves on", async () => {
    const { onSnapshotUpdate, onImportantEvent, onFullTime } = mount();
    await screen.findByRole("dialog", { name: "Match result" });
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(onImportantEvent).toHaveBeenCalledTimes(1);
    expect(onSnapshotUpdate).toHaveBeenCalledTimes(1);
    expect(onSnapshotUpdate.mock.calls[0][0]).toMatchObject({ phase: "Finished", current_minute: 32, home_score: 0, away_score: 1 });
    expect(onFullTime).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onFullTime).toHaveBeenCalledTimes(1);
    const [finalState, meta] = onFullTime.mock.calls[0];
    expect(meta).toEqual({ source: "live" });
    expect(finalState).toMatchObject({ winner: "red", timeSec: 1923 });
    expect(finalState.goldDiffTimeline?.length).toBeGreaterThan(0);
  });

  it("shows the result: the outcome for the manager, the numbers, the lead and Continue", async () => {
    mount({ gameState: { manager: { team_id: "home" }, teams: [] } as never });
    const panel = await screen.findByTestId("end-panel");
    expect(within(panel).getByText("Match Over")).toBeInTheDocument();
    expect(within(panel).getByRole("heading", { name: "Defeat" })).toBeInTheDocument();
    expect(within(panel).getByText("Duration 32:03")).toBeInTheDocument();
    expect(within(panel).getByRole("rowheader", { name: "Towers" }).closest("tr")).toHaveTextContent("25");
    expect(within(panel).getByRole("rowheader", { name: "Gold" }).closest("tr")).toHaveTextContent("12.5k15.3k");
    expect(within(panel).getByText("Tides finished 2.8k ahead in gold")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Continue" })).toHaveFocus();
  });

  it("names the winner when the manager was not playing", async () => {
    mount();
    expect(await screen.findByRole("heading", { name: "Tides wins" })).toBeInTheDocument();
  });

  it("makes the screen behind the result inert and disables the controls", async () => {
    mount();
    await screen.findByTestId("end-panel");
    expect(document.querySelector(".live-scroll")).toHaveAttribute("inert");
    expect(screen.getByRole("button", { name: "Pause" })).toBeDisabled();
  });

  it("does not rebuild the simulation when the finished snapshot is fed back as a prop", async () => {
    const onFullTime = vi.fn<Props["onFullTime"]>();
    function Parent() {
      const [current, setCurrent] = useState(snapshot);
      return <LiveMatchV2 gameState={null} snapshot={current} onSnapshotUpdate={setCurrent} onImportantEvent={() => undefined} onFullTime={onFullTime} />;
    }
    render(<Parent />);
    await screen.findByTestId("end-panel");
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(engine.built).toBe(1);
    expect(engine.disposes).toBe(0);
  });
});

describe("skipping", () => {
  it("plays the rest of the match on the engine, shows the same result, and hands it on as a live match", async () => {
    let finish: (value: unknown) => void = () => undefined;
    engine.skipImpl = () => new Promise((resolve) => (finish = resolve));
    const { onFullTime, onSnapshotUpdate } = mount();
    await screen.findByTestId("champion-b-TOP");

    await skipFromTheMenu();
    expect(await screen.findByText("Clearing battlefield...")).toBeInTheDocument();
    expect(document.querySelector(".live-scroll")).toHaveAttribute("inert");

    await act(async () => finish({ sessionId: "s", state: finishedState() }));
    const panel = await screen.findByTestId("end-panel");
    expect(onSnapshotUpdate).toHaveBeenCalledTimes(1);
    expect(onFullTime).not.toHaveBeenCalled();

    fireEvent.click(within(panel).getByRole("button", { name: "Continue" }));
    expect(onFullTime).toHaveBeenCalledTimes(1);
    expect(onFullTime.mock.calls[0][1]).toEqual({ source: "live" });
    expect(onFullTime.mock.calls[0][0]).toMatchObject({ winner: "red" });
  });

  it("says so, and the match keeps running, when the engine cannot play it out", async () => {
    engine.skipImpl = () => Promise.reject(new Error("engine gone"));
    const { onFullTime } = mount();
    await screen.findByTestId("champion-b-TOP");

    await skipFromTheMenu();
    expect(await screen.findByText("The rest of the match could not be played at once. It keeps running.")).toBeInTheDocument();
    expect(screen.queryByTestId("end-panel")).toBeNull();
    expect(onFullTime).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Pause" })).toBeEnabled();
  });

  it("starts a new match from the options menu", async () => {
    mount();
    await screen.findByTestId("champion-b-TOP");
    await openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Reset match" }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getAllByRole("button").find((button) => /start again/i.test(button.textContent ?? ""));
    fireEvent.click(confirm as HTMLElement);
    await waitFor(() => expect(engine.resets).toBe(1));
  });
});

describe("in Spanish", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("es");
  });

  it("shows no raw key anywhere on the screen or on the result", async () => {
    engine.initState = finishedState();
    mount();
    await screen.findByTestId("end-panel");
    expect(document.body.textContent ?? "").not.toMatch(/onAir\.match\./);
    expect(document.body.textContent ?? "").not.toMatch(/\bmatch\.[a-z]+[A-Z]?\w*\./);
    expect(screen.getByRole("dialog", { name: "Resultado de la partida" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuar" })).toBeInTheDocument();
    expect(screen.getByText("Gana Tides")).toBeInTheDocument();
  });

  it("labels the two card sections in Spanish", async () => {
    engine.initState = matchState();
    mount();
    expect(await screen.findByRole("region", { name: "Jugadores de Embers Esports" })).toBeInTheDocument();
  });
});

afterEach(async () => {
  await i18n.changeLanguage("en");
});

// Restored so other files in the worker see the untouched prototype.
afterAll(() => {
  if (clientWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", clientWidth);
});
