import { useTranslation } from "react-i18next";

import { DECISION_IMPACT_TAGS } from "@/lib/scrims/decisionTags";
import { SCRIM_FOCUS_OBJECTIVE_KEYS, SCRIM_ISSUE_KEYS } from "@/lib/scrims/scrimFocusKeys";
import type { ScrimReportData } from "@/store/gameStore";
import type { DailyScrimAction } from "@/services/trainingService";
import { ResultLetter } from "@/ui-v2/components/ResultLetter";
import { cn } from "@/ui-v2/lib/utils";
import { ScrimTag } from "./ScrimTag";

export interface DecisionOption {
  id: DailyScrimAction;
  label: string;
  description: string;
}

interface ScrimDecisionPanelProps {
  report: ScrimReportData;
  slotLabel: string;
  /** "A" or "B": the block this report is about. */
  blockLabel: string | null;
  prompt: string | null;
  options: DecisionOption[];
  savingId: DailyScrimAction | null;
  onDecide: (id: DailyScrimAction) => void;
}

/** Decision body of the wide column: the block that was just played and the calls the manager can make. */
export function ScrimDecisionPanel({
  report,
  slotLabel,
  blockLabel,
  prompt,
  options,
  savingId,
  onDecide,
}: ScrimDecisionPanelProps) {
  const { t } = useTranslation();
  const won = Boolean(report.won);

  return (
    <div>
      <dl className="flex flex-wrap items-stretch border-b border-line">
        <div className="flex items-center gap-3 border-e border-line px-4 py-3 sm:px-5">
          <span
            className={cn(
              "inline-flex size-11 items-center justify-center rounded-md font-heading text-3xl font-bold leading-none",
              won ? "bg-positive text-positive-foreground" : "bg-negative text-negative-foreground",
            )}
          >
            <ResultLetter kind={won ? "win" : "loss"} />
          </span>
          <div>
            <dt className="sr-only">{t("scrims.reviewBlockTitle")}</dt>
            <dd className="font-heading text-section font-semibold uppercase leading-tight tracking-wide">
              {won ? t("scrims.reviewWin") : t("scrims.reviewLoss")}
            </dd>
            <dd className="text-caption text-muted-foreground">{slotLabel}</dd>
          </div>
        </div>
        <div className="flex flex-col justify-center gap-0.5 border-e border-line px-4 py-3 sm:px-5">
          <dt className="text-caption text-muted-foreground">{t("scrims.reportFocus")}</dt>
          <dd className="font-heading text-section font-semibold uppercase leading-tight tracking-wide">
            {t(SCRIM_FOCUS_OBJECTIVE_KEYS[report.focus])}
          </dd>
        </div>
        <div className="flex flex-col justify-center gap-0.5 border-e border-line px-4 py-3 sm:px-5">
          <dt className="text-caption text-muted-foreground">{t("scrims.reportQuality")}</dt>
          <dd className="font-heading text-section font-semibold leading-tight tabular-nums">{report.quality}</dd>
        </div>
        {report.issue ? (
          <div className="flex flex-col justify-center gap-0.5 border-e border-line px-4 py-3 sm:px-5">
            <dt className="text-caption text-muted-foreground">{t("scrims.detectedIssue")}</dt>
            <dd className="font-heading text-section font-semibold uppercase leading-tight tracking-wide">
              {t(SCRIM_ISSUE_KEYS[report.issue])}
            </dd>
          </div>
        ) : null}
        {blockLabel ? (
          <div className="flex flex-col justify-center gap-0.5 px-4 py-3 sm:px-5">
            <dt className="text-caption text-muted-foreground">{t("scrims.block")}</dt>
            <dd className="font-heading text-section font-semibold uppercase leading-tight tracking-wide">
              {t("scrims.blockOfTwo", { label: blockLabel })}
            </dd>
          </div>
        ) : null}
      </dl>

      <div className="flex flex-col gap-4 p-4 sm:p-5">
        {prompt ? <p className="font-medium">{prompt}</p> : null}
        <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(20.625rem,100%),1fr))] gap-2.5">
          {options.map((option) => (
            <li key={option.id} className="relative flex flex-col gap-2 rounded-[10px] border border-dim bg-muted px-4 py-3.5 hover:border-foreground">
              <button
                type="button"
                disabled={savingId !== null}
                onClick={() => onDecide(option.id)}
                className="text-start font-heading text-xl font-semibold uppercase leading-tight tracking-wide after:absolute after:inset-0 after:rounded-[10px] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ring disabled:cursor-not-allowed"
              >
                {savingId === option.id ? t("common.saving") : option.label}
              </button>
              <p className="text-sm text-muted-foreground">{option.description}</p>
              <div className="flex flex-wrap gap-1.5">
                {DECISION_IMPACT_TAGS[option.id].map((tag) => (
                  <ScrimTag key={tag} tag={tag} />
                ))}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
