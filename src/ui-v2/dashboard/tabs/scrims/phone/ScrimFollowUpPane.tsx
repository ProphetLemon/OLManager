import { useTranslation } from "react-i18next";

import type { DailyScrimAction } from "@/services/trainingService";
import type { ScrimReportData } from "@/store/gameStore";
import type { DecisionOption } from "../ScrimDecisionPanel";
import { CancelNote, PhoneDecisionCard } from "./PhoneDecisionCard";
import { ScrimViewFrame } from "./ScrimViewFrame";

export interface ScrimFollowUpPaneProps {
  /** "Cancel scrims": the frame's heading and the name of its back control. */
  title: string;
  /** Back to the decision, not to Semana: nothing was applied yet. */
  onBack: () => void;
  report: ScrimReportData;
  /** The follow-ups of Cancel scrims, from the existing rules. One to three. */
  options: readonly DecisionOption[];
  savingId: DailyScrimAction | null;
  onDecide: (id: DailyScrimAction) => void;
}

/**
 * Seguimiento (frame FollowUp): the step Cancel scrims opens before anything is applied. The top row
 * carries the cost mark and what any follow-up will cancel; under it the prompt and one row per
 * follow-up between hairlines, each a real button with its chevron.
 */
export function ScrimFollowUpPane({ title, onBack, report, options, savingId, onDecide }: ScrimFollowUpPaneProps) {
  const { t } = useTranslation();
  // Every follow-up cancels the next block alike, so the first one's line says it for all.
  const cancel = options.flatMap((option) => option.effects).find((line) => line.kind === "cancelsNext");

  return (
    <ScrimViewFrame title={title} onBack={onBack} actions={cancel?.kind === "cancelsNext" ? <CancelNote line={cancel} /> : null}>
      <section data-slot="scrim-followup-pane" role="group" aria-label={title} className="flex h-full min-h-0 flex-col pb-3 pt-2">
        <p data-slot="followup-prompt" className="m-0 shrink-0 px-2 pb-1 font-heading text-section font-semibold leading-tight">
          {t("scrims.cancelFollowupPrompt")}
        </p>
        <ul className="m-0 flex min-h-0 flex-1 list-none flex-col p-0">
          {options.map((option) => (
            <PhoneDecisionCard
              key={option.id}
              option={option}
              layout="hairline"
              report={report}
              reputation={0}
              saving={savingId === option.id}
              locked={savingId !== null}
              onDecide={() => onDecide(option.id)}
            />
          ))}
        </ul>
      </section>
    </ScrimViewFrame>
  );
}
