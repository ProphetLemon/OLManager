import type { TFunction } from "i18next";

import type { DragonKind } from "@/lib/match/live/liveEvents";
import type { Engagement, FollowingLine, FollowingState, Spotlight } from "@/lib/match/live/spotlight";

import { structureText } from "./feedText";
import { DRAGON_NAME_KEYS, DRAGON_PLAIN_KEY, TEAM_KEYS } from "./liveNames";

/**
 * The words of the spotlight caption. `spotlight.ts` returns kinds and params; this turns them
 * into the headline sentence and the short text of a chip. Every key is a literal in a const
 * map, so the key guards can see it.
 */

export const SPOTLIGHT_KIND_KEYS: Readonly<Record<Spotlight["kind"], string>> = {
  nexus: "onAir.match.spotlight.kind.nexus",
  objective: "onAir.match.spotlight.kind.objective",
  fight: "onAir.match.spotlight.kind.fight",
  tower: "onAir.match.spotlight.kind.tower",
  recall: "onAir.match.spotlight.kind.recall",
  hit: "onAir.match.spotlight.kind.hit",
  down: "onAir.match.spotlight.kind.down",
  following: "onAir.match.spotlight.kind.following",
  quiet: "onAir.match.spotlight.kind.quiet",
};

const ENTITY_KEYS: Readonly<Record<string, string>> = {
  elder: "match.draftResult.timelineEvents.elder",
  baron: "match.draftResult.timelineEvents.baron",
  herald: "match.draftResult.timelineEvents.herald",
  voidgrubs: "onAir.match.pit.voidgrubs",
};

const FOLLOWING_KEYS: Readonly<Record<Exclude<FollowingState, "dead" | "recall">, string>> = {
  objective: "onAir.match.spotlight.following.objective",
  jungle: "onAir.match.spotlight.following.jungle",
  fight: "onAir.match.spotlight.following.fight",
  lane: "onAir.match.spotlight.following.lane",
};

/** The most chips the caption shows; the rest are counted. */
export const MAX_CHIPS = 6;

type ObjectiveParams = Extract<Engagement, { kind: "objective" }>["params"];

function objectiveName(params: ObjectiveParams, t: TFunction): string {
  if (params.entity === "dragon") {
    const kind = params.dragonKind as DragonKind | null;
    return t(kind && kind in DRAGON_NAME_KEYS ? DRAGON_NAME_KEYS[kind] : DRAGON_PLAIN_KEY);
  }
  const key = ENTITY_KEYS[params.entity];
  return key ? t(key) : params.entity;
}

interface ListFormatLike {
  format(items: readonly string[]): string;
}
type ListFormatCtor = new (locale: string, options: { style: "long"; type: "conjunction" }) => ListFormatLike;

/** "A, B and C" in the language of the screen. */
export function listText(names: readonly string[], locale: string): string {
  // The compiler's library target predates Intl.ListFormat; every runtime of the app has it.
  const ListFormat = (Intl as unknown as { ListFormat?: ListFormatCtor }).ListFormat;
  if (ListFormat) {
    try {
      return new ListFormat(locale, { style: "long", type: "conjunction" }).format(names);
    } catch {
      // A locale the runtime does not know: fall through to the plain list.
    }
  }
  return names.join(", ");
}

const wholeSeconds = (seconds: number) => Math.max(0, Math.ceil(seconds));

/** The one sentence under the map. */
export function spotlightSentence(headline: Engagement | FollowingLine | null, t: TFunction, locale: string): string {
  if (!headline) return t("onAir.match.spotlight.quiet");
  switch (headline.kind) {
    case "nexus":
      return t("onAir.match.spotlight.nexus", { team: t(TEAM_KEYS[headline.params.winner]) });
    case "objective": {
      const { champions, hpPct } = headline.params;
      const names = listText(
        champions.map((champion) => champion.name),
        locale,
      );
      const objective = objectiveName(headline.params, t);
      return hpPct === null
        ? t("onAir.match.spotlight.objective", { count: champions.length, names, objective })
        : t("onAir.match.spotlight.objectiveHp", { count: champions.length, names, objective, percent: hpPct });
    }
    case "fight":
      return t("onAir.match.spotlight.fight", { a: headline.params.a.name, b: headline.params.b.name });
    case "hit":
      return t("onAir.match.spotlight.hit", {
        attacker: headline.params.attacker.name,
        victim: headline.params.victim.name,
      });
    case "tower":
      return t("onAir.match.spotlight.tower", {
        count: headline.params.shots,
        target: headline.params.target.name,
        structure: structureText(headline.params.structure, t),
      });
    case "recall":
      return t("onAir.match.spotlight.recall", {
        count: wholeSeconds(headline.params.secondsLeft),
        champion: headline.params.champion.name,
      });
    case "down":
      return t("onAir.match.spotlight.down", { count: headline.params.seconds, champion: headline.params.champion.name });
    case "following": {
      const { champion, state, seconds } = headline.params;
      if (state === "dead") {
        return t("onAir.match.spotlight.following.dead", { count: seconds ?? 0, champion: champion.name });
      }
      if (state === "recall") {
        return t("onAir.match.spotlight.following.recall", { count: wholeSeconds(seconds ?? 0), champion: champion.name });
      }
      return t(FOLLOWING_KEYS[state], { champion: champion.name });
    }
  }
}

/** Level and health of the followed player, when both are known. */
export function followingDetail(headline: Engagement | FollowingLine | null, t: TFunction): string | null {
  if (!headline || headline.kind !== "following") return null;
  const { level, hpPct } = headline.params;
  return level === null || hpPct === null ? null : t("onAir.match.spotlight.detail", { level, percent: hpPct });
}

/** The short text of a chip: who and what, without the sentence around it. */
export function chipText(engagement: Engagement, t: TFunction, locale: string): string {
  switch (engagement.kind) {
    case "nexus":
      return t("onAir.match.spotlight.chip.nexus", { team: t(TEAM_KEYS[engagement.params.winner]) });
    case "objective":
      return t("onAir.match.spotlight.chip.objective", {
        names: listText(
          engagement.params.champions.map((champion) => champion.name),
          locale,
        ),
        objective: objectiveName(engagement.params, t),
      });
    case "fight":
      return t("onAir.match.spotlight.chip.fight", { a: engagement.params.a.name, b: engagement.params.b.name });
    case "hit":
      return t("onAir.match.spotlight.chip.hit", {
        attacker: engagement.params.attacker.name,
        victim: engagement.params.victim.name,
      });
    case "tower":
      return t("onAir.match.spotlight.chip.tower", {
        structure: structureText(engagement.params.structure, t),
        target: engagement.params.target.name,
      });
    case "recall":
      return t("onAir.match.spotlight.chip.recall", {
        champion: engagement.params.champion.name,
        seconds: wholeSeconds(engagement.params.secondsLeft),
      });
    case "down":
      return t("onAir.match.spotlight.chip.down", {
        champion: engagement.params.champion.name,
        seconds: engagement.params.seconds,
      });
  }
}
