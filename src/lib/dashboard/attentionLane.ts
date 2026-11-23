import type { CallItem, CallState } from "./needsYourCall";

/** Below this body height (the slot useRailMode measures) the lane gives way, and the chip stays the entry (R24). */
export const LANE_MIN_BODY_PX = 380;

/** One pill of the lane: a decision, or the pinned "All N on Home" at the end. */
export type LanePill =
  | { kind: "call"; id: string; item: CallItem }
  | { kind: "home"; id: "lane:home"; count: number };

export interface LaneModelInput {
  callState: CallState;
  activeTab: string;
  /** A player, team, staff or champion page is open over the tab. */
  profileOpen: boolean;
  /** The end-of-season shell. */
  compact: boolean;
  bodyHeight: number;
}

export interface LaneModel {
  visible: boolean;
  pills: LanePill[];
  /** The chip's number, decisions hidden by the contract cap included. */
  count: number;
}

/**
 * Whether Home's content, with its "Needs your call" panel, is on screen: Home
 * with nothing open over it. The lane (R58) and the R42 announcement both ask
 * this, so a profile opened from Home counts as off Home for both.
 */
export function isHomeOnScreen({ activeTab, profileOpen }: Pick<LaneModelInput, "activeTab" | "profileOpen">): boolean {
  return activeTab === "Home" && !profileOpen;
}

/**
 * The "Before you continue" lane (R24). It shows only while something needs a
 * decision, while Home's panel (the full list) is not on screen (R58), outside
 * the end-of-season shell and with at least LANE_MIN_BODY_PX of body. Notices
 * never get a pill.
 */
export function laneModel({ callState, activeTab, profileOpen, compact, bodyHeight }: LaneModelInput): LaneModel {
  const count = callState.count;
  const visible =
    count > 0 && !isHomeOnScreen({ activeTab, profileOpen }) && !compact && bodyHeight >= LANE_MIN_BODY_PX;
  if (!visible) return { visible, pills: [], count };
  const pills: LanePill[] = callState.decisionItems.map((item) => ({ kind: "call", id: item.id, item }));
  pills.push({ kind: "home", id: "lane:home", count });
  return { visible, pills, count };
}
