import { useId } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";

import type { DecisionResult } from "@/lib/scrims/decisionResult";
import { Button } from "@/ui-v2/components/ui/button";
import { ScrimDecisionResult } from "../ScrimDecisionResult";
import { PaneHeading } from "./PhonePanePieces";

export interface ScrimResultPaneProps {
  result: DecisionResult;
  /** "Decision applied to scrim block: …": the only live line of the pane. */
  statusText: string;
  /** "Wed B" when the next block was played and waits for its decision; null otherwise. */
  nextSlotLabel: string | null;
  onDecideNext: () => void;
}

/** Moment 7: what a decision changed, in the pane where the cards were, and one outline button to the next decision when there is one. */
export function ScrimResultPane({ result, statusText, nextSlotLabel, onDecideNext }: ScrimResultPaneProps) {
  const { t } = useTranslation();
  const headingId = useId();

  return (
    <section
      data-slot="scrim-result-pane"
      role="group"
      aria-labelledby={headingId}
      className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto p-2"
    >
      <ScrimDecisionResult
        compact
        result={result}
        statusText={statusText}
        heading={<PaneHeading id={headingId}>{t("scrims.whatChanged")}</PaneHeading>}
      />
      {nextSlotLabel ? (
        <Button type="button" variant="outline" size="touch" className="shrink-0 justify-between font-heading text-entry uppercase tracking-wide" onClick={onDecideNext}>
          {t("scrims.phone.decideSlot", { slot: nextSlotLabel })}
          <ChevronRight aria-hidden="true" />
        </Button>
      ) : null}
    </section>
  );
}
