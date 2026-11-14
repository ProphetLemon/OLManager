import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ComponentProps } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import type { MatchSnapshot } from "@/ui-v2/_legacy/components/match/types";

import { LANES } from "@/lib/match/live/mapGeometry";

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

// The real button reads the game store and opens a report dialog; here it only has to be in the right place.
vi.mock("@/ui-v2/_legacy/components/dashboard/FloatingBugButton", () => ({
  default: () => <button type="button" data-testid="bug-button" />,
}));

// The map measures itself, and layers mount only once it has a size.
const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
const clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
beforeAll(() => {
  // The map's cell is 540 by 540, so the map is a square of 540.
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 540 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 540 });
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
    expect(screen.getByTestId("away-board")).toBeInTheDocument();
    expect(screen.getByTestId("lane-strip")).toBeInTheDocument();
    expect(screen.getByTestId("timer-rail")).toBeInTheDocument();
    expect(screen.getByTestId("match-controls")).toBeInTheDocument();
    expect(screen.getByTestId("map-legend")).toBeInTheDocument();
  });

  it("publishes the two clubs' colours once, as an inline style on the screen root", async () => {
    const teams = [
      { id: "home", name: "Embers Esports", short_name: "EMB", logo_url: "/teams-icons/embers.webp", colors: { primary: "#e11d2e", secondary: "#f5f5f5" } },
      { id: "away", name: "Tides", short_name: "TDE", logo_url: null, colors: { primary: "#16a34a", secondary: "#101010" } },
    ];
    mount({ gameState: { teams, manager: { team_id: "home" } } as unknown as Props["gameState"] });
    await screen.findByTestId("champion-b-TOP");
    const root = screen.getByTestId("live-match");
    for (const side of ["blue", "red"]) {
      for (const suffix of ["", "-text", "-fg", "-band", "-band-fg", "-wash-text"]) {
        expect(root.style.getPropertyValue(`--side-${side}${suffix}`), `--side-${side}${suffix}`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
    // The bar wears each club's own logo.
    expect(screen.getByTestId("score-bar").querySelector("img[src='/teams-icons/embers.webp']")).not.toBeNull();
  });

  it("still publishes the tokens, from the generic palette, when the game has no team list", async () => {
    mount();
    await screen.findByTestId("champion-b-TOP");
    expect(screen.getByTestId("live-match").style.getPropertyValue("--side-blue")).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("hosts the bug button in the controls row, in the flow and not floating", async () => {
    mount();
    await screen.findByTestId("champion-b-TOP");
    const button = screen.getByTestId("bug-button");
    const row = button.parentElement as HTMLElement;
    expect(row).toHaveClass("live-area-ctl");
    expect(row).toContainElement(screen.getByTestId("match-controls"));
    expect(row).toContainElement(screen.getByTestId("map-legend"));
  });

  it("points the map at both strips of the Fight board, which are in the page", async () => {
    mount();
    const map = await screen.findByTestId("arena-map");
    expect(map.getAttribute("aria-describedby")).toBe("arena-fight-board arena-away-board");
    expect(document.getElementById("arena-fight-board")).toBe(screen.getByTestId("fight-board"));
    expect(document.getElementById("arena-away-board")).toBe(screen.getByTestId("away-board"));
  });

  it("keeps the Fight board on show, outside any popover, and beside the lanes above the map", async () => {
    mount();
    await screen.findByTestId("champion-b-TOP");
    const board = screen.getByTestId("fight-board");
    expect(board.closest("details")).toBeNull();
    expect(board.parentElement).toHaveClass("live-area-fight");
    expect(screen.getByTestId("away-board").parentElement).toHaveClass("live-area-away");
    expect(screen.getByTestId("lane-strip").parentElement).toHaveClass("live-area-lanes");
    // The two fighting top laners are on the fights strip, in words.
    expect(within(board).getByText(/Blue TOP \(Blue\)/)).toBeInTheDocument();
  });

  it("draws each club's band over its column, and the timers under the blue cards and the feed under the red ones", async () => {
    const { container } = mount();
    await screen.findByTestId("champion-b-TOP");
    const bands = [...container.querySelectorAll<HTMLElement>(".live-band")];
    expect(bands.map((band) => [band.dataset.team, band.textContent])).toEqual([
      ["blue", "Embers Esports"],
      ["red", "Tides"],
    ]);
    // The band is decoration: the column is a labelled section already.
    expect(bands.every((band) => band.getAttribute("aria-hidden") === "true")).toBe(true);
    expect(screen.getByTestId("timer-rail").parentElement).toHaveClass("live-area-rail");
    const dock = screen.getByTestId("event-ticker").parentElement as HTMLElement;
    expect(dock).toHaveClass("live-area-dock");
    expect(dock).toContainElement(screen.getByTestId("spotlight-caption"));
  });

  it("reads the lane strip from the minions of the engine's answer", async () => {
    const along = (index: number) => ({ x: LANES.mid[index].x / 1000, y: LANES.mid[index].y / 1000 });
    const minion = (id: string, team: "blue" | "red", index: number) => ({
      id,
      team,
      lane: "mid",
      pos: along(index),
      hp: 400,
      maxHp: 400,
      alive: true,
      kind: "melee",
    });
    engine.initState = matchState({ minions: [minion("m1", "blue", 6), minion("m2", "red", 7)] } as Partial<Answer>);
    mount();
    await screen.findByTestId("champion-b-TOP");
    expect(screen.getByRole("img", { name: /^Mid lane:/ })).toHaveAccessibleName("Mid lane: Embers Esports is pushing toward the Red base.");
    expect(screen.getByRole("img", { name: /^Top lane:/ })).toHaveAccessibleName("Top lane: no wave on the lane.");
  });

  it("shows the objective timers from the first answer, with the dragon counting down", async () => {
    mount();
    await screen.findByTestId("champion-b-TOP");
    const rail = screen.getByTestId("timer-rail");
    expect([...rail.children].map((tile) => tile.getAttribute("data-timer"))).toEqual(["dragon", "voidgrubs", "herald", "baron"]);
  });

  it("keeps Match options and Map key in the controls row, as named buttons that can become icons", async () => {
    mount();
    await screen.findByTestId("champion-b-TOP");
    const row = screen.getByTestId("bug-button").parentElement as HTMLElement;
    expect(within(row).getByRole("button", { name: "Match options" })).toHaveAttribute("title", "Match options");
    expect(within(row).getByText("Map key", { selector: "summary .arena-btn-label" })).toBeInTheDocument();
    // The Fight board is no longer a control of the row.
    expect(row.querySelector("[data-testid='fight-board']")).toBeNull();
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

  it("hands the record of the match on with it: gold per champion per minute, and no skip", async () => {
    const { onFullTime } = mount();
    await screen.findByRole("dialog", { name: "Match result" });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    const record = onFullTime.mock.calls[0][0].matchRecord;
    expect(record?.skippedAtSec).toBeNull();
    expect(record?.gold.length).toBeGreaterThan(0);
    expect(record?.gold[record.gold.length - 1].timeSec).toBe(1923);
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
    let asked = false;
    engine.skipImpl = () =>
      new Promise((resolve) => {
        finish = resolve;
        asked = true;
      });
    const { onFullTime, onSnapshotUpdate } = mount();
    await screen.findByTestId("champion-b-TOP");

    await skipFromTheMenu();
    expect(await screen.findByText("Calculating the result…")).toBeInTheDocument();
    expect(document.querySelector(".live-scroll")).toHaveAttribute("inert");

    await waitFor(() => expect(asked).toBe(true));
    await act(async () => finish({ sessionId: "s", state: finishedState() }));
    const panel = await screen.findByTestId("end-panel");
    expect(onSnapshotUpdate).toHaveBeenCalledTimes(1);
    expect(onFullTime).not.toHaveBeenCalled();

    fireEvent.click(within(panel).getByRole("button", { name: "Continue" }));
    expect(onFullTime).toHaveBeenCalledTimes(1);
    expect(onFullTime.mock.calls[0][1]).toEqual({ source: "live" });
    expect(onFullTime.mock.calls[0][0]).toMatchObject({ winner: "red" });
    // A skip leaves no minutes behind it: the record says where it began, so the screen can say it is partial.
    expect(typeof onFullTime.mock.calls[0][0].matchRecord?.skippedAtSec).toBe("number");
  });

  it("says so, and the match keeps running, when the engine cannot play it out", async () => {
    engine.skipImpl = () => Promise.reject(new Error("engine gone"));
    const { onFullTime } = mount();
    await screen.findByTestId("champion-b-TOP");

    await skipFromTheMenu();
    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent("The rest of the match could not be played at once. It keeps running.");
    expect(within(notice).getByRole("button", { name: "Try again" })).toBeEnabled();
    expect(screen.queryByTestId("end-panel")).toBeNull();
    expect(onFullTime).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Pause" })).toBeEnabled();
    expect(screen.getByTestId("live-match")).not.toHaveAttribute("aria-busy");
  });

  it("tries again from the notice, and the notice goes once the result is in", async () => {
    engine.skipImpl = () => Promise.reject(new Error("engine gone"));
    mount();
    await screen.findByTestId("champion-b-TOP");
    await skipFromTheMenu();
    const retry = within(await screen.findByRole("alert")).getByRole("button", { name: "Try again" });

    engine.skipImpl = () => Promise.resolve({ sessionId: "s", state: finishedState() });
    fireEvent.click(retry);
    expect(await screen.findByTestId("end-panel")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  describe("while the rest of the match is being calculated", () => {
    it("says so politely, marks the area busy and switches off every control that would race it", async () => {
      let finish: (value: unknown) => void = () => undefined;
      let asked = false;
      engine.skipImpl = () =>
        new Promise((resolve) => {
          finish = resolve;
          asked = true;
        });
      mount();
      await screen.findByTestId("champion-b-TOP");
      await skipFromTheMenu();

      const status = (await screen.findByText("Calculating the result…")).closest("[role='status']");
      expect(status).not.toBeNull();
      expect(screen.getByTestId("live-match")).toHaveAttribute("aria-busy", "true");
      expect(screen.getByRole("button", { name: "Pause", hidden: true })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Match options", hidden: true })).toBeDisabled();
      for (const radio of screen.getAllByRole("radio", { hidden: true })) expect(radio).toBeDisabled();

      await waitFor(() => expect(asked).toBe(true));
      await act(async () => finish({ sessionId: "s", state: finishedState() }));
    });

    it("clears the busy state when the result arrives", async () => {
      let finish: (value: unknown) => void = () => undefined;
      let asked = false;
      engine.skipImpl = () =>
        new Promise((resolve) => {
          finish = resolve;
          asked = true;
        });
      mount();
      await screen.findByTestId("champion-b-TOP");
      await skipFromTheMenu();
      await screen.findByText("Calculating the result…");
      await waitFor(() => expect(asked).toBe(true));

      await act(async () => finish({ sessionId: "s", state: finishedState() }));
      expect(await screen.findByTestId("end-panel")).toBeInTheDocument();
      expect(screen.queryByText("Calculating the result…")).toBeNull();
      expect(screen.getByTestId("live-match")).not.toHaveAttribute("aria-busy");
    });

    it("is on the screen before the engine is asked, so a call that holds the window cannot hide it", async () => {
      let busyWhenAsked: string | null = null;
      engine.skipImpl = () => {
        busyWhenAsked = screen.getByTestId("live-match").getAttribute("aria-busy");
        return Promise.resolve({ sessionId: "s", state: finishedState() });
      };
      mount();
      await screen.findByTestId("champion-b-TOP");
      await skipFromTheMenu();
      await screen.findByTestId("end-panel");
      expect(busyWhenAsked).toBe("true");
    });
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
    expect(screen.getByRole("heading", { name: "Gana Tides" })).toBeInTheDocument();
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
  if (clientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", clientHeight);
});
