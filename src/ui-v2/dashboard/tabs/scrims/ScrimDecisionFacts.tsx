import { useTranslation } from "react-i18next";

import { SCRIM_FOCUS_OBJECTIVE_KEYS, SCRIM_ISSUE_KEYS } from "@/lib/scrims/scrimFocusKeys";
import type { ScrimReportData } from "@/store/gameStore";
import { ResultLetter } from "@/ui-v2/components/ResultLetter";
import { cn } from "@/ui-v2/lib/utils";

interface ScrimDecisionFactsProps {
  report: ScrimReportData;
  slotLabel: string;
  /** "A" or "B": the block this report is about. */
  blockLabel: string | null;
}

/**
 * The facts bar of a decision: the result, the slot, the report focus, its quality, the issue the
 * staff detected (after a loss only) and the block. It is not interactive.
 */
export function ScrimDecisionFacts({ report, slotLabel, blockLabel }: ScrimDecisionFactsProps) {
  const { t } = useTranslation();
  const won = Boolean(report.won);
  const heading = "font-heading text-section font-semibold uppercase leading-tight tracking-wide";

  const facts = [
    { id: "focus", label: t("scrims.reportFocus"), value: t(SCRIM_FOCUS_OBJECTIVE_KEYS[report.focus]), valueClass: heading },
    { id: "quality", label: t("scrims.reportQuality"), value: String(report.quality), valueClass: "font-heading text-section font-semibold leading-tight tabular-nums" },
    ...(report.issue
      ? [{ id: "issue", label: t("scrims.detectedIssue"), value: t(SCRIM_ISSUE_KEYS[report.issue]), valueClass: heading }]
      : []),
    ...(blockLabel
      ? [{ id: "block", label: t("scrims.block"), value: t("scrims.blockOfTwo", { label: blockLabel }), valueClass: heading }]
      : []),
  ];

  return (
    <dl
      data-slot="scrim-decision-facts"
      className="border-b border-line flex flex-wrap items-stretch"
    >
      <div className="flex items-center gap-3 border-e border-line px-4 py-3 sm:px-5">
        <span
          className={cn(
            "inline-flex items-center justify-center rounded-md font-heading font-bold leading-none size-11 text-3xl",
            won ? "bg-positive text-positive-foreground" : "bg-negative text-negative-foreground",
          )}
        >
          <ResultLetter kind={won ? "win" : "loss"} />
        </span>
        <div className="min-w-0">
          <dt className="sr-only">{t("scrims.reviewBlockTitle")}</dt>
          <dd className={heading}>{won ? t("scrims.reviewWin") : t("scrims.reviewLoss")}</dd>
          <dd className="text-caption text-muted-foreground">{slotLabel}</dd>
        </div>
      </div>
      {facts.map((fact) => (
        <div
          key={fact.id}
          className={cn("flex flex-col justify-center gap-0.5", cn("px-4 py-3 sm:px-5", fact.id !== "block" && "border-e border-line"))}
        >
          <dt className="text-caption text-muted-foreground">{fact.label}</dt>
          <dd className={fact.valueClass}>{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}
