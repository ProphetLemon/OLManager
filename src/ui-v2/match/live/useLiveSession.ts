import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getWalls } from "@/ui-v2/_legacy/components/match/lol-prototype/assets/map";
import type {
  LolChampionUltimateProfile,
  LolSimV1AiMode,
  LolSimV1PolicyConfig,
  LolSimV1RuntimeState,
} from "@/ui-v2/_legacy/components/match/lol-prototype/backend/contract-v1";
import { LolSimV2Client } from "@/ui-v2/_legacy/components/match/lol-prototype/backend/tauri-client";
import { NavGrid } from "@/ui-v2/_legacy/components/match/lol-prototype/engine/navigation";
import { PrototypeSimulation, type ChampionCombatProfile } from "@/ui-v2/_legacy/components/match/lol-prototype/engine/simulation";
import type { MatchState, TeamId } from "@/ui-v2/_legacy/components/match/lol-prototype/engine/types";
import {
  EMPTY_STEP_VIEW,
  nextStepView,
  smoothClockSec,
  stateToDraw,
  type StepView,
} from "@/ui-v2/_legacy/components/match/lol-prototype/ui/stepInterpolation";
import type { MatchSnapshot } from "@/ui-v2/_legacy/components/match/types";
import {
  buildMatchRecord,
  goldSeries,
  newGoldRecord,
  newKeyEventLog,
  recordGold as recordGoldSample,
  recordKeyEvents,
  type GoldRecord,
  type KeyEventLog,
  type MatchRecord,
} from "@/lib/match/live/matchRecord";

import { browserScheduler, createFrameBus, type FrameBus, type FrameScheduler } from "./frameBus";

/** Real time between two React commits of the view, unless something discrete happens. */
export const COMMIT_INTERVAL_MS = 250;
/** Longest slice of real time one frame may add to what the engine is asked to play. */
export const BACKEND_MAX_FRAME_SEC = 0.25;
/** Time the engine may owe the screen while a tick is in flight. */
export const BACKEND_MAX_PENDING_SEC = 0.5;
/** The local simulation, used only when the backend is gone, steps this much at most per frame. */
const FALLBACK_MAX_DT_SEC = 0.05;
export const DEFAULT_SPEED = 4;
const AI_MODE: LolSimV1AiMode = "hybrid";

type GoldPoint = { minute: number; diff: number };

/** What React renders: the last engine answer, updated at most every COMMIT_INTERVAL_MS or on a discrete change. */
export interface LiveView {
  /** The last answer of the engine (not interpolated), or null until the first one arrives. */
  state: LolSimV1RuntimeState | null;
  goldDiffTimeline: GoldPoint[];
  running: boolean;
  speed: number;
  skipping: boolean;
  winner: TeamId | null;
}

/** What the subscribers of the frame bus get on every animation frame. Never goes through React. */
export interface LiveFrame {
  /** Positions blended between the previous and the current engine step. */
  state: LolSimV1RuntimeState;
  /** Game time, running smoothly between steps. */
  clockSec: number;
  running: boolean;
  nowMs: number;
}

export interface UseLiveSessionOptions {
  snapshot: MatchSnapshot;
  /** A new token starts a new session. The snapshot object itself never does. */
  startToken?: string | number;
  profilesReady: boolean;
  championByPlayerId: Record<string, string>;
  championProfilesById: Record<string, ChampionCombatProfile>;
  championUltimatesById: Record<string, LolChampionUltimateProfile>;
  policy?: LolSimV1PolicyConfig;
  initialSpeed?: number;
  commitIntervalMs?: number;
  scheduler?: FrameScheduler;
}

export interface LiveSession {
  view: LiveView;
  bus: FrameBus<LiveFrame>;
  setSpeed(speed: number): void;
  setRunning(running: boolean): void;
  /** A new match from minute 0 with a new seed. */
  reset(): void;
  /**
   * What the session wrote down of this match for the post-game screen: each champion's gold per
   * minute, the key events, and the second the match was skipped at (null for one watched whole).
   * Read when the match is handed on, never during the frame path.
   */
  record(): MatchRecord;
  /** Plays this match to its end on the engine. Resolves with the final state, or null when it failed. */
  skip(): Promise<LolSimV1RuntimeState | null>;
}

