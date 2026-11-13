import { STRUCTURES_LAYOUT } from "@/lib/match/lolMapLayout";
import {
  createDefaultObjectivesState,
  createEmptyNeutralTimersState,
  type LolSimV1RuntimeState,
} from "@/ui-v2/_legacy/components/match/lol-prototype/backend/contract-v1";
import type {
  ChampionState,
  StructureState,
  TeamId,
} from "@/ui-v2/_legacy/components/match/lol-prototype/engine/types";

import { createFrameBus, type FrameBus } from "./frameBus";
import { createFakeScheduler, type FakeScheduler } from "./frameScheduler.testing";
import type { LiveFrame } from "./useLiveSession";

/** A living champion in a lane, with the fields the arena reads. */
export function makeChampion(
  id: string,
  team: TeamId,
  x: number,
  y: number,
  over: Partial<ChampionState> = {},
): ChampionState {
  return {
    id,
    name: id.toUpperCase(),
    team,
    role: "MID",
    lane: "mid",
    pos: { x, y },
    hp: 800,
    maxHp: 1000,
    alive: true,
    respawnAt: 0,
    attackCdUntil: 0,
    moveSpeed: 340,
    attackRange: 550,
    attackType: "ranged",
    attackDamage: 60,
    targetPath: [],
    targetPathIndex: 0,
    nextDecisionAt: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    gold: 500,
    spentGold: 0,
    xp: 0,
    level: 6,
    cs: 40,
    items: [],
    lastDamagedByChampionId: null,
    lastDamagedAt: 0,
    state: "lane",
    recallAnchor: null,
    recallChannelUntil: 0,
    ...over,
  };
}

export function makeStructure(
  id: string,
  team: TeamId,
  kind: StructureState["kind"],
  x: number,
  y: number,
  over: Partial<StructureState> = {},
): StructureState {
  return {
    id,
    team,
    lane: "mid",
    kind,
    pos: { x, y },
    hp: 3000,
    maxHp: 3000,
    alive: true,
    attackCdUntil: 0,
    ...over,
  };
}

/** The 30 structures of a full map, at the positions of the layout. `over` adjusts one by id. */
export function makeStructureSet(over: (id: string) => Partial<StructureState> = () => ({})): StructureState[] {
  return STRUCTURES_LAYOUT.map((point) => {
    const kind: StructureState["kind"] = point.id.endsWith("-nexus")
      ? "nexus"
      : point.icon.startsWith("inhibitor")
        ? "inhib"
        : "tower";
    return makeStructure(point.id, point.side, kind, point.x, point.y, over(point.id));
  });
}

export function makeState(over: Partial<LolSimV1RuntimeState> = {}): LolSimV1RuntimeState {
  return {
    timeSec: 100,
    running: true,
    winner: null,
    showWalls: false,
    champions: [],
    minions: [],
    structures: [],
    objectives: createDefaultObjectivesState(),
    neutralTimers: createEmptyNeutralTimersState(),
    stats: {
      blue: { kills: 0, towers: 0, dragons: 0, barons: 0, gold: 0 },
      red: { kills: 0, towers: 0, dragons: 0, barons: 0, gold: 0 },
    },
    events: [],
    speed: 4,
    ...over,
  };
}

/** A frame of the interpolated state, as the bus publishes it. */
export function makeFrame(state: LolSimV1RuntimeState, over: Partial<LiveFrame> = {}): LiveFrame {
  return { state, clockSec: state.timeSec, running: true, nowMs: 0, ...over };
}

export interface TestBus {
  bus: FrameBus<LiveFrame>;
  scheduler: FakeScheduler;
  /** Publishes `frame` on the next animation frame. */
  publish: (frame: LiveFrame) => void;
}

/** A frame bus on a hand driven clock, already running, whose frames the test chooses. */
export function createTestBus(): TestBus {
  const scheduler = createFakeScheduler();
  const bus = createFrameBus<LiveFrame>(scheduler);
  let next: LiveFrame | null = null;
  bus.start(() => next);
  return {
    bus,
    scheduler,
    publish(frame) {
      next = frame;
      scheduler.frame();
    },
  };
}
