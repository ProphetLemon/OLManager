import type { TFunction } from "i18next";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { formatCountdown } from "@/lib/match/live/clock";
import type { TeamSide } from "@/lib/match/live/mapGeometry";
import type { ObjectivesStateLike } from "@/lib/match/live/objectivesView";
import { timerRailView, type RailTimer } from "@/lib/match/live/timerRail";
import type { TeamIdentity } from "@/lib/match/live/teamIdentity";
import { NEUTRAL_OBJECTIVE_ICON_PATH } from "@/lib/match/lolMapLayout";

import { DRAGON_NAME_KEYS, DRAGON_PLAIN_KEY } from "./liveNames";
import "./liveMatch.css";

const NAME_KEYS = {
  elder: "match.draftResult.timelineEvents.elder",
  voidgrubs: "onAir.match.pit.voidgrubs",
  herald: "match.draftResult.timelineEvents.herald",
  baron: "match.draftResult.timelineEvents.baron",
} as const;

const BUFF_NAME_KEYS = {
  baron: NAME_KEYS.baron,
  elder: NAME_KEYS.elder,
} as const;

function iconOf(timer: RailTimer): string {
  switch (timer.entity) {
    case "dragon":
      return timer.dragonKind ? NEUTRAL_OBJECTIVE_ICON_PATH[`dragon_${timer.dragonKind}`] : NEUTRAL_OBJECTIVE_ICON_PATH.dragon;
    case "elder":
      return NEUTRAL_OBJECTIVE_ICON_PATH.dragon_elder;
    case "voidgrubs":
      return NEUTRAL_OBJECTIVE_ICON_PATH.grub;
    case "herald":
      return NEUTRAL_OBJECTIVE_ICON_PATH.riftherald;
    case "baron":
      return NEUTRAL_OBJECTIVE_ICON_PATH.baron;
  }
}

function nameOf(timer: RailTimer, t: TFunction): string {
  if (timer.entity === "dragon") return t(timer.dragonKind ? DRAGON_NAME_KEYS[timer.dragonKind] : DRAGON_PLAIN_KEY);
  return t(NAME_KEYS[timer.entity]);
}

function valueOf(timer: RailTimer, t: TFunction): string {
  const { status } = timer;
  if (status.state === "countdown") return formatCountdown(status.seconds);
  if (status.state === "none") return t("onAir.match.rail.gone");
  return status.hpPct === null ? t("onAir.match.pit.upNoPercent") : t("onAir.match.pit.up", { percent: status.hpPct });
}

export interface TimerRailProps {
  state: ObjectivesStateLike;
  blue: TeamIdentity;
  red: TeamIdentity;
}

/**
 * The objective timers, always on show: the dragon (the Elder once it is unlocked), the
 * Voidgrubs, the Herald and Baron, each with the time until it appears, or its health while it
 * is up, or "Gone". A running Baron or Elder buff and the Herald's carrier sit on the tile as a
 * team tag (the side's shape says the side). The tiles are always the same four, so nothing
 * moves when one changes. A tile that is up has a heavy frame and one that is over a dashed
 * frame, besides what the words say. Not a live region: the clocks tick.
 */
export function TimerRail({ state, blue, red }: TimerRailProps) {
  const { t } = useTranslation();
  const timers = useMemo(() => timerRailView(state), [state]);
  const identities: Record<TeamSide, TeamIdentity> = { blue, red };

  return (
    <ul className="arena-rail" aria-label={t("onAir.match.rail.label")} data-testid="timer-rail">
      {timers.map((timer) => {
        const buff = timer.buff;
        const buffName = buff ? t(BUFF_NAME_KEYS[timer.entity === "baron" ? "baron" : "elder"]) : "";
        return (
          <li key={timer.id} className="arena-rail-tile" data-timer={timer.id} data-status={timer.status.state}>
            <img className="arena-rail-icon" src={iconOf(timer)} alt="" draggable={false} />
            <span className="arena-rail-text">
              <small className="arena-rail-label">{nameOf(timer, t)}</small>
              <b className="arena-rail-value">{valueOf(timer, t)}</b>
            </span>
            {timer.carrier ? (
              <span
                className="arena-rail-tag"
                data-team={timer.carrier}
                role="img"
                aria-label={t("onAir.match.rail.carriedBy", { team: identities[timer.carrier].name })}
              >
                {identities[timer.carrier].tag}
              </span>
            ) : null}
            {buff ? (
              <span
                className="arena-rail-tag"
                data-team={buff.side}
                role="img"
                aria-label={t("onAir.match.rail.buffHeld", {
                  name: buffName,
                  team: identities[buff.side].name,
                  time: formatCountdown(buff.remainingSec),
                })}
              >
                {identities[buff.side].tag} {formatCountdown(buff.remainingSec)}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