interface Engine {
  sim: PrototypeSimulation;
  client: LolSimV2Client | null;
  /** Last answer of the backend. */
  state: LolSimV1RuntimeState | null;
  stepView: StepView;
  inFlight: boolean;
  pendingDt: number;
  /** Answers of an older epoch (before a reset or a skip) are dropped. */
  epoch: number;
  lastFrameMs: number;
  gold: GoldPoint[];
  /** Gold per champion per minute, the key events, and where a skip began: the post-game record. */
  goldRecord: GoldRecord;
  keyLog: KeyEventLog;
  skippedAtSec: number | null;
  committedSignature: string;
  lastCommitMs: number;
  dirty: boolean;
}

function randomSeed10Digits() {
  const firstDigit = Math.floor(Math.random() * 9) + 1;
  const rest = Math.floor(Math.random() * 1_000_000_000).toString().padStart(9, "0");
  return `${firstDigit}${rest}`;
}

const toRuntime = (state: MatchState, speed: number): LolSimV1RuntimeState => ({ ...state, speed }) as unknown as LolSimV1RuntimeState;

/** What makes React render at once: a new event, a kill, a death or a respawn, the winner. */
function discreteSignature(state: LolSimV1RuntimeState): string {
  const events = state.events ?? [];
  const last = events[events.length - 1];
  const kills = (state.stats?.blue?.kills ?? 0) + (state.stats?.red?.kills ?? 0);
  const dead = (state.champions ?? []).reduce((count, champion) => count + (champion.alive ? 0 : 1), 0);
  return `${events.length}|${last ? `${last.t}:${last.text}` : ""}|${kills}|${dead}|${state.winner ?? ""}`;
}

function recordGold(timeline: GoldPoint[], state: LolSimV1RuntimeState) {
  const minute = Math.max(0, Math.floor((state.timeSec ?? 0) / 60));
  const diff = Math.round((state.stats?.blue?.gold ?? 0) - (state.stats?.red?.gold ?? 0));
  const last = timeline[timeline.length - 1];
  if (!last || last.minute !== minute) timeline.push({ minute, diff });
  else last.diff = diff;
}

/** Writes an engine answer into both gold series and the key-event log. */
function note(engine: Engine, state: LolSimV1RuntimeState) {
  recordGold(engine.gold, state);
  recordGoldSample(engine.goldRecord, state);
  recordKeyEvents(engine.keyLog, state.events);
}

const initialView = (speed: number): LiveView => ({
  state: null,
  goldDiffTimeline: [{ minute: 0, diff: 0 }],
  running: true,
  speed,
  skipping: false,
  winner: null,
});

/**
 * Owns the Rust live session of the watched match and splits its output in two paths:
 * - `view`: React state, committed at most every `commitIntervalMs` of real time and at once on
 *   a new event, a kill, pause/resume, a speed change, a reset or the winner;
 * - `bus`: one animation-frame loop that calls every subscriber with the interpolated state on
 *   every frame. There is never a React state update per frame.
 */
