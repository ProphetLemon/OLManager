import type { DraftMatchResult, DraftPlayerResult, DraftTimelineEvent } from "@/ui-v2/_legacy/components/match/draftResultSimulator";

import type { PostGameChampion, PostGameState } from "./postGame";
import type { TimelineEntry, TimelineKind } from "./postGameTimeline";

/**
 * A simulated match (the tactics-stage "Simulate", a delegated game) has no champions on a map and
 * no record: only a `DraftMatchResult`. This reads such a result as the post-game screen's state, so
 * the same scoreboard shows it, with only what a simulation knows. Level, CS, items and spells are
 * left out, and there is no gold series or key-event log, so the charts that need them are not drawn.
 */

const ROLE: Readonly<Record<DraftPlayerResult["role"], string>> = { TOP: "TOP", JUNGLE: "JGL", MID: "MID", ADC: "ADC", SUPPORT: "SUP" };

/** True for the state of a match played out on the engine; false for the empty one a simulation hands on. */
export const hasPlayedOutState = (state: { champions?: ReadonlyArray<unknown> } | null | undefined): boolean => (state?.champions?.length ?? 0) > 0;

function championOf(row: DraftPlayerResult): PostGameChampion {
  return {
    id: row.playerId,
    name: row.playerName,
    team: row.side,
    role: ROLE[row.role] ?? row.role,
    kills: row.kills,
    deaths: row.deaths,
    assists: row.assists,
    gold: row.gold,
    spentGold: row.spentGold,
    damageDealt: row.damageDealt,
  };
}

export function postGameStateFromResult(result: DraftMatchResult): PostGameState {
  const side = (which: "blue" | "red") => ({
    kills: which === "blue" ? result.blueKills : result.redKills,
    towers: result.objectives[which].towers,
    dragons: result.objectives[which].dragons,
    barons: result.objectives[which].barons,
  });
  const counts = (which: "blue" | "red") => ({ grubs: result.objectives[which].voidgrubs, heralds: result.objectives[which].heralds });
  return {
    timeSec: result.durationMinutes * 60,
    winner: result.winnerSide,
    stats: { blue: side("blue"), red: side("red") },
    champions: result.playerResults.map(championOf),
    mvpId: result.mvp?.playerId,
    counts: { blue: counts("blue"), red: counts("red") },
  };
}

/** The champion each player picked, by player id, as the portraits need it. */
export function championKeysOf(result: DraftMatchResult): Record<string, string> {
  const keys: Record<string, string> = {};
  for (const row of result.playerResults) if (row.championId) keys[row.playerId] = row.championId;
  return keys;
}

const KIND: Readonly<Record<DraftTimelineEvent["type"], TimelineKind>> = {
  first_blood: "firstBlood",
  voidgrubs: "grub",
  dragon: "dragon",
  dragon_soul: "dragon",
  elder: "elder",
  herald: "herald",
  baron: "baron",
  turret: "tower",
  inhibitor: "inhibitor",
  nexus_turret: "tower",
  nexus: "nexus",
};

/** Keys of the words the simulator's events are written in. Literal strings, so the key guards see them. */
export const RESULT_EVENT_KEYS: Readonly<Record<DraftTimelineEvent["type"], string>> = {
  first_blood: "match.draftResult.timelineEvents.firstBlood",
  voidgrubs: "match.draftResult.timelineEvents.voidgrubs",
  dragon: "match.draftResult.timelineEvents.dragon",
  dragon_soul: "match.draftResult.timelineEvents.dragonSoul",
  elder: "match.draftResult.timelineEvents.elder",
  herald: "match.draftResult.timelineEvents.herald",
  baron: "match.draftResult.timelineEvents.baron",
  turret: "match.draftResult.timelineEvents.turret",
  inhibitor: "match.draftResult.timelineEvents.inhibitor",
  nexus_turret: "match.draftResult.timelineEvents.nexusTurret",
  nexus: "match.draftResult.timelineEvents.nexus",
};

const BIG: ReadonlySet<TimelineKind> = new Set(["firstBlood", "baron", "elder", "nexus"]);

export function timelineFromResult(result: DraftMatchResult): TimelineEntry[] {
  return [...result.timelineEvents]
    .sort((a, b) => a.minute - b.minute)
    .map((event, index) => {
      const kind = KIND[event.type] ?? "kill";
      const t = event.minute * 60;
      return {
        id: `${t}-${event.type}-${index}`,
        t,
        side: event.side,
        kind,
        big: BIG.has(kind) || event.type === "dragon_soul",
        dragonKind: null,
        structureOwner: null,
        actorId: null,
        labelKey: RESULT_EVENT_KEYS[event.type] ?? null,
        event: { t, text: event.label, type: event.type },
      };
    });
}
