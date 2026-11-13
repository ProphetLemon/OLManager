import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import type { MarkerState } from "@/lib/match/live/championMarker";

/** The words a marker shows for a state. All three are empty for a champion with no state. */
export interface MarkerTexts {
  /** Second line of the full tag: "Recall 3.9s". */
  sub: string;
  /** Short state of the compact tag. Empty for a dead champion: the number is in the bubble. */
  subCompact: string;
  /** What the badge on the bubble says when no tag slot is free. Empty for a dead champion. */
  badge: string;
}

export const NO_TEXTS: MarkerTexts = { sub: "", subCompact: "", badge: "" };

/** Turns a marker state into its words, in the language of the screen. */
export function useMarkerTexts(): (state: MarkerState | null) => MarkerTexts {
  const { t, i18n } = useTranslation();
  const language = i18n.language;

  return useCallback(
    (state) => {
      if (!state) return NO_TEXTS;
      switch (state.kind) {
        case "dead":
          return { sub: t("onAir.match.state.dead", { seconds: state.seconds }), subCompact: "", badge: "" };
        case "recall": {
          const seconds = new Intl.NumberFormat(language, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
            state.seconds,
          );
          const badge = t("onAir.match.badge.recall", { seconds });
          return { sub: t("onAir.match.state.recall", { seconds }), subCompact: badge, badge };
        }
        case "fighting": {
          const badge = t("onAir.match.badge.fighting");
          return { sub: t("onAir.match.state.fighting"), subCompact: badge, badge };
        }
        case "objective": {
          const badge = t("onAir.match.badge.objective");
          return { sub: t("onAir.match.state.objective"), subCompact: badge, badge };
        }
      }
    },
    [t, language],
  );
}
