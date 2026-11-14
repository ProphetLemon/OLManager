import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MatchSnapshot } from "@/ui-v2/_legacy/components/match/types";

import { createFakeScheduler, type FakeScheduler } from "./frameScheduler.testing";
import { useLiveSession, type LiveFrame, type UseLiveSessionOptions } from "./useLiveSession";

type Answer = Record<string, unknown>;

const backend = vi.hoisted(() => ({
  /** What every tick answers, unless `tickImpl` takes over. */
  current: {} as Answer,
  resetState: {} as Answer,
  skipState: {} as Answer,
  inits: 0,
  disposes: 0,
  resets: 0,
  skips: 0,
  ticks: [] as Array<{ dtSec: number; running: boolean; speed: number }>,
  initImpl: null as null | (() => Promise<unknown>),
  tickImpl: null as null | ((request: { dtSec: number }, n: number) => Promise<unknown>),
  skipImpl: null as null | (() => Promise<unknown>),
  built: 0,
  simTicks: 0,
  simResets: 0,
}));

vi.mock("@/ui-v2/_legacy/components/match/lol-prototype/assets/map", () => ({ getWalls: () => [] }));
vi.mock("@/ui-v2/_legacy/components/match/lol-prototype/engine/navigation", () => ({ NavGrid: class {} }));
vi.mock("@/ui-v2/_legacy/components/match/lol-prototype/engine/simulation", () => ({
  PrototypeSimulation: class {
    state = { winner: null, timeSec: 0, events: [], champions: [], stats: undefined };
    constructor() {
      backend.built += 1;
    }
    setRunning() {}
    tick() {
      backend.simTicks += 1;
    }
    reset() {
      backend.simResets += 1;
    }
  },
}));
vi.mock("@/ui-v2/_legacy/components/match/lol-prototype/backend/tauri-client", () => ({
  LolSimV2Client: class {
    init() {
      backend.inits += 1;
      return backend.initImpl ? backend.initImpl() : Promise.resolve({ sessionId: "s", state: backend.current });
    }
    tick(request: { dtSec: number; running: boolean; speed: number }) {
      backend.ticks.push(request);
      const n = backend.ticks.length;
      return backend.tickImpl ? backend.tickImpl(request, n) : Promise.resolve({ sessionId: "s", state: backend.current });
    }
    reset() {
      backend.resets += 1;
      return Promise.resolve({ sessionId: "s", state: backend.resetState });
    }
    skipToEnd() {
      backend.skips += 1;
      return backend.skipImpl ? backend.skipImpl() : Promise.resolve({ sessionId: "s", state: backend.skipState });
    }
    dispose() {
      backend.disposes += 1;
      return Promise.resolve({ sessionId: "s", disposed: true });
    }
  },
}));

const team = (id: string) => ({ id, name: id, players: [] });
const snapshot = {
  phase: "Live",
  current_minute: 0,
  home_score: 0,
  away_score: 0,
  home_team: team("home"),
  away_team: team("away"),
  events: [],
} as unknown as MatchSnapshot;

interface AnswerOptions {
  x?: number;
  y?: number;
  speed?: number;
  winner?: "blue" | "red" | null;
  kills?: number;
  events?: Array<{ t: number; text: string; type: string; code?: string; data?: Record<string, string> }>;
  gold?: number;
  /** Gold earned by the one champion (purse plus spent). */
  playerGold?: number;
}

const answerAt = (timeSec: number, o: AnswerOptions = {}): Answer => ({
  timeSec,
  running: true,
  winner: o.winner ?? null,
  showWalls: false,
  speed: o.speed ?? 4,
  stepSec: 0.6,
  stepAccumSec: 0,
  champions: [{ id: "c1", name: "c1", team: "blue", pos: { x: o.x ?? 0.5, y: o.y ?? 0.5 }, alive: true, hp: 100, maxHp: 100, moveSpeed: 0.05, gold: o.playerGold ?? 0, spentGold: 0 }],
  minions: [],
  structures: [],
  objectives: {},
  neutralTimers: { entities: {} },
  stats: {
    blue: { kills: o.kills ?? 0, towers: 0, dragons: 0, barons: 0, gold: o.gold ?? 0 },
    red: { kills: 0, towers: 0, dragons: 0, barons: 0, gold: 0 },
  },
  events: o.events ?? [],
});

const last = <T,>(items: readonly T[]): T | undefined => items[items.length - 1];

const flush = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

