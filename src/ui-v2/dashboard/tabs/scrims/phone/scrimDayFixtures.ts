import { dailyScrimDecisionActions } from "@/lib/scrims/dailyDecisionActions";
import { decisionEffectLines, type DecisionEffectContext } from "@/lib/scrims/decisionEffects";
import type { ScrimReportData } from "@/store/gameStore";
import i18n from "@/i18n";
import type { DecisionOption } from "../ScrimDecisionPanel";

const KEY = {
  ContinueToBlock2: "continueBlock2",
  OfferRest: "offerRest",
  PushThrough: "pushThrough",
  CancelScrims: "cancelScrims",
  VodReview: "vodReview",
  MentalReset: "mentalReset",
  TargetedDrills: "targetedDrills",
  DayOff: "dayOff",
} as const;

/** A report of block A, lost by default, as the game stores it. */
export function makeReport(over: Partial<ScrimReportData> = {}): ScrimReportData {
  return {
    date: "2026-01-06",
    week_key: "2026-w1",
    slot_index: 0,
    weekday: 2,
    team_id: "me",
    opponent_team_id: "mvk",
    status: "Played",
    won: false,
    focus: "EarlyGame",
    issue: "LanePressure",
    severity: 2,
    quality: 61,
    player_champion_picks: [],
    post_decision: null,
    created_on: "2026-01-06",
    ...over,
  } as ScrimReportData;
}

/** The options the tab would build for a block: the real rules, the real effect lines, the real texts. */
export function makeOptions(opts: { isFirstBlock: boolean; won: boolean; showCancelFollowups?: boolean; report?: ScrimReportData }): DecisionOption[] {
  const report = opts.report ?? makeReport({ won: opts.won });
  const context: DecisionEffectContext = {
    isFirstBlock: opts.isFirstBlock,
    report,
    lossStreak: 1,
    ownReputation: 50,
    opponentReputation: 50,
    nextBlockLabel: opts.isFirstBlock ? "B" : null,
  };
  return dailyScrimDecisionActions({ isFirstBlock: opts.isFirstBlock, won: opts.won, showCancelFollowups: Boolean(opts.showCancelFollowups) }).map((id) => ({
    id,
    label: i18n.t(`scrims.decision.${KEY[id]}`),
    description: i18n.t(`scrims.decision.${KEY[id]}Desc`),
    effects: decisionEffectLines(id, context),
  }));
}
