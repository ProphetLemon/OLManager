import type { TFunction } from "i18next";

import type { DragonKind } from "@/lib/match/live/liveEvents";
import { structureLabel } from "@/lib/match/live/liveEvents";
import type { TeamSide } from "@/lib/match/live/mapGeometry";
import { itemDisplayName } from "@/ui-v2/_legacy/components/match/itemNames";

import { causeText, structureText } from "./feedText";
import { DRAGON_NAME_KEYS, DRAGON_PLAIN_KEY, TEAM_KEYS } from "./liveNames";

/**
 * The words of a match event on the screens that look back at a finished match. The engine sends
 * each event as `{ text, type, code, data }`: `code` says what happened, `data` holds the facts
 * (who, to whom, which structure), and `text` is only the English line it also writes. This turns
 * code and data into a sentence in the language of the screen. A state saved before events had a
 * code, a code this build does not know, or data that is missing a fact the sentence needs all
 * give the stored text back, so an old report still reads. Every key is a literal in a const map
 * so the key guards can see it.
 */

export interface EventDataLike {
  actor?: string;
  actorId?: string;
  target?: string;
  targetId?: string;
  team?: string;
  cause?: string;
  structure?: string;
  objective?: string;
  dragonKind?: string;
  item?: string;
  spell?: string;
}

export interface CodedEventLike {
  text?: string;
  type?: string;
  code?: string;
  data?: EventDataLike | null;
}

const SPELL_KEYS: Readonly<Record<string, string>> = {
  ultimate: "onAir.match.feed.castUltimate",
  heal: "onAir.match.feed.castHeal",
  flash: "onAir.match.feed.castFlash",
  smite: "onAir.match.feed.castSmite",
  teleport: "onAir.match.feed.castTeleport",
};

/** Objectives that have a name of their own; the jungle camps share one word. */
const OBJECTIVE_KEYS: Readonly<Record<string, string>> = {
  dragon: "match.draftResult.timelineEvents.dragon",
  elder: "match.draftResult.timelineEvents.elder",
  baron: "match.draftResult.timelineEvents.baron",
  herald: "match.draftResult.timelineEvents.herald",
  voidgrubs: "onAir.match.pit.voidgrubs",
  "scuttle-top": "onAir.match.feed.neutralScuttle",
  "scuttle-bot": "onAir.match.feed.neutralScuttle",
};
const CAMP_KEY = "onAir.match.feed.neutralCamp";
const CAMP_TIMER = /^[a-z-]+-(blue|red)$/;

function sideOf(value: string | undefined): TeamSide | null {
  return value === "blue" || value === "red" ? value : null;
}

function objectiveName(key: string | undefined, t: TFunction): string | null {
  if (!key) return null;
  const named = OBJECTIVE_KEYS[key];
  if (named) return t(named);
  return CAMP_TIMER.test(key) ? t(CAMP_KEY) : null;
}

/** The sentence for one event, or its stored text when there is nothing to compose. */
export function eventSentence(event: CodedEventLike, t: TFunction): string {
  const stored = typeof event.text === "string" ? event.text : "";
  const sentence = compose(event, t);
  return sentence ?? stored;
}

function compose(event: CodedEventLike, t: TFunction): string | null {
  const data = event.data ?? {};
  const { actor, target } = data;
  const side = sideOf(data.team);
  const team = side ? t(TEAM_KEYS[side]) : null;

  switch (event.code) {
    case "champion_killed": {
      if (!actor || !target) return null;
      const names = { killer: actor, victim: target };
      return data.cause
        ? t("onAir.match.feed.killedCause", { ...names, cause: causeText(data.cause, t) })
        : t("onAir.match.feed.killed", names);
    }
    case "ignite_kill":
      return actor && target ? t("onAir.match.feed.ignited", { killer: actor, victim: target }) : null;
    case "structure_destroyed":
      return team && data.structure
        ? t("onAir.match.feed.destroyed", { team, structure: structureText(structureLabel(data.structure), t) })
        : null;
    case "dragon_secured": {
      if (!team) return null;
      const kind = data.dragonKind as DragonKind | undefined;
      const dragon = t(kind && kind in DRAGON_NAME_KEYS ? DRAGON_NAME_KEYS[kind] : DRAGON_PLAIN_KEY);
      return t("onAir.match.feed.dragon", { team, dragon });
    }
    case "baron_secured":
      return team ? t("onAir.match.feed.baron", { team }) : null;
    case "elder_secured":
      return team ? t("onAir.match.feed.elder", { team }) : null;
    case "herald_secured":
      return team ? t("onAir.match.feed.herald", { team }) : null;
    case "voidgrub_secured":
      return team ? t("onAir.match.feed.voidgrub", { team }) : null;
    case "voidgrub_camp_cleared":
      return team ? t("onAir.match.feed.voidgrubCamp", { team }) : null;
    case "objective_secured":
      // Only the scuttle crab is secured this way today; any other objective keeps its text.
      return team && (data.objective === "scuttle-top" || data.objective === "scuttle-bot")
        ? t("onAir.match.feed.scuttle", { team })
        : null;
    case "herald_deployed":
      return team ? t("onAir.match.feed.heraldDeployed", { team }) : null;
    case "camp_cleared":
      return actor ? t("onAir.match.feed.campCleared", { actor }) : null;
    case "camp_skipped":
      return actor ? t("onAir.match.feed.campSkipped", { actor }) : null;
    case "neutral_spawned":
    case "neutral_despawned": {
      const objective = objectiveName(data.objective, t);
      if (!objective) return null;
      return t(event.code === "neutral_spawned" ? "onAir.match.feed.neutralSpawned" : "onAir.match.feed.neutralDespawned", {
        objective,
      });
    }
    case "recall_started":
      return actor ? t("onAir.match.feed.recallStarted", { actor }) : null;
    case "recall_interrupted":
      return actor ? t("onAir.match.feed.recallInterrupted", { actor }) : null;
    case "recall_completed":
      return actor ? t("onAir.match.feed.recalled", { actor }) : null;
    case "sweeper_activated":
      return actor ? t("onAir.match.feed.sweeper", { actor }) : null;
    case "unit_summoned":
      return actor ? t("onAir.match.feed.summoned", { actor }) : null;
    case "spell_cast": {
      const key = data.spell ? SPELL_KEYS[data.spell] : undefined;
      return actor && key ? t(key, { actor }) : null;
    }
    case "ignite_cast":
      return actor && target ? t("onAir.match.feed.igniteCast", { actor, target }) : null;
    case "item_bought":
      return actor && data.item ? t("onAir.match.feed.boughtItem", { actor, item: itemDisplayName(data.item) }) : null;
    case "wave_spawned":
      return t("onAir.match.feed.waveSpawned");
    default:
      return null;
  }
}