interface Mounted {
  scheduler: FakeScheduler;
  renders: () => number;
  frames: (n: number, ms?: number) => Promise<void>;
  result: { current: ReturnType<typeof useLiveSession> };
  rerender: (props?: Partial<UseLiveSessionOptions>) => void;
  unmount: () => void;
  seen: LiveFrame[];
}

async function mount(extra: Partial<UseLiveSessionOptions> = {}): Promise<Mounted> {
  const scheduler = createFakeScheduler();
  let renderCount = 0;
  const base: UseLiveSessionOptions = {
    snapshot,
    startToken: 0,
    profilesReady: true,
    championByPlayerId: {},
    championProfilesById: {},
    championUltimatesById: {},
    scheduler,
    ...extra,
  };
  const hook = renderHook(
    (props: UseLiveSessionOptions) => {
      renderCount += 1;
      return useLiveSession(props);
    },
    { initialProps: base },
  );
  await act(async () => flush());
  const seen: LiveFrame[] = [];
  hook.result.current.bus.subscribe((frame) => seen.push(frame));
  return {
    scheduler,
    renders: () => renderCount,
    seen,
    result: hook.result,
    rerender: (props = {}) => hook.rerender({ ...base, ...props }),
    unmount: hook.unmount,
    frames: async (n, ms = 1000 / 60) => {
      for (let i = 0; i < n; i += 1) {
        await act(async () => {
          scheduler.frame(ms);
          await flush();
        });
      }
    },
  };
}

