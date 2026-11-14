import { ChevronsLeft, ChevronsRight, Equal } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { LanePush, LaneView } from "@/lib/match/live/laneStrip";
import type { LaneKey, TeamSide } from "@/lib/match/live/mapGeometry";
import type { TeamIdentity } from "@/lib/match/live/teamIdentity";

import { TEAM_KEYS } from "./liveNames";
import "./liveMatch.css";

const LANE_NAME_KEYS: Readonly<Record<LaneKey, string>> = {
  top: "onAir.match.lanes.top",
  mid: "onAir.match.lanes.mid",
  bot: "onAir.match.lanes.bot",
};

/** The sentence of a cell: what the wave does, with or without a fight. Literal keys, so the key guard sees them. */
const ARIA_KEYS: Readonly<Record<"none" | "even" | "push", { calm: string; fight: string }>> = {
  none: { calm: "onAir.match.lanes.aria.none", fight: "onAir.match.lanes.aria.noneFight" },
  even: { calm: "onAir.match.lanes.aria.even", fight: "onAir.match.lanes.aria.evenFight" },
  push: { calm: "onAir.match.lanes.aria.push", fight: "onAir.match.lanes.aria.pushFight" },
};

const TEXT_KEYS: Readonly<Record<"none" | "even", string>> = {
  none: "onAir.match.lanes.none",
  even: "onAir.match.lanes.even",
};

/** The mark runs between the two ends of the track, never onto them. */
const markLeft = (front: number): string => `${(14 + Math.max(0, Math.min(1, front)) * 72).toFixed(1)}%`;

const isSide = (push: LanePush): push is TeamSide => push === "blue" || push === "red";

export interface LaneStripProps {
  lanes: readonly LaneView[];
  blue: TeamIdentity;
  red: TeamIdentity;
}

/**
 * Above the map, one cell per lane: a track from the blue base (a circle) to the red base (a
 * diamond), a mark where the two waves meet with arrows toward the side being pushed, the club
 * that pushes, and a double frame with the word Fight while champions fight there. Each cell is
 * one image whose label says it all in a sentence; the picture is not read twice. State is
 * carried by the arrows, the words and the frame, never by colour alone.
 */
export function LaneStrip({ lanes, blue, red }: LaneStripProps) {
  const { t } = useTranslation();
  const identities = { blue, red };
  return (
    <div className="arena-lanes" role="group" aria-label={t("onAir.match.lanes.label")} data-testid="lane-strip">
      {lanes.map((lane) => {
        const pusher = isSide(lane.push) ? identities[lane.push] : null;
        const target = isSide(lane.push) ? t(TEAM_KEYS[lane.push === "blue" ? "red" : "blue"]) : "";
        const name = t(LANE_NAME_KEYS[lane.lane]);
        const kind = pusher ? "push" : lane.push === "even" ? "even" : "none";
        const sentence = t(ARIA_KEYS[kind][lane.fight ? "fight" : "calm"], { lane: name, team: pusher?.name, target });
        return (
          <div
            key={lane.lane}
            className="arena-lane"
            data-lane={lane.lane}
            data-push={lane.push}
            data-fight={lane.fight || undefined}
            role="img"
            aria-label={sentence}
          >
            <b className="arena-lane-name" aria-hidden="true">
              {name}
            </b>
            <span className="arena-lane-track" aria-hidden="true">
              <i className="arena-lane-end" data-team="blue" />
              <i className="arena-lane-end" data-team="red" />
              {lane.front !== null ? (
                <span className="arena-lane-mark" style={{ left: markLeft(lane.front) }}>
                  {lane.push === "blue" ? <ChevronsRight /> : lane.push === "red" ? <ChevronsLeft /> : <Equal />}
                </span>
              ) : null}
            </span>
            {pusher?.logoUrl ? <img className="arena-lane-logo" src={pusher.logoUrl} alt="" draggable={false} /> : null}
            <span className="arena-lane-text" aria-hidden="true">
              {pusher ? t("onAir.match.lanes.push", { team: pusher.tag }) : t(TEXT_KEYS[lane.push === "even" ? "even" : "none"])}
            </span>
            {lane.fight ? (
              <span className="arena-lane-fight" aria-hidden="true">
                {t("onAir.match.lanes.fight")}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
