import {
  RECALL_CHANNEL_SEC,
  detectContacts,
  recallRemainingSec,
  respawnRemaining,
  towerBeams,
} from "@/lib/match/live/contacts";
import { refOf, type ChampionRef } from "@/lib/match/live/engagementContext";
import { structureLabel, type StructureLabel } from "@/lib/match/live/liveEvents";
import type { TeamSide } from "@/lib/match/live/mapGeometry";
import type { SpotlightContext } from "@/lib/match/live/spotlight";

/**
 * The Fight board: the map's text twin. One row per contact, tower firing, recall
 * and dead champion, or a single quiet row. Rows carry kinds and params and no
 * English; the screen turns them into sentences. Every row has an id that is
 * stable while the thing it describes lasts, so a list can use it as its key.
 */

export interface ContactHit {
  attacker: ChampionRef;
  victim: ChampionRef;
  /** Seconds since this hit. */
  ageSec: number;
}

export interface ContactRow {
  id: string;
  kind: "contact";
  params: {
    a: ChampionRef;
    b: ChampionRef;
    /** Both hit each other inside the window: "trading hits". */
    mutual: boolean;
    /** One entry, or two when mutual; the freshest first. */
    hits: ContactHit[];
    ageSec: number;
  };
}

export interface TurretRow {
  id: string;
  kind: "turret";
  params: {
    structure: StructureLabel;
    owner: TeamSide;
    target: ChampionRef;
    /** Shots on this target: `rampShots + 1`. */
    shots: number;
    /** Seconds since the latest shot. */
    lastShotAgeSec: number;
  };
}

export interface RecallRow {
  id: string;
  kind: "recall";
  params: { champion: ChampionRef; secondsLeft: number; totalSec: number };
}

export interface DeadRow {
  id: string;
  kind: "dead";
  params: { champion: ChampionRef; respawnSec: number };
}

export interface QuietRow {
  id: "quiet";
  kind: "quiet";
  params: Record<string, never>;
}

export type FightBoardRow = ContactRow | TurretRow | RecallRow | DeadRow | QuietRow;

export function buildFightBoard(context: Pick<SpotlightContext, "nowSec" | "champions" | "structures">): FightBoardRow[] {
  const { nowSec, champions, structures } = context;
  const byId = new Map(champions.map((champion) => [champion.id, champion]));
  const rows: FightBoardRow[] = [];

  for (const pair of detectContacts(champions, nowSec).pairs) {
    const a = byId.get(pair.a);
    const b = byId.get(pair.b);
    if (!a || !b) continue;
    const hits: ContactHit[] = [];
    for (const [victim, attacker] of [[a, b], [b, a]] as const) {
      const ageSec = pair.ageByTarget[victim.id];
      if (ageSec !== undefined) hits.push({ attacker: refOf(attacker), victim: refOf(victim), ageSec });
    }
    hits.sort((x, y) => x.ageSec - y.ageSec);
    rows.push({
      id: `contact:${pair.id}`,
      kind: "contact",
      params: { a: refOf(a), b: refOf(b), mutual: pair.mutual, hits, ageSec: pair.ageSec },
    });
  }

  for (const beam of towerBeams(structures, champions, nowSec)) {
    const structure = structures.find((candidate) => candidate.id === beam.structureId);
    const target = byId.get(beam.targetId);
    if (!structure || !target) continue;
    rows.push({
      id: `turret:${beam.structureId}`,
      kind: "turret",
      params: {
        structure: structureLabel(beam.structureId),
        owner: structure.team,
        target: refOf(target),
        shots: beam.shots,
        lastShotAgeSec: beam.ageSec,
      },
    });
  }

  for (const champion of champions) {
    const secondsLeft = recallRemainingSec(champion, nowSec);
    if (secondsLeft === null) continue;
    rows.push({
      id: `recall:${champion.id}`,
      kind: "recall",
      params: { champion: refOf(champion), secondsLeft, totalSec: RECALL_CHANNEL_SEC },
    });
  }

  for (const champion of champions) {
    if (champion.alive) continue;
    rows.push({
      id: `dead:${champion.id}`,
      kind: "dead",
      params: { champion: refOf(champion), respawnSec: Math.ceil(respawnRemaining(champion, nowSec)) },
    });
  }

  return rows.length > 0 ? rows : [{ id: "quiet", kind: "quiet", params: {} }];
}
