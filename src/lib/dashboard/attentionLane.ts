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
 * The "Before you continue" lane (R24). It shows only while something needs a
 * decision, off Home (whose panel is the full list), outside the end-of-season
 * shell and with at least LANE_MIN_BODY_PX of body. Notices never get a pill.
 */
export function laneModel({ callState, activeTab, compact, bodyHeight }: LaneModelInput): LaneModel {
  const count = callState.count;
  const visible = count > 0 && activeTab !== "Home" && !compact && bodyHeight >= LANE_MIN_BODY_PX;
  if (!visible) return { visible, pills: [], count };
  const pills: LanePill[] = callState.decisionItems.map((item) => ({ kind: "call", id: item.id, item }));
  pills.push({ kind: "home", id: "lane:home", count });
  return { visible, pills, count };
}
