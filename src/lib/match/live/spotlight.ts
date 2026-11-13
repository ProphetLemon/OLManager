import {
  detectContacts,
  recallRemainingSec,
  respawnRemaining,
  towerBeams,
} from "@/lib/match/live/contacts";
import { refOf, type ChampionRef, type LiveChampion, type LiveStructure } from "@/lib/match/live/engagementContext";
import { structureLabel, type StructureLabel } from "@/lib/match/live/liveEvents";
import type { MapPoint, TeamSide } from "@/lib/match/live/mapGeometry";

/**
 * The one sentence under the map: the most important thing happening right now,
 * with the other engagements as chips. Pure. It returns kinds and params and no
 * text, so the screen can translate them; a pinned player replaces the headline
 * and keeps every engagement as a chip.
 */

export type EngagementKind = "nexus" | "objective" | "fight" | "tower" | "recall" | "hit" | "down";

/** Higher wins the headline. */
export const SPOTLIGHT_PRIORITY: Readonly<Record<EngagementKind, number>> = {
  nexus: 9,
  objective: 4,
  fight: 3,
  tower: 2.5,
  recall: 2,
  hit: 1.5,
  down: 1,
};

/** Champions this close (map units, 0..1) to a living pit with state "objective" are on it. */
export const OBJECTIVE_TAKER_RADIUS = 0.08;

/** A pit as the spotlight needs it; `objectivesView.pitViews` provides the real ones. */
export interface SpotlightPit {
  id: "dragon" | "top";
  /** Position in the 1000 unit space of `PITS`. */
  pos: MapPoint;
  alive: boolean;
  /** `dragon`, `elder`, `voidgrubs`, `herald` or `baron`. */
  entity: string;
  /** Kind of the dragon in the pit, when it is one. */
  dragonKind?: string | null;
  hpPct?: number | null;
}

export interface SpotlightContext {
  nowSec: number;
  champions: readonly LiveChampion[];
  structures: readonly LiveStructure[];
  pits?: readonly SpotlightPit[];
  /** Set once a nexus has fallen. */
  winner?: TeamSide | null;
}

interface EngagementBase {
  /** Stable key for lists. */
  id: string;
  /** Where the map's attention goes, 0..1. */
  focus: MapPoint;
  priority: number;
}

export interface NexusEngagement extends EngagementBase {
  kind: "nexus";
  params: { winner: TeamSide };
}
export interface ObjectiveEngagement extends EngagementBase {
  kind: "objective";
  params: { pit: "dragon" | "top"; entity: string; dragonKind: string | null; hpPct: number | null; champions: ChampionRef[] };
}
export interface FightEngagement extends EngagementBase {
  kind: "fight";
  params: { a: ChampionRef; b: ChampionRef; ageSec: number };
}
export interface HitEngagement extends EngagementBase {
  kind: "hit";
  params: { attacker: ChampionRef; victim: ChampionRef; ageSec: number };
}
export interface TowerEngagement extends EngagementBase {
  kind: "tower";
  params: { structure: StructureLabel; owner: TeamSide; target: ChampionRef; shots: number; ageSec: number };
}
export interface RecallEngagement extends EngagementBase {
  kind: "recall";
  params: { champion: ChampionRef; secondsLeft: number };
}
export interface DownEngagement extends EngagementBase {
  kind: "down";
  params: { champion: ChampionRef; seconds: number };
}

export type Engagement =
  | NexusEngagement
  | ObjectiveEngagement
  | FightEngagement
  | HitEngagement
  | TowerEngagement
  | RecallEngagement
  | DownEngagement;

export type FollowingState = "dead" | "recall" | "objective" | "jungle" | "fight" | "lane";

/** The headline of a pinned player. */
export interface FollowingLine {
  id: string;
  kind: "following";
  focus: MapPoint;
  params: {
    champion: ChampionRef;
    state: FollowingState;
    /** Seconds of respawn (dead) or of recall left; null otherwise. */
    seconds: number | null;
    level: number | null;
    hpPct: number | null;
  };
}

export interface Spotlight {
  kind: Engagement["kind"] | "following" | "quiet";
  /** `null` when quiet. */
  headline: Engagement | FollowingLine | null;
  focus: MapPoint;
  /** Every other engagement, most important first. */
  chips: Engagement[];
}

