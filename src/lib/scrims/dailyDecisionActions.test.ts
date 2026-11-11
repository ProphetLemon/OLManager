import { describe, expect, it } from "vitest";
import { dailyScrimDecisionActions } from "@/lib/scrims/dailyDecisionActions";
import type { DailyScrimAction } from "@/services/trainingService";

// Events `olm_core::scrim_flow::transition_daily_scrim_flow` accepts per decision state;
// `decision_states_accept_exactly_the_events_the_ui_offers` pins the same table in Rust.
const ACCEPTED: Record<string, DailyScrimAction[]> = {
  Block1GoodDecision: ["OfferRest", "ContinueToBlock2"],
  Block1BadDecision: ["PushThrough", "CancelScrims"],
  // CancelScrims is not persisted: the backend reads its follow-ups as this state.
  Block1BadCancelDecision: ["VodReview", "MentalReset", "TargetedDrills"],
  Block2GoodDecision: ["DayOff"],
  Block2BadDecision: ["DayOff", "VodReview", "MentalReset", "TargetedDrills"],
};

const SCREENS = [
  { state: "Block1GoodDecision", context: { isFirstBlock: true, won: true, showCancelFollowups: false } },
  { state: "Block1BadDecision", context: { isFirstBlock: true, won: false, showCancelFollowups: false } },
  { state: "Block1BadCancelDecision", context: { isFirstBlock: true, won: false, showCancelFollowups: true } },
  { state: "Block2GoodDecision", context: { isFirstBlock: false, won: true, showCancelFollowups: false } },
  { state: "Block2BadDecision", context: { isFirstBlock: false, won: false, showCancelFollowups: false } },
] as const;

describe("dailyScrimDecisionActions", () => {
  it.each(SCREENS)("offers only the events the backend accepts in $state", ({ state, context }) => {
    const offered = dailyScrimDecisionActions(context);
    expect([...offered].sort()).toEqual([...ACCEPTED[state]].sort());
  });
});
