import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LolMatchLive from "@/ui-v2/_legacy/components/match/LolMatchLive";
import type { MatchSnapshot } from "@/ui-v2/_legacy/components/match/types";

const backend = vi.hoisted(() => ({
  /** Answers of the scripted engine, in order; the last one repeats. */
  answers: [] as Array<Record<string, unknown>>,
  ticks: 0,
  /** Champion positions of each frame the map was drawn with. */
  drawn: [] as Array<{ x: number; y: number }>,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/ui-v2/_legacy/components/match/lol-prototype/assets/map", () => ({
  getWalls: () => [],
}));

vi.mock("@/ui-v2/_legacy/components/match/lol-prototype/engine/navigation", () => ({
  NavGrid: class {},
}));

vi.mock("@/ui-v2/_legacy/components/match/lol-prototype/engine/simulation", () => ({
  PrototypeSimulation: class {
    state = { winner: null, timeSec: 0, events: [], champions: [], stats: undefined };
    setRunning() {}
    tick() {}
  },
}));

vi.mock("@/ui-v2/_legacy/components/match/lol-prototype/backend/tauri-client", () => ({
  LolSimV2Client: class {
    init() {
      return Promise.resolve({ sessionId: "s", state: backend.answers[0] });
    }
    tick() {
      backend.ticks += 1;
      const answer = backend.answers[Math.min(backend.ticks, backend.answers.length - 1)];
      return Promise.resolve({ sessionId: "s", state: answer });
    }
    dispose() {
      return Promise.resolve();
    }
  },
}));

vi.mock("@/ui-v2/_legacy/components/match/lol-prototype/ui/render", () => ({
  renderSimulation: (_canvas: unknown, state: { champions: Array<{ pos: { x: number; y: number } }> }) => {
    if (state.champions.length > 0) backend.drawn.push({ ...state.champions[0].pos });
  },
}));

vi.mock("@/ui-v2/_legacy/components/match/lol-prototype/ui/panels", () => ({
  LecLowerThirdPanel: () => null,
}));

const team = (id: string) => ({ id, name: id, players: [] });
const baseSnapshot = {
  phase: "Live",
  current_minute: 0,
  home_score: 0,
  away_score: 0,
  home_team: team("home"),
  away_team: team("away"),
  events: [],
} as unknown as MatchSnapshot;

const answerAt = (timeSec: number, x: number, y: number, alive = true) => ({
  timeSec,
  running: true,
  winner: null,
  showWalls: false,
  speed: 4,
  stepSec: 0.6,
  stepAccumSec: 0,
  champions: [
    {
      id: "c1",
      name: "c1",
      team: "blue",
      pos: { x, y },
      alive,
      hp: 100,
      maxHp: 100,
      moveSpeed: 0.05,
    },
  ],
  minions: [],
  structures: [],
  objectives: {},
  neutralTimers: { entities: {} },
  stats: {
    blue: { kills: 0, towers: 0, dragons: 0, barons: 0, gold: 0 },
    red: { kills: 0, towers: 0, dragons: 0, barons: 0, gold: 0 },
  },
  events: [],
});

const mountLive = () =>
  render(
    <LolMatchLive
      gameState={null}
      snapshot={baseSnapshot}
      onSnapshotUpdate={() => undefined}
      onImportantEvent={() => undefined}
      onFullTime={() => undefined}
    />,
  );

describe("LolMatchLive movement between steps", () => {
  beforeEach(() => {
    backend.ticks = 0;
    backend.drawn = [];
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
  });

  it("slides a champion from the previous step to the new one instead of jumping", async () => {
    // At the default speed of 4 a step of 0.6 s lasts 150 ms.
    backend.answers = [answerAt(0, 0.5, 0.5), answerAt(0.6, 0.53, 0.5)];
    mountLive();

    await waitFor(() => expect(backend.drawn.some((pos) => pos.x === 0.53)).toBe(true), { timeout: 3000 });
    const between = backend.drawn.filter((pos) => pos.x > 0.5 && pos.x < 0.53);
    expect(between.length).toBeGreaterThan(0);
    const xs = backend.drawn.map((pos) => pos.x);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0.5);
    expect(Math.max(...xs)).toBeLessThanOrEqual(0.53);
  });

  it("draws a champion that teleported where it is, without sliding across the map", async () => {
    backend.answers = [answerAt(0, 0.5, 0.5), answerAt(0.6, 0.53, 0.5), answerAt(1.2, 0.1, 0.9)];
    mountLive();

    await waitFor(() => expect(backend.drawn.some((pos) => pos.x === 0.1)).toBe(true), { timeout: 3000 });
    const firstAtBase = backend.drawn.findIndex((pos) => pos.x === 0.1);
    const afterJump = backend.drawn.slice(firstAtBase);
    expect(afterJump.every((pos) => pos.x === 0.1 && pos.y === 0.9)).toBe(true);
    const beforeJump = backend.drawn.slice(0, firstAtBase);
    expect(beforeJump.every((pos) => pos.x <= 0.53 && pos.y === 0.5)).toBe(true);
  });
});
