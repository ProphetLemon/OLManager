import type { ScrimFocus, ScrimIssue } from "@/store/gameStore";

/** One impact text per focus the backend can send; the record stops compiling when a variant is added. */
export const SCRIM_FOCUS_IMPACT_KEYS: Record<ScrimFocus, string> = {
  DraftPrep: "scrims.impact.DraftPrep",
  ChampionPool: "scrims.impact.ChampionPool",
  EarlyGame: "scrims.impact.EarlyGame",
  Teamfighting: "scrims.impact.Teamfighting",
  Macro: "scrims.impact.Macro",
  Mental: "scrims.impact.Mental",
};

/** The objective label of each focus, under `training.scrims.objectives`. */
export const SCRIM_FOCUS_OBJECTIVE_KEYS: Record<ScrimFocus, string> = {
  DraftPrep: "training.scrims.objectives.draftPrep",
  ChampionPool: "training.scrims.objectives.championPool",
  EarlyGame: "training.scrims.objectives.earlyGame",
  Teamfighting: "training.scrims.objectives.teamfighting",
  Macro: "training.scrims.objectives.macro",
  Mental: "training.scrims.objectives.mental",
};

/** The name of each issue a scrim report can detect, as the weekly staff report words it. */
export const SCRIM_ISSUE_KEYS: Record<ScrimIssue, string> = {
  DraftGap: "be.msg.scrimWeekly.issues.draftGap",
  LanePressure: "be.msg.scrimWeekly.issues.lanePressure",
  ObjectiveSetup: "be.msg.scrimWeekly.issues.objectiveSetup",
  TeamfightExecution: "be.msg.scrimWeekly.issues.teamfightExecution",
  ChampionComfort: "be.msg.scrimWeekly.issues.championComfort",
  Tilt: "be.msg.scrimWeekly.issues.tilt",
};
