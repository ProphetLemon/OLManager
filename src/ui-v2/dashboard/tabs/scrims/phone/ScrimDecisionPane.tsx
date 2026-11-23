import { useId } from "react";
import { useTranslation } from "react-i18next";

import type { ScrimReportData } from "@/store/gameStore";
import type { DailyScrimAction } from "@/services/trainingService";
import type { DecisionOption } from "../ScrimDecisionPanel";
import { ScrimDecisionFacts } from "../ScrimDecisionFacts";
import { LockLine } from "./PhonePanePieces";
import { PhoneDecisionCard } from "./PhoneDecisionCard";

export interface ScrimDecisionPaneProps {
  report: ScrimReportData;
  /** "Wed A": the block the report is about. */
  slotLabel: string;
  /** "A" or "B". */
  blockLabel: string | null;
  /** The choices from the existing rules, with their effect lines. */
  options: readonly DecisionOption[];
  /** The decision being saved, if any. */
  savingId: DailyScrimAction | null;
  onDecide: (id: DailyScrimAction) => void;
  /** The second block: the choices are rows under "Close day" instead of cards. */
  closeDay: boolean;
  /** The reputation the dashed mark shows after a cancel; null draws no note on Cancel scrims. */
  ghostReputation: number | null;
  lockText: string | null;
}

/**
 * Moment 5: the facts bar fixed on top, the choices stacked under it (they scroll inside the pane
 * when four do not fit), and the lock sentence last, on one line, the first thing to give way. The
 * heading is visually hidden: the facts bar is the pane's top, but the parent can still focus the heading.
 */
export function ScrimDecisionPane({
  report,
  slotLabel,
  blockLabel,
  options,
  savingId,
  onDecide,
  closeDay,
  ghostReputation,
  lockText,
}: ScrimDecisionPaneProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const title = closeDay ? t("scrims.closeDayTitle") : t("scrims.blockDecisionTitle");

  return (
    <section
      data-slot="scrim-decision-pane"
      role="group"
      aria-labelledby={headingId}
      className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto pb-2"
    >
      <h2 id={headingId} tabIndex={-1} data-pane-heading="" className="sr-only">
        {title}
      </h2>
      <ScrimDecisionFacts report={report} slotLabel={slotLabel} blockLabel={blockLabel} compact />
      <div data-slot="decision-scroll" className="min-h-0 flex-1 overflow-y-auto px-2">
        <ul className="flex flex-col gap-2">
          {options.map((option) => (
            <PhoneDecisionCard
              key={option.id}
              option={option}
              layout={closeDay ? "row" : "card"}
              saving={savingId === option.id}
              locked={savingId !== null}
              onDecide={() => onDecide(option.id)}
              note={option.id === "CancelScrims" && ghostReputation !== null ? t("scrims.repGhostNote", { value: ghostReputation }) : null}
            />
          ))}
        </ul>
      </div>
      {lockText ? <LockLine className="px-4">{lockText}</LockLine> : null}
    </section>
  );
}