const CENTER: MapPoint = { x: 0.5, y: 0.5 };
const midpoint = (a: MapPoint, b: MapPoint): MapPoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Every engagement of the moment, sorted: priority first, then the fresher or the smaller id. */
export function buildEngagements(context: SpotlightContext): Engagement[] {
  const { nowSec, champions, structures } = context;
  const byId = new Map(champions.map((champion) => [champion.id, champion]));
  const out: Array<{ engagement: Engagement; rank: number }> = [];
  const add = (engagement: Engagement, rank = 0) => out.push({ engagement, rank });

  if (context.winner) {
    const fallen = structures.find((structure) => structure.kind === "nexus" && structure.team !== context.winner);
    add({
      id: "nexus",
      kind: "nexus",
      priority: SPOTLIGHT_PRIORITY.nexus,
      focus: fallen?.pos ?? CENTER,
      params: { winner: context.winner },
    });
  }

  for (const pit of context.pits ?? []) {
    if (!pit.alive) continue;
    const at = { x: pit.pos.x / 1000, y: pit.pos.y / 1000 };
    const takers = champions.filter(
      (champion) =>
        champion.alive &&
        champion.state === "objective" &&
        Math.hypot(champion.pos.x - at.x, champion.pos.y - at.y) < OBJECTIVE_TAKER_RADIUS,
    );
    if (takers.length === 0) continue;
    add({
      id: `objective:${pit.id}`,
      kind: "objective",
      priority: SPOTLIGHT_PRIORITY.objective,
      focus: at,
      params: {
        pit: pit.id,
        entity: pit.entity,
        dragonKind: pit.dragonKind ?? null,
        hpPct: pit.hpPct ?? null,
        champions: takers.map(refOf),
      },
    });
  }

  for (const pair of detectContacts(champions, nowSec).pairs) {
    const a = byId.get(pair.a);
    const b = byId.get(pair.b);
    if (!a || !b) continue;
    const focus = midpoint(a.pos, b.pos);
    if (pair.mutual) {
      add({ id: `fight:${pair.id}`, kind: "fight", priority: SPOTLIGHT_PRIORITY.fight, focus, params: { a: refOf(a), b: refOf(b), ageSec: pair.ageSec } }, pair.ageSec);
    } else {
      const victim = pair.ageByTarget[pair.a] !== undefined ? a : b;
      const attacker = victim === a ? b : a;
      add(
        {
          id: `hit:${attacker.id}>${victim.id}`,
          kind: "hit",
          priority: SPOTLIGHT_PRIORITY.hit,
          focus,
          params: { attacker: refOf(attacker), victim: refOf(victim), ageSec: pair.ageSec },
        },
        pair.ageSec,
      );
    }
  }

  for (const beam of towerBeams(structures, champions, nowSec)) {
    const structure = structures.find((candidate) => candidate.id === beam.structureId);
    const target = byId.get(beam.targetId);
    if (!structure || !target) continue;
    add(
      {
        id: `tower:${beam.structureId}`,
        kind: "tower",
        priority: SPOTLIGHT_PRIORITY.tower,
        focus: structure.pos ? midpoint(structure.pos, target.pos) : target.pos,
        params: { structure: structureLabel(beam.structureId), owner: structure.team, target: refOf(target), shots: beam.shots, ageSec: beam.ageSec },
      },
      beam.ageSec,
    );
  }

  for (const champion of champions) {
    const left = recallRemainingSec(champion, nowSec);
    if (left !== null) {
      add({ id: `recall:${champion.id}`, kind: "recall", priority: SPOTLIGHT_PRIORITY.recall, focus: champion.pos, params: { champion: refOf(champion), secondsLeft: left } });
    }
  }
  for (const champion of champions) {
    if (champion.alive) continue;
    add({
      id: `down:${champion.id}`,
      kind: "down",
      priority: SPOTLIGHT_PRIORITY.down,
      focus: champion.pos,
      params: { champion: refOf(champion), seconds: Math.ceil(respawnRemaining(champion, nowSec)) },
    });
  }

  return out
    .sort((x, y) => y.engagement.priority - x.engagement.priority || x.rank - y.rank || (x.engagement.id < y.engagement.id ? -1 : 1))
    .map((entry) => entry.engagement);
}

function followingOf(champion: LiveChampion, nowSec: number): FollowingLine {
  const recallLeft = recallRemainingSec(champion, nowSec);
  let state: FollowingState;
  let seconds: number | null = null;
  if (!champion.alive) {
    state = "dead";
    seconds = Math.ceil(respawnRemaining(champion, nowSec));
  } else if (recallLeft !== null) {
    state = "recall";
    seconds = recallLeft;
  } else if (champion.state === "objective" || champion.state === "jungle" || champion.state === "fight") {
    state = champion.state;
  } else {
    state = "lane";
  }
  const hpPct =
    typeof champion.hp === "number" && typeof champion.maxHp === "number" && champion.maxHp > 0
      ? Math.round(Math.max(0, Math.min(1, champion.hp / champion.maxHp)) * 100)
      : null;
  return {
    id: `following:${champion.id}`,
    kind: "following",
    focus: champion.pos,
    params: { champion: refOf(champion), state, seconds, level: champion.level ?? null, hpPct },
  };
}

/** The caption: the top engagement, or the pinned player, with the rest as chips. */
export function buildSpotlight(context: SpotlightContext, pinnedId?: string | null): Spotlight {
  const engagements = buildEngagements(context);
  const pinned = pinnedId ? context.champions.find((champion) => champion.id === pinnedId) : undefined;
  if (pinned) {
    const headline = followingOf(pinned, context.nowSec);
    return { kind: "following", headline, focus: headline.focus, chips: engagements };
  }
  const [top, ...rest] = engagements;
  if (!top) return { kind: "quiet", headline: null, focus: CENTER, chips: [] };
  return { kind: top.kind, headline: top, focus: top.focus, chips: rest };
}
