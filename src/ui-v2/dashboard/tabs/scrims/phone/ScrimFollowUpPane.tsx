import { useId } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";

import type { DailyScrimAction } from "@/services/trainingService";
import { Button } from "@/ui-v2/components/ui/button";
import { CostMark, signed } from "../EffectText";
import type { DecisionOption } from "../ScrimDecisionPanel";
import { PaneHeading } from "./PhonePanePieces";
import { PhoneDecisionCard } from "./PhoneDecisionCard";

export interface ScrimFollowUpPaneProps {
  /** The follow-ups of Cancel scrims, from the existing rules. */
  options: readonly DecisionOption[];
  savingId: DailyScrimAction | null;
  onDecide: (id: DailyScrimAction) => void;
  /** Leaves the step for the block decision. Nothing was applied yet. */
  onBack: () => void;
}

/**
 * Moment 6: the step "Cancel scrims" opens before anything is applied. The heading carries the cost
 * (said once, with its mark), the follow-ups are rows that scroll when they grow, and "Back to block
 * decision" is pinned at the bottom so it never leaves the screen.
 */
export function ScrimFollowUpPane({ options, savingId, onDecide, onBack }: ScrimFollowUpPaneProps) {
  const { t } = useTranslation();
  const headingId = useId();
  // Every follow-up cancels the next block alike, so the first one's line says it for all.
  const cancel = options.flatMap((option) => option.effects).find((line) => line.kind === "cancelsNext");

  return (
    <section
      data-slot="scrim-followup-pane"
      role="group"
      aria-labelledby={headingId}
      className="flex h-full min-h-0 flex-col gap-2 p-2"
    >
      <div className="flex shrink-0 flex-col gap-0.5 px-2">
        <PaneHeading id={headingId}>{t("scrims.cancelFollowupTitle")}</PaneHeading>
        {cancel?.kind === "cancelsNext" ? (
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 text-entry leading-tight text-muted-foreground">
              {t("scrims.effect.cancelsNext", { label: cancel.label, rep: signed(cancel.reputation), count: cancel.cancellations })}
            </p>
            <CostMark className="shrink-0" />
          </div>
        ) : null}
      </div>
      <div data-slot="decision-scroll" className="min-h-0 flex-1 overflow-y-auto">
        <ul className="flex flex-col gap-2">
          {options.map((option) => (
            <PhoneDecisionCard
              key={option.id}
              option={option}
              layout="row"
              saving={savingId === option.id}
              locked={savingId !== null}
              onDecide={() => onDecide(option.id)}
            />
          ))}
        </ul>
      </div>
      <Button type="button" variant="outline" size="touch" className="shrink-0 justify-start font-heading text-entry uppercase tracking-wide" onClick={onBack}>
        <ArrowLeft aria-hidden="true" />
        {t("scrims.backToBlockDecision")}
      </Button>
    </section>
  );
}