export function useLiveSession(options: UseLiveSessionOptions): LiveSession {
  const {
    snapshot,
    startToken = 0,
    profilesReady,
    initialSpeed = DEFAULT_SPEED,
    commitIntervalMs = COMMIT_INTERVAL_MS,
    scheduler = browserScheduler,
  } = options;

  // The effect keys on this identity, never on the snapshot object: the finished snapshot comes
  // back as a prop and must not restart the match.
  const sessionKey = `${snapshot.home_team.id}|${snapshot.away_team.id}|${startToken}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const frozenSnapshot = useMemo(() => snapshot, [sessionKey]);
  const nav = useMemo(() => new NavGrid(getWalls()), []);
  const bus = useMemo(() => createFrameBus<LiveFrame>(scheduler), [scheduler]);

  const latest = useRef(options);
  latest.current = options;

  const engineRef = useRef<Engine | null>(null);
  const runningRef = useRef(true);
  const speedRef = useRef(initialSpeed);
  const skippingRef = useRef(false);
  const seedRef = useRef("");

  const [view, setView] = useState<LiveView>(() => initialView(initialSpeed));

  const currentState = useCallback((engine: Engine): LolSimV1RuntimeState | null => {
    if (engine.client && engine.state) return engine.state;
    if (engine.client) return null; // The backend has not answered yet.
    return toRuntime(engine.sim.state, speedRef.current);
  }, []);

  const commit = useCallback(
    (engine: Engine, nowMs: number) => {
      const state = currentState(engine);
      if (state) note(engine, state);
      engine.committedSignature = state ? discreteSignature(state) : "";
      engine.lastCommitMs = nowMs;
      engine.dirty = false;
      setView({
        state,
        goldDiffTimeline: [...engine.gold],
        running: runningRef.current,
        speed: speedRef.current,
        skipping: skippingRef.current,
        winner: state?.winner ?? null,
      });
    },
    [currentState],
  );

  /** An answer of the backend: remember it, and commit now or leave it for the interval. */
  const applyAnswer = useCallback(
    (engine: Engine, next: LolSimV1RuntimeState, force: boolean) => {
      const nowMs = scheduler.now();
      engine.stepView = nextStepView(engine.stepView, engine.state, next, nowMs);
      engine.state = next;
      note(engine, next);
      if (force || discreteSignature(next) !== engine.committedSignature) commit(engine, nowMs);
      else engine.dirty = true;
    },
    [commit, scheduler],
  );

  const failBackend = useCallback(
    (engine: Engine) => {
      engine.client = null;
      engine.state = null;
      engine.inFlight = false;
      engine.pendingDt = 0;
      commit(engine, scheduler.now());
    },
    [commit, scheduler],
  );

  const sendTick = useCallback(
    (engine: Engine, client: LolSimV2Client) => {
      const epoch = engine.epoch;
      const dtSec = engine.pendingDt;
      engine.pendingDt = 0;
      engine.inFlight = true;
      const current = () => engine.client === client && engine.epoch === epoch;
      void (async () => {
        try {
          const response = await client.tick({ dtSec, running: true, speed: speedRef.current });
          if (current()) applyAnswer(engine, response.state, false);
        } catch {
          if (current()) failBackend(engine);
        } finally {
          if (current()) engine.inFlight = false;
        }
      })();
    },
    [applyAnswer, failBackend],
  );

  /** One animation frame: feed the engine, commit if due, return what the subscribers draw. */
  const produce = useCallback(
    (nowMs: number): LiveFrame | null => {
      const engine = engineRef.current;
      if (!engine) return null;
      const elapsedSec = engine.lastFrameMs ? Math.max(0, (nowMs - engine.lastFrameMs) / 1000) : 0;
      engine.lastFrameMs = nowMs;
      const running = runningRef.current && !skippingRef.current;
      const client = engine.client;

      if (client) {
        if (running && engine.state && !engine.state.winner) {
          // The engine turns real time into fixed steps, so it gets all the time it was owed at once.
          engine.pendingDt = Math.min(BACKEND_MAX_PENDING_SEC, engine.pendingDt + Math.min(BACKEND_MAX_FRAME_SEC, elapsedSec));
          if (!engine.inFlight) sendTick(engine, client);
        }
        if (engine.dirty && nowMs - engine.lastCommitMs >= commitIntervalMs) commit(engine, nowMs);
      } else {
        engine.sim.setRunning(running);
        if (running && !engine.sim.state.winner) engine.sim.tick(Math.min(FALLBACK_MAX_DT_SEC, elapsedSec), speedRef.current);
        const local = toRuntime(engine.sim.state, speedRef.current);
        if (discreteSignature(local) !== engine.committedSignature) commit(engine, nowMs);
        else if (nowMs - engine.lastCommitMs >= commitIntervalMs) commit(engine, nowMs);
      }

      const state = currentState(engine) ?? undefined;
      if (!state) return null;
      const finished = Boolean(state.winner);
      const fromBackend = engine.client !== null && state === engine.state;
      const drawn = fromBackend && !finished ? stateToDraw(engine.stepView, state, nowMs) : state;
      const clockSec = fromBackend ? smoothClockSec(running ? state : { ...state, running: false }, engine.stepView.receivedAtMs, nowMs) : state.timeSec;
      // Nothing moves after the winner: draw it once and let the loop end.
      if (finished) bus.stop();
      return { state: drawn, clockSec, running: runningRef.current, nowMs };
    },
    [bus, commit, commitIntervalMs, currentState, sendTick],
  );

  useEffect(() => {
    if (!profilesReady) return undefined;
    const { championByPlayerId, championProfilesById, championUltimatesById, policy } = latest.current;
    const seed = randomSeed10Digits();
    seedRef.current = seed;
    const sim = new PrototypeSimulation(nav, frozenSnapshot, seed, championByPlayerId, championProfilesById);
    const client = new LolSimV2Client();
    const engine: Engine = {
      sim,
      client,
      state: null,
      stepView: EMPTY_STEP_VIEW,
      inFlight: false,
      pendingDt: 0,
      epoch: 0,
      lastFrameMs: 0,
      gold: [{ minute: 0, diff: 0 }],
      goldRecord: newGoldRecord(),
      keyLog: newKeyEventLog(),
      skippedAtSec: null,
      committedSignature: "",
      lastCommitMs: scheduler.now(),
      dirty: false,
    };
    engineRef.current = engine;
    runningRef.current = true;
    skippingRef.current = false;
    setView((previous) =>
      previous.state === null && previous.running && !previous.skipping && previous.speed === speedRef.current && previous.goldDiffTimeline.length === 1
        ? previous
        : initialView(speedRef.current),
    );

    void (async () => {
      try {
        const response = await client.init({
          seed,
          aiMode: AI_MODE,
          policy,
          snapshot: frozenSnapshot,
          championByPlayerId,
          championProfilesById,
          championUltimatesById,
          initialState: toRuntime(sim.state, speedRef.current),
        });
        if (engine.client === client) applyAnswer(engine, response.state, true);
      } catch {
        if (engine.client === client) failBackend(engine);
      }
    })();

    bus.start(produce);
    return () => {
      bus.stop();
      if (engineRef.current === engine) engineRef.current = null;
      engine.client = null;
      engine.state = null;
      void client.dispose().catch(() => undefined);
    };
  }, [sessionKey, profilesReady, nav, frozenSnapshot, bus, produce, applyAnswer, failBackend, scheduler]);

  const setSpeed = useCallback(
    (speed: number) => {
      speedRef.current = speed;
      const engine = engineRef.current;
      if (engine) commit(engine, scheduler.now());
      else setView((previous) => ({ ...previous, speed }));
    },
    [commit, scheduler],
  );

  const setRunning = useCallback(
    (running: boolean) => {
      const engine = engineRef.current;
      if (skippingRef.current || engine?.state?.winner) return;
      runningRef.current = running;
      if (engine) commit(engine, scheduler.now());
      else setView((previous) => ({ ...previous, running }));
    },
    [commit, scheduler],
  );

  const reset = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const seed = randomSeed10Digits();
    seedRef.current = seed;
    engine.sim.reset(seed);
    runningRef.current = true;
    skippingRef.current = false;
    engine.epoch += 1;
    engine.state = null;
    engine.stepView = EMPTY_STEP_VIEW;
    engine.pendingDt = 0;
    engine.gold = [{ minute: 0, diff: 0 }];
    engine.goldRecord = newGoldRecord();
    engine.keyLog = newKeyEventLog();
    engine.skippedAtSec = null;
    engine.dirty = false;
    const client = engine.client;
    const epoch = engine.epoch;
    // No tick goes out until the engine has answered the reset.
    engine.inFlight = Boolean(client);
    commit(engine, scheduler.now());
    bus.start(produce);
    if (!client) return;
    const current = () => engine.client === client && engine.epoch === epoch;
    void (async () => {
      try {
        const response = await client.reset({
          seed,
          aiMode: AI_MODE,
          policy: latest.current.policy,
          initialState: toRuntime(engine.sim.state, speedRef.current),
        });
        if (!current()) return;
        applyAnswer(engine, response.state, true);
        engine.inFlight = false;
      } catch {
        if (current()) failBackend(engine);
      }
    })();
  }, [applyAnswer, bus, commit, failBackend, produce, scheduler]);

  const skip = useCallback(async (): Promise<LolSimV1RuntimeState | null> => {
    const engine = engineRef.current;
    const client = engine?.client;
    if (!engine || !client || !engine.state || skippingRef.current) return null;
    skippingRef.current = true;
    runningRef.current = false;
    // Everything from here to the end is played in one call: the record is partial from this second.
    engine.skippedAtSec = engine.state.timeSec;
    engine.epoch += 1;
    engine.inFlight = true;
    engine.pendingDt = 0;
    const epoch = engine.epoch;
    commit(engine, scheduler.now());
    const current = () => engine.client === client && engine.epoch === epoch;
    try {
      const response = await client.skipToEnd({ speed: speedRef.current });
      if (!current()) return null;
      skippingRef.current = false;
      engine.stepView = EMPTY_STEP_VIEW;
      engine.inFlight = false;
      applyAnswer(engine, response.state, true);
      return response.state;
    } catch {
      if (!current()) return null;
      engine.skippedAtSec = null;
      skippingRef.current = false;
      runningRef.current = true;
      engine.inFlight = false;
      commit(engine, scheduler.now());
      return null;
    }
  }, [applyAnswer, commit, scheduler]);

  const record = useCallback((): MatchRecord => {
    const engine = engineRef.current;
    if (!engine) return buildMatchRecord([], [], null);
    return buildMatchRecord(goldSeries(engine.goldRecord), [...engine.keyLog.events], engine.skippedAtSec);
  }, []);

  return { view, bus, setSpeed, setRunning, reset, skip, record };
}
