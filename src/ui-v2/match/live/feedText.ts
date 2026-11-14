import type { TFunction } from "i18next";

import type { FeedEntry, NeutralObjective, StructureLabel, StructurePart } from "@/lib/match/live/liveEvents";
import type { LaneKey, TeamSide } from "@/lib/match/live/mapGeometry";

import type { TeamNames } from "./eventSentence";
import { DRAGON_NAME_KEYS, DRAGON_PLAIN_KEY, TEAM_KEYS } from "./liveNames";

/**
 * The words of a feed entry. The entries carry kinds and params (`liveEvents`); this turns them
 * into a sentence in the language of the screen. Every key is a literal in a const map, so the
 * key guards can see it. Used by the list, by its screen-reader text and by the live region.
 */

const PART_KEYS: Readonly<Record<StructurePart, string>> = {
  "outer-tower": "onAir.match.feed.part.outerTower",
  "inner-tower": "onAir.match.feed.part.innerTower",
  "inhibitor-tower": "onAir.match.feed.part.inhibitorTower",
  "nexus-tower": "onAir.match.feed.part.nexusTower",
  inhibitor: "onAir.match.feed.part.inhibitor",
  nexus: "onAir.match.feed.part.nexus",
  unknown: "onAir.match.feed.part.unknown",
};

const LANE_KEYS: Readonly<Record<LaneKey, string>> = {
  top: "onAir.match.feed.lane.top",
  mid: "onAir.match.feed.lane.mid",
  bot: "onAir.match.feed.lane.bot",
};

const OBJECTIVE_KEYS: Readonly<Record<NeutralObjective, string>> = {
  voidgrub: "onAir.match.feed.voidgrub",
  "voidgrub-camp": "onAir.match.feed.voidgrubCamp",
  herald: "onAir.match.feed.herald",
  scuttle: "onAir.match.feed.scuttle",
};

const CAUSE_KEYS: Readonly<Record<string, string>> = {
  tower: "onAir.match.feed.cause.tower",
  minion: "onAir.match.feed.cause.minion",
};

/** A cause the engine names and this screen has no word for is shown as the engine wrote it. */
export function causeText(cause: string, t: TFunction): string {
  const key = CAUSE_KEYS[cause];
  return key ? t(key) : cause;
}

/** "The outer turret (top)": shared by the feed, the spotlight caption and the Fight board. */
export function structureText(label: StructureLabel, t: TFunction): string {
  const part = t(PART_KEYS[label.part]);
  return label.lane ? t("onAir.match.feed.structure", { part, lane: t(LANE_KEYS[label.lane]) }) : part;
}

function teamText(side: TeamSide | null, t: TFunction, teamNames?: TeamNames): string {
  if (!side) return t("onAir.match.feed.someone");
  return teamNames?.[side] || t(TEAM_KEYS[side]);
}

/** `teamNames`: the clubs' tags, so a line names the club; without them it says Blue or Red. */
export function entrySentence(entry: FeedEntry, t: TFunction, teamNames?: TeamNames): string {
  const team = teamText(entry.side, t, teamNames);
  switch (entry.kind) {
    case "kill": {
      const names = { killer: entry.killer.name, victim: entry.victim.name };
      if (entry.ignite) return t("onAir.match.feed.ignited", names);
      return entry.cause
        ? t("onAir.match.feed.killedCause", { ...names, cause: causeText(entry.cause, t) })
        : t("onAir.match.feed.killed", names);
    }
    case "tower":
    case "nexus":
      return t("onAir.match.feed.destroyed", { team, structure: structureText(entry.structure, t) });
    case "dragon":
      return t("onAir.match.feed.dragon", {
        team,
        dragon: t(entry.dragonKind ? DRAGON_NAME_KEYS[entry.dragonKind] : DRAGON_PLAIN_KEY),
      });
    case "elder":
      return t("onAir.match.feed.elder", { team });
    case "baron":
      return t("onAir.match.feed.baron", { team });
    case "objective":
      return t(OBJECTIVE_KEYS[entry.objective], { team });
    case "neutral":
      return entry.text;
  }
}
