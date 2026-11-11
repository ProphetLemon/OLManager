import type { DailyScrimAction } from "@/services/trainingService";

interface DailyDecisionContext {
  isFirstBlock: boolean;
  won: boolean;
  showCancelFollowups: boolean;
}

/**
 * Actions the daily scrim decision screen offers. They must match the events the backend
 * flow (`olm_core::scrim_flow`) accepts for the state this screen stands for.
 */
export function dailyScrimDecisionActions({ isFirstBlock, won, showCancelFollowups }: DailyDecisionContext): DailyScrimAction[] {
  if (isFirstBlock && !won && !showCancelFollowups) return ["PushThrough", "CancelScrims"];
  if (isFirstBlock && won) return ["ContinueToBlock2", "OfferRest"];
  if (showCancelFollowups) return ["VodReview", "MentalReset", "TargetedDrills"];
  if (won) return ["DayOff"];
  return ["DayOff", "VodReview", "MentalReset", "TargetedDrills"];
}
