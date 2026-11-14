import type { TFunction } from "i18next";

import type { ChampionRef } from "@/lib/match/live/engagementContext";
import type { FightBoardRow } from "@/lib/match/live/fightBoard";

import { structureText } from "./feedText";
import { TEAM_KEYS } from "./liveNames";

/**
 * The words of the Fight board, the map's text twin. A name always comes with its team in
 * words, because for a screen reader the board is the only place the map is told.
 */

export const BOARD_KIND_KEYS: Readonly<Record<Exclude<FightBoardRow["kind"], "quiet">, string>> = {
  contact: "onAir.match.board.kind.contact",
  turret: "onAir.match.board.kind.turret",
  recall: "onAir.match.board.kind.recall",
  dead: "onAir.match.board.kind.dead",
};

function who(champion: ChampionRef, t: TFunction): string {
  return t("onAir.match.board.who", { name: champion.name, team: t(TEAM_KEYS[champion.team]) });
}

const wholeSeconds = (seconds: number) => Math.max(0, Math.ceil(seconds));

export function boardRowText(row: FightBoardRow, t: TFunction): string {
  switch (row.kind) {
    case "contact": {
      const { a, b, mutual, hits } = row.params;
      // A hit is never "0 seconds ago": the freshest ones read as one second.
      const count = Math.max(1, Math.round(hits[0]?.ageSec ?? row.params.ageSec));
      if (mutual) return t("onAir.match.board.contactMutual", { count, a: who(a, t), b: who(b, t) });
      const hit = hits[0];
      return t("onAir.match.board.contactHit", {
        count,
        attacker: who(hit?.attacker ?? a, t),
        victim: who(hit?.victim ?? b, t),
      });
    }
    case "turret":
      return t("onAir.match.board.turret", {
        count: row.params.shots,
        structure: structureText(row.params.structure, t),
        target: who(row.params.target, t),
      });
    case "recall":
      return t("onAir.match.board.recall", {
        count: wholeSeconds(row.params.secondsLeft),
        champion: who(row.params.champion, t),
      });
    case "dead":
      return t("onAir.match.board.dead", { count: row.params.respawnSec, champion: who(row.params.champion, t) });
    case "quiet":
      return t("onAir.match.board.quiet");
  }
}

/**
 * The same row in a few words, for the strip where the sentence does not fit. Names only: the
 * team sits in the kind chip's strip and in the full sentence, which stays on the page for
 * assistive technology.
 */
export function boardRowShort(row: Exclude<FightBoardRow, { kind: "quiet" }>, t: TFunction): string {
  switch (row.kind) {
    case "contact": {
      const { a, b, mutual, hits } = row.params;
      if (mutual) return t("onAir.match.board.short.contact", { a: a.name, b: b.name });
      const hit = hits[0];
      return t("onAir.match.board.short.hit", { attacker: (hit?.attacker ?? a).name, victim: (hit?.victim ?? b).name });
    }
    case "turret":
      return t("onAir.match.board.short.turret", { target: row.params.target.name });
    case "recall":
      return t("onAir.match.board.short.recall", { champion: row.params.champion.name, seconds: wholeSeconds(row.params.secondsLeft) });
    case "dead":
      return t("onAir.match.board.short.dead", { champion: row.params.champion.name, seconds: row.params.respawnSec });
  }
}
