import type { ScrimFocus } from "@/store/gameStore";

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
