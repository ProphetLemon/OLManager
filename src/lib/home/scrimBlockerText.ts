import i18n from "@/i18n";
import { SCRIM_SETUP_BLOCKER_ID } from "./blockerRules";

/** Localized text of a scrim stop; the one place the English defaults live. */
export function scrimBlockerText(id: string): string {
  return id === SCRIM_SETUP_BLOCKER_ID
    ? i18n.t("advance.blockers.scrimSetup", {
        defaultValue:
          "Define the weekly scrim setup (objective and rivals) or delegate the advance to continue.",
      })
    : i18n.t("advance.blockers.scrimDecision", {
        defaultValue: "Make a scrim decision before continuing.",
      });
}
