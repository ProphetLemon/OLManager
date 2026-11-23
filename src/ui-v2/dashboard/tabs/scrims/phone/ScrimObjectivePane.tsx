import { useId } from "react";
import { useTranslation } from "react-i18next";

import { SCRIM_FOCUS_IMPACT_KEYS, SCRIM_FOCUS_OBJECTIVE_KEYS } from "@/lib/scrims/scrimFocusKeys";
import type { ScrimFocus } from "@/store/gameStore";
import { LockLine, PaneHeading, PhoneChoice } from "./PhonePanePieces";

export interface ScrimObjectivePaneProps {
  objective: ScrimFocus | null;
  /** The setup is locked or the assistant handles it: the cards keep their place and cannot be changed. */
  disabled: boolean;
  /** Why it is locked; null while it can be edited. */
  blockedText: string | null;
  /** One tap saves; `null` is "No objective set". */
  onSelect: (next: ScrimFocus | null) => void;
}

// The same order as the desktop setup panel.
const OBJECTIVES: ScrimFocus[] = ["DraftPrep", "ChampionPool", "EarlyGame", "Teamfighting", "Macro", "Mental"];

/** Moment 3: the heading, its intro, seven radio cards in two columns and the impact of the chosen one in the eighth cell. */
export function ScrimObjectivePane({ objective, disabled, blockedText, onSelect }: ScrimObjectivePaneProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const impact = objective ? t(SCRIM_FOCUS_IMPACT_KEYS[objective]) : t("scrims.noFocusImpactText");

  return (
    <div data-slot="scrim-objective-pane" className="flex h-full min-h-0 flex-col gap-2 p-4">
      <PaneHeading id={headingId}>{t("training.scrims.weeklyObjective")}</PaneHeading>
      {blockedText ? <LockLine>{blockedText}</LockLine> : null}
      <p className="line-clamp-2 shrink-0 text-entry text-muted-foreground">{t("training.scrims.weeklyObjectiveDescription")}</p>
      <div role="radiogroup" aria-labelledby={headingId} className="grid min-h-0 grid-cols-2 gap-2">
        <PhoneChoice name="phone-objective" value="" mark="start" checked={objective === null} disabled={disabled} onSelect={() => onSelect(null)}>
          <span className="text-entry font-medium leading-tight">{t("training.scrims.objectives.none")}</span>
        </PhoneChoice>
        {OBJECTIVES.map((focus) => (
          <PhoneChoice
            key={focus}
            name="phone-objective"
            value={focus}
            mark="start"
            checked={objective === focus}
            disabled={disabled}
            onSelect={() => onSelect(focus)}
          >
            <span className="text-entry font-medium leading-tight">{t(SCRIM_FOCUS_OBJECTIVE_KEYS[focus])}</span>
          </PhoneChoice>
        ))}
        <p className="flex min-w-0 items-center px-3 text-entry leading-tight text-muted-foreground">
          <span>
            <strong className="font-semibold text-foreground">{t("scrims.impactLabel")}:</strong> {impact}
          </span>
        </p>
      </div>
    </div>
  );
}
