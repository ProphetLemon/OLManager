import type { ScrimReportData } from "@/store/gameStore";
import type { DailyScrimAction } from "@/services/trainingService";

/**
 * What each post-scrim decision does to the report and to the five picked players, mirrored from
 * `apply_post_scrim_decision_internal` in `src-tauri/src/commands/squad.rs`. The numbers live in
 * this one table; `decisionEffects.parity.test.ts` reads the Rust source and fails when a number
 * here stops matching it, so the cards and the confirmation never show a delta the game does not apply.
 */
export type PostScrimDecisionName = "ContinuePlan" | "VodReview" | "MentalReset" | "TargetedDrills" | "PushThrough" | "DayOff";

export interface DecisionEffects {
  /** Added to the report quality (capped at 100). */
  quality: number;
  /** Added to the report severity (floored at 0); negative lowers it. */
  severity: number;
  /** Added to the morale of each picked player (capped at 100). */
  morale: number;
  /** Added to the condition of each picked player. */
  condition: number;
}

export const POST_DECISION_EFFECTS: Record<PostScrimDecisionName, DecisionEffects> = {
  ContinuePlan: { quality: 2, severity: 0, morale: 1, condition: 0 },
  VodReview: { quality: 6, severity: -1, morale: 1, condition: -1 },
  MentalReset: { quality: 0, severity: -2, morale: 4, condition: 3 },
  TargetedDrills: { quality: 10, severity: 0, morale: 0, condition: -3 },
  PushThrough: { quality: 12, severity: 0, morale: 0, condition: -6 },
  DayOff: { quality: 0, severity: -2, morale: 5, condition: 6 },
};

/** Push through after a severe or one-sided loss: condition and morale drop further. */
export const SEVERE_PUSH_THROUGH = { condition: -8, morale: -2 } as const;

/** When a loss counts as severe for Push through (`severe_or_context_push`). */
export const SEVERE_LOSS = { severity: 3, lossStreak: 3, reputationLead: 10 } as const;

/** Deciding the first block of a day with anything but Continue or Push through cancels the second block. */
export const NEXT_BLOCK_CANCELLATION = { reputation: -5, cancellations: 1 } as const;

/** The stored decision behind each button: "Offer rest" and "Day off" are both a `DayOff`. */
export const ACTION_DECISION: Record<Exclude<DailyScrimAction, "CancelScrims">, PostScrimDecisionName> = {
  ContinueToBlock2: "ContinuePlan",
  OfferRest: "DayOff",
  DayOff: "DayOff",
  PushThrough: "PushThrough",
  VodReview: "VodReview",
  MentalReset: "MentalReset",
  TargetedDrills: "TargetedDrills",
};

export function isSevereLoss(report: ScrimReportData, lossStreak: number, ownReputation: number, opponentReputation: number): boolean {
  return (
    report.won !== true
    && (report.severity >= SEVERE_LOSS.severity
      || lossStreak >= SEVERE_LOSS.lossStreak
      || ownReputation >= opponentReputation + SEVERE_LOSS.reputationLead)
  );
}

/** Whether choosing `action` on the first block cancels the second block (after Cancel scrims, every follow-up does). */
export function cancelsNextBlock(action: DailyScrimAction, isFirstBlock: boolean): boolean {
  return isFirstBlock && action !== "PushThrough" && action !== "ContinueToBlock2";
}

export interface DecisionEffectContext {
  isFirstBlock: boolean;
  report: ScrimReportData;
  lossStreak: number;
  ownReputation: number;
  opponentReputation: number;
  /** "B" on the first block of a day; null on the second. */
  nextBlockLabel: string | null;
}

export type EffectLine =
  | { kind: "quality"; delta: number }
  | { kind: "severity"; delta: number }
  | { kind: "players"; morale: number; condition: number }
  | { kind: "severeLoss" }
  | { kind: "cancelsNext"; label: string; reputation: number; cancellations: number }
  | { kind: "cancelStep"; label: string; reputation: number; cancellations: number }
  | { kind: "playsNext"; label: string }
  | { kind: "closesDay" };

/** Scrim reputation drops by 5 but never below 0. */
const reputationDrop = (ownReputation: number) => -Math.min(-NEXT_BLOCK_CANCELLATION.reputation, ownReputation);

/**
 * The lines a decision card shows: what it will do, as the game will do it. A quality that is
 * already at 100, or a severity already at 0, shows no line for that change.
 */
export function decisionEffectLines(action: DailyScrimAction, context: DecisionEffectContext): EffectLine[] {
  const { isFirstBlock, report, nextBlockLabel, ownReputation } = context;
  const cancellation = {
    label: nextBlockLabel ?? "B",
    reputation: reputationDrop(ownReputation),
    cancellations: NEXT_BLOCK_CANCELLATION.cancellations,
  };

  if (action === "CancelScrims") return [{ kind: "cancelStep", ...cancellation }];

  const effects = POST_DECISION_EFFECTS[ACTION_DECISION[action]];
  const lines: EffectLine[] = [];

  const quality = Math.min(effects.quality, 100 - report.quality);
  if (quality > 0) lines.push({ kind: "quality", delta: quality });

  const severity = -Math.min(-effects.severity, report.severity);
  if (severity < 0) lines.push({ kind: "severity", delta: severity });

  let { morale, condition } = effects;
  const severe = action === "PushThrough"
    && isSevereLoss(report, context.lossStreak, ownReputation, context.opponentReputation);
  if (severe) ({ morale, condition } = SEVERE_PUSH_THROUGH);
  if (morale !== 0 || condition !== 0) lines.push({ kind: "players", morale, condition });
  if (severe) lines.push({ kind: "severeLoss" });

  if (isFirstBlock) {
    if (cancelsNextBlock(action, true)) {
      lines.push({ kind: "cancelsNext", ...cancellation }, { kind: "closesDay" });
    } else {
      lines.push({ kind: "playsNext", label: cancellation.label });
    }
  } else {
    lines.push({ kind: "closesDay" });
  }
  return lines;
}
