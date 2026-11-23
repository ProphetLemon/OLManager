import type { DailyScrimAction } from "@/services/trainingService";

/** The `scrims.decision.*` locale key of each daily decision (its description is the same key plus `Desc`). */
export const DECISION_TEXT_KEY: Record<DailyScrimAction, string> = {
  ContinueToBlock2: "continueBlock2",
  OfferRest: "offerRest",
  PushThrough: "pushThrough",
  CancelScrims: "cancelScrims",
  VodReview: "vodReview",
  MentalReset: "mentalReset",
  TargetedDrills: "targetedDrills",
  DayOff: "dayOff",
};