beforeEach(() => {
  Object.assign(backend, {
    current: answerAt(0),
    resetState: answerAt(0),
    skipState: answerAt(1500, { winner: "blue" }),
    inits: 0,
    disposes: 0,
    resets: 0,
    skips: 0,
    ticks: [],
    initImpl: null,
    tickImpl: null,
    skipImpl: null,
    built: 0,
    simTicks: 0,
    simResets: 0,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useLiveSession: session lifetime", () => {
  it("builds the simulation once, from the local kits, without any network request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const m = await mount();
    await m.frames(5);

    expect(backend.built).toBe(1);
    expect(backend.inits).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("waits for the profiles: nothing is built while they are not ready", async () => {
    const m = await mount({ profilesReady: false });
    await m.frames(3);
    expect(backend.built).toBe(0);
    expect(backend.inits).toBe(0);

    m.rerender({ profilesReady: true });
    await act(async () => flush());
    expect(backend.built).toBe(1);
  });

  it("does not restart when the finished snapshot is fed back as a prop", async () => {
    backend.current = answerAt(1500, { winner: "blue" });
    const m = await mount();
    await m.frames(3);
    expect(m.result.current.view.winner).toBe("blue");

    const finished = { ...snapshot, phase: "Finished", home_score: 1, events: [{ minute: 25 }] } as unknown as MatchSnapshot;
    m.rerender({ snapshot: finished });
    await m.frames(3);

    expect(backend.built).toBe(1);
    expect(backend.inits).toBe(1);
    expect(backend.disposes).toBe(0);
  });

  it("draws the winner once and ends the frame loop", async () => {
    backend.current = answerAt(1500, { winner: "blue" });
    const m = await mount();
    await m.frames(1);

    expect(last(m.seen)?.state.winner).toBe("blue");
    expect(m.scheduler.pending()).toBe(0);
    expect(m.result.current.bus.isRunning()).toBe(false);
  });

  it("runs the frame loop again after a reset that follows a finished match", async () => {
    backend.current = answerAt(1500, { winner: "blue" });
    const m = await mount();
    await m.frames(1);
    backend.resetState = answerAt(0);
    backend.current = answerAt(0);
    await act(async () => {
      m.result.current.reset();
      await flush();
    });

    expect(m.scheduler.pending()).toBe(1);
    await m.frames(2);
    expect(m.result.current.view.winner).toBeNull();
  });

  it("starts a new session, and disposes the old one, for a new start token", async () => {
    const m = await mount();
    await m.frames(2);
    m.rerender({ startToken: 1 });
    await act(async () => flush());

    expect(backend.built).toBe(2);
    expect(backend.inits).toBe(2);
    expect(backend.disposes).toBe(1);
  });

  it("disposes the session and stops the frame loop on unmount", async () => {
    const m = await mount();
    await m.frames(3);
    m.unmount();

    expect(backend.disposes).toBe(1);
    expect(m.scheduler.pending()).toBe(0);
    const ticks = backend.ticks.length;
    m.scheduler.frame();
    expect(backend.ticks.length).toBe(ticks);
  });

  it("falls back to the local simulation when the backend cannot start", async () => {
    backend.initImpl = () => Promise.reject(new Error("no backend"));
    const m = await mount();
    await m.frames(4);

    expect(backend.simTicks).toBeGreaterThan(0);
    expect(backend.ticks).toHaveLength(0);
    expect(m.seen.length).toBeGreaterThan(0);
  });
});

describe("useLiveSession: the frame path", () => {
  it("slides a unit from the previous step to the new one instead of jumping", async () => {
    const m = await mount();
    await m.frames(2);
    backend.current = answerAt(0.6, { x: 0.53 });
    await m.frames(14);

    const xs = m.seen.map((f) => f.state.champions[0].pos.x);
    expect(xs.some((x) => x > 0.5 && x < 0.53)).toBe(true);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0.5);
    expect(Math.max(...xs)).toBeLessThanOrEqual(0.53);
    expect(last(xs)).toBe(0.53);
  });

  it("draws a unit that teleported where it is, without sliding across the map", async () => {
    const m = await mount();
    await m.frames(2);
    backend.current = answerAt(0.6, { x: 0.53 });
    await m.frames(14);
    const before = m.seen.length;
    backend.current = answerAt(1.2, { x: 0.1, y: 0.9 });
    await m.frames(6);

    const after = m.seen.slice(before + 1).map((f) => f.state.champions[0].pos);
    expect(after.length).toBeGreaterThan(2);
    expect(after.every((pos) => pos.x === 0.1 && pos.y === 0.9)).toBe(true);
  });

  it("reports the running flag of the session, not the one of the last answer", async () => {
    const m = await mount();
    await m.frames(2);
    act(() => m.result.current.setRunning(false));
    await m.frames(2);
    expect(last(m.seen)?.running).toBe(false);
  });
});

describe("useLiveSession: the commit path", () => {
  it("commits at most 4 times per second of real time at x12 while the subscribers run on every frame", async () => {
    let n = 0;
    backend.tickImpl = () => {
      n += 1;
      return Promise.resolve({ sessionId: "s", state: answerAt(n * 0.8, { speed: 48, x: 0.5 + n * 0.001 }) });
    };
    const m = await mount({ initialSpeed: 48 });
    await m.frames(1);
    const baseline = m.renders();
    const seenBefore = m.seen.length;

    await m.frames(60);

    const commits = m.renders() - baseline;
    expect(m.seen.length - seenBefore).toBe(60);
    expect(commits).toBeGreaterThanOrEqual(2);
    expect(commits).toBeLessThanOrEqual(4);
  });

  it("does not commit for movement alone inside the interval", async () => {
    const m = await mount();
    await m.frames(2);
    const baseline = m.renders();
    backend.current = answerAt(0.6, { x: 0.52 });
    await m.frames(5);
    expect(m.renders()).toBe(baseline);
  });

  const immediate: Array<[string, () => Answer]> = [
    ["a new event", () => answerAt(0.6, { events: [{ t: 0.6, text: "Blue destroyed an outer turret", type: "tower" }] })],
    ["a kill", () => answerAt(0.6, { kills: 1 })],
    ["the winner", () => answerAt(0.6, { winner: "red" })],
  ];
  it.each(immediate)("commits %s at once, inside the interval", async (_name, make) => {
    const m = await mount();
    await m.frames(2);
    const baseline = m.renders();
    backend.current = make();
    await m.frames(2);

    expect(m.renders()).toBeGreaterThan(baseline);
    expect(m.result.current.view.state?.timeSec).toBe(0.6);
  });

  it("commits pause and resume at once", async () => {
    const m = await mount();
    await m.frames(2);
    const baseline = m.renders();
    act(() => m.result.current.setRunning(false));
    expect(m.renders()).toBeGreaterThan(baseline);
    expect(m.result.current.view.running).toBe(false);
    act(() => m.result.current.setRunning(true));
    expect(m.result.current.view.running).toBe(true);
  });

  it("commits the speed change at once", async () => {
    const m = await mount();
    await m.frames(2);
    act(() => m.result.current.setSpeed(32));
    expect(m.result.current.view.speed).toBe(32);
    await m.frames(2);
    expect(last(backend.ticks)?.speed).toBe(32);
  });

  it("keeps the gold difference per minute for the final report", async () => {
    const m = await mount();
    await m.frames(2);
    backend.current = answerAt(61, { gold: 500 });
    await m.frames(2);
    backend.current = answerAt(70, { gold: 900, kills: 1 });
    await m.frames(2);

    expect(m.result.current.view.goldDiffTimeline).toEqual([
      { minute: 0, diff: 0 },
      { minute: 1, diff: 900 },
    ]);
  });
});

describe("useLiveSession: the record of the match", () => {
  it("writes down each champion's gold per minute beside the team difference", async () => {
    const m = await mount();
    await m.frames(2);
    backend.current = answerAt(61, { gold: 500, playerGold: 650 });
    await m.frames(2);
    backend.current = answerAt(125, { gold: 900, playerGold: 1300 });
    await m.frames(2);

    const { gold, skippedAtSec } = m.result.current.record();
    expect(gold.map((s) => [s.minute, s.diff, s.players.c1])).toEqual([
      [0, 0, 0],
      [1, 500, 650],
      [2, 900, 1300],
    ]);
    expect(skippedAtSec).toBeNull();
  });

  it("keeps the key events the engine drops from its rolling list", async () => {
    const m = await mount();
    await m.frames(2);
    const kill = { t: 140, text: "BLUE Paduck killed Supa", type: "kill", code: "champion_killed", data: { team: "blue" } };
    backend.current = answerAt(141, { events: [kill] });
    await m.frames(2);
    backend.current = answerAt(900, { events: [{ t: 890, text: "BLUE tower", type: "tower", code: "structure_destroyed", data: { team: "blue" } }] });
    await m.frames(2);

    expect(m.result.current.record().events.map((e) => e.t)).toEqual([140, 890]);
  });

  it("marks the record as skipped from the second the skip started, and keeps what was watched", async () => {
    backend.current = answerAt(130, { gold: 100 });
    const m = await mount();
    await m.frames(4);
    await act(async () => {
      await m.result.current.skip();
    });

    const record = m.result.current.record();
    expect(record.skippedAtSec).toBe(130);
    expect(record.gold.map((s) => s.minute)).toEqual([2, 25]);
  });

  it("is not marked as skipped when the skip failed and the match went on", async () => {
    backend.skipImpl = () => Promise.reject(new Error("engine"));
    const m = await mount();
    await m.frames(2);
    await act(async () => {
      await m.result.current.skip();
    });
    expect(m.result.current.record().skippedAtSec).toBeNull();
  });

  it("starts a new record when the backend fails and the local simulation takes over from minute 0", async () => {
    backend.current = answerAt(130, { gold: 400, events: [{ t: 120, text: "BLUE tower", type: "tower", code: "structure_destroyed", data: { team: "blue" } }] });
    const m = await mount();
    await m.frames(3);
    expect(m.result.current.record().gold.map((s) => s.minute)).toEqual([2]);

    backend.tickImpl = () => Promise.reject(new Error("backend gone"));
    await m.frames(6);

    // The screen now shows a match that starts again at 0:00: the old minutes would sit after the new ones.
    const record = m.result.current.record();
    expect(record.gold.map((s) => s.minute)).toEqual([0]);
    expect(record.events).toEqual([]);
    expect(record.skippedAtSec).toBeNull();
  });

  it("starts a new record with a new match", async () => {
    const m = await mount();
    await m.frames(2);
    backend.current = answerAt(90, { gold: 300 });
    await m.frames(2);
    backend.resetState = answerAt(0);
    backend.current = answerAt(0);
    await act(async () => {
      m.result.current.reset();
      await flush();
    });
    await m.frames(2);

    expect(m.result.current.record().gold.map((s) => s.minute)).toEqual([0]);
    expect(m.result.current.record().events).toEqual([]);
  });
});

describe("useLiveSession: ticks", () => {
  it("sends one tick at a time, and keeps the time it could not send, up to 0.5 s", async () => {
    let release: (() => void) | undefined;
    backend.tickImpl = () => new Promise((resolve) => (release = () => resolve({ sessionId: "s", state: backend.current })));
    const m = await mount();
    for (let i = 0; i < 40; i += 1) {
      await act(async () => {
        m.scheduler.frame();
        await Promise.resolve();
      });
    }
    expect(backend.ticks).toHaveLength(1);

    backend.tickImpl = null;
    await act(async () => {
      release?.();
      await flush();
    });
    await m.frames(1);
    expect(backend.ticks).toHaveLength(2);
    expect(backend.ticks[1].dtSec).toBeCloseTo(0.5, 5);
  });

  it("adds at most 0.25 s of real time per frame", async () => {
    const m = await mount();
    await m.frames(1);
    await m.frames(1, 1000);
    expect(last(backend.ticks)?.dtSec).toBeCloseTo(0.25, 5);
  });

  it("stops sending ticks while paused, and sends them again on resume", async () => {
    const m = await mount();
    await m.frames(3);
    act(() => m.result.current.setRunning(false));
    await m.frames(1);
    const paused = backend.ticks.length;
    await m.frames(10);
    expect(backend.ticks.length).toBe(paused);

    act(() => m.result.current.setRunning(true));
    await m.frames(2);
    expect(backend.ticks.length).toBeGreaterThan(paused);
  });

  it("stops sending ticks once there is a winner", async () => {
    backend.current = answerAt(1500, { winner: "blue" });
    const m = await mount();
    await m.frames(2);
    const sent = backend.ticks.length;
    await m.frames(6);
    expect(backend.ticks.length).toBe(sent);
  });
});

describe("useLiveSession: reset", () => {
  it("goes back in time and clears the view without a jump", async () => {
    const m = await mount();
    await m.frames(2);
    backend.current = answerAt(60, { x: 0.9, gold: 700 });
    await m.frames(16);
    expect(m.result.current.view.state?.timeSec).toBe(60);

    backend.resetState = answerAt(0, { x: 0.5 });
    backend.current = answerAt(0, { x: 0.5 });
    const before = m.seen.length;
    await act(async () => {
      m.result.current.reset();
      await flush();
    });
    await m.frames(4);

    expect(backend.resets).toBe(1);
    expect(backend.simResets).toBe(1);
    expect(m.result.current.view.state?.timeSec).toBe(0);
    expect(m.result.current.view.goldDiffTimeline).toEqual([{ minute: 0, diff: 0 }]);
    const xs = m.seen.slice(before + 1).map((f) => f.state.champions[0].pos.x);
    expect(xs.length).toBeGreaterThan(0);
    expect(xs.every((x) => x === 0.5)).toBe(true);
  });

  it("drops an answer of the old match that arrives after the reset", async () => {
    let releaseOld: (() => void) | undefined;
    backend.tickImpl = (_request, n) =>
      n === 1
        ? new Promise((resolve) => (releaseOld = () => resolve({ sessionId: "s", state: answerAt(100, { x: 0.9, kills: 1 }) })))
        : Promise.resolve({ sessionId: "s", state: answerAt(0) });
    const m = await mount();
    await m.frames(2);
    backend.resetState = answerAt(0);
    await act(async () => {
      m.result.current.reset();
      await flush();
    });

    await act(async () => {
      releaseOld?.();
      await flush();
    });

    // Checked before the next tick can put right what a stale answer would break.
    expect(m.result.current.view.state?.timeSec).toBeLessThan(100);
    await m.frames(1);
    expect(last(m.seen)?.state.timeSec).toBeLessThan(100);
  });

  it("starts running again after a reset", async () => {
    const m = await mount();
    await m.frames(2);
    act(() => m.result.current.setRunning(false));
    await act(async () => {
      m.result.current.reset();
      await flush();
    });
    expect(m.result.current.view.running).toBe(true);
  });
});

describe("useLiveSession: skip", () => {
  it("plays the match to its end on the same session and commits the winner", async () => {
    const m = await mount();
    await m.frames(2);
    let final: unknown;
    await act(async () => {
      final = await m.result.current.skip();
    });

    expect(backend.skips).toBe(1);
    expect(final).toMatchObject({ winner: "blue", timeSec: 1500 });
    expect(m.result.current.view.winner).toBe("blue");
    expect(m.result.current.view.skipping).toBe(false);
    const sent = backend.ticks.length;
    await m.frames(4);
    expect(backend.ticks.length).toBe(sent);
  });

  it("stops the ticks while it runs, and resumes the match when it fails", async () => {
    let fail: (() => void) | undefined;
    backend.skipImpl = () => new Promise((_resolve, reject) => (fail = () => reject(new Error("engine"))));
    const m = await mount();
    await m.frames(2);

    let outcome: unknown = "pending";
    act(() => {
      void m.result.current.skip().then((value) => (outcome = value));
    });
    expect(m.result.current.view.skipping).toBe(true);
    expect(m.result.current.view.running).toBe(false);
    const sent = backend.ticks.length;
    await m.frames(4);
    expect(backend.ticks.length).toBe(sent);

    await act(async () => {
      fail?.();
      await flush();
    });
    expect(outcome).toBeNull();
    expect(m.result.current.view.skipping).toBe(false);
    expect(m.result.current.view.running).toBe(true);
  });
});
