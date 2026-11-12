import type { DailyScrimAction } from "@/services/trainingService";

export type ScrimTagKey =
  | "analysisPlus"
  | "fatigueMinus"
  | "fatiguePlus"
  | "issuePlus"
  | "learningPlus"
  | "mechanicsPlus"
  | "mentalMinus"
  | "mentalPlus"
  | "momentumPlus"
  | "qualityPlus"
  | "recoveryMinus"
  | "recoveryPlus"
  | "riskMinus"
  | "techniqueMinus"
  | "volumeMinus"
  | "volumePlus";

/**
 * The `scrims.tags.*` keys shown under each post-scrim decision. A tag's sign is
 * the literal direction of the quantity: another block and targeted drills cost
 * condition (`src-tauri/src/commands/squad.rs`, post-scrim decisions), so they
 * add fatigue; resting removes it.
 */
export const DECISION_IMPACT_TAGS: Record<DailyScrimAction, readonly ScrimTagKey[]> = {
  ContinueToBlock2: ["momentumPlus", "fatiguePlus", "volumePlus"],
  OfferRest: ["recoveryPlus", "fatigueMinus", "volumeMinus"],
  PushThrough: ["volumePlus", "learningPlus", "mentalMinus"],
  CancelScrims: ["recoveryPlus", "riskMinus", "volumeMinus"],
  VodReview: ["analysisPlus", "qualityPlus", "recoveryMinus"],
  MentalReset: ["mentalPlus", "recoveryPlus", "techniqueMinus"],
  TargetedDrills: ["issuePlus", "mechanicsPlus", "fatiguePlus"],
  DayOff: ["recoveryPlus", "mentalPlus", "volumeMinus"],
};

/** Quantities that hurt the team when they grow, so less of them is the benefit. */
const HARMFUL_QUANTITIES = ["fatigue", "risk"] as const;

/** Whether a tag is good news for the team, whatever its sign. */
export function isScrimTagBenefit(key: ScrimTagKey): boolean {
  const grows = key.endsWith("Plus");
  const harmful = HARMFUL_QUANTITIES.some((quantity) => key.startsWith(quantity));
  return harmful ? !grows : grows;
}
