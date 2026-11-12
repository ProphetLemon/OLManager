import type { DailyScrimAction } from "@/services/trainingService";
import { cancelsNextBlock } from "./decisionEffects";

/** The numbers of a scrim report and of the club before or after a decision, read from the game state. */
export interface DecisionSnapshot {
  quality: number;
  severity: number;
  reputation: number;
  cancellations: number;
}

export type ResultField = "quality" | "severity" | "reputation" | "cancellations";

export type ResultRow =
  | { kind: "change"; field: ResultField; before: number; after: number; cost: boolean }
  | { kind: "players"; morale: number; condition: number }
  | { kind: "block"; label: string; state: "cancelled" | "played" };

/** The sentence that closes the confirmation, by what the decision did to the rest of the day. */
export type ResultClosing = "blockTwoPlayed" | "nextReportLater" | "blockCancelled" | "dayClosed";

export interface DecisionResult {
  action: DailyScrimAction;
  rows: ResultRow[];
  closing: ResultClosing;
}

interface BuildDecisionResultInput {
  action: Exclude<DailyScrimAction, "CancelScrims">;
  isFirstBlock: boolean;
  before: DecisionSnapshot;
  after: DecisionSnapshot;
  /** Morale and condition each picked player received, as the game applied them. */
  players: { morale: number; condition: number };
  nextBlockLabel: string | null;
  /** Whether the game now holds an undecided report for the second block. */
  nextReportWaiting: boolean;
}

const CHANGED_FIELDS: Array<{ field: ResultField; cost: boolean }> = [
  { field: "quality", cost: false },
  { field: "severity", cost: false },
  { field: "reputation", cost: true },
  { field: "cancellations", cost: true },
];

/**
 * What changed once a decision landed. The before and after numbers are the game's own, read from
 * the state the decision returned; the effects on the picked players come from the engine table
 * (as the card showed them), since the state keeps no history of their morale and condition.
 */
export function buildDecisionResult(input: BuildDecisionResultInput): DecisionResult {
  const { action, isFirstBlock, before, after, players, nextBlockLabel, nextReportWaiting } = input;
  const rows: ResultRow[] = [];

  for (const { field, cost } of CHANGED_FIELDS) {
    if (before[field] !== after[field]) rows.push({ kind: "change", field, before: before[field], after: after[field], cost });
  }
  if (players.morale !== 0 || players.condition !== 0) rows.push({ kind: "players", ...players });

  const cancelled = cancelsNextBlock(action, isFirstBlock);
  if (isFirstBlock && nextBlockLabel) {
    if (cancelled) rows.push({ kind: "block", label: nextBlockLabel, state: "cancelled" });
    else if (nextReportWaiting) rows.push({ kind: "block", label: nextBlockLabel, state: "played" });
  }

  let closing: ResultClosing;
  if (!isFirstBlock) closing = "dayClosed";
  else if (cancelled) closing = "blockCancelled";
  else closing = nextReportWaiting ? "blockTwoPlayed" : "nextReportLater";

  return { action, rows, closing };
}
