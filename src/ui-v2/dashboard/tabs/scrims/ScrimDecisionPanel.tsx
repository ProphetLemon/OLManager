import { useId } from "react";
import { useTranslation } from "react-i18next";

import { DECISION_IMPACT_TAGS } from "@/lib/scrims/decisionTags";
import type { EffectLine } from "@/lib/scrims/decisionEffects";
import { SCRIM_FOCUS_OBJECTIVE_KEYS, SCRIM_ISSUE_KEYS } from "@/lib/scrims/scrimFocusKeys";
import type { ScrimReportData } from "@/store/gameStore";
import type { DailyScrimAction } from "@/services/trainingService";
import { Button } from "@/ui-v2/components/ui/button";
import { ResultLetter } from "@/ui-v2/components/ResultLetter";
import { cn } from "@/ui-v2/lib/utils";
import { EffectLineText } from "./EffectText";
import { ScrimTag } from "./ScrimTag";

export interface DecisionOption {
  id: DailyScrimAction;
  label: string;
  description: string;
  /** What choosing it does, as the game will apply it. */
  effects: EffectLine[];
}

interface ScrimDecisionPanelProps {
  report: ScrimReportData;
  slotLabel: string;
  /** "A" or "B": the block this report is about. */
  blockLabel: string | null;
  options: DecisionOption[];
  savingId: DailyScrimAction | null;
  onDecide: (id: DailyScrimAction) => void;
  /** Set while the follow-ups of Cancel scrims are showing; leaves them for the block decision. */
  onBack: (() => void) | null;
}

/**
 * Decision body of the wide column: the block that was just played and the calls the manager can
 * make. Each card is one press. Its description, tags and effects stay visible, and the button
 * points to them with `aria-describedby`, so a screen reader hears what a choice costs as it lands on it.
 */
export function ScrimDecisionPanel({
  report,
  slotLabel,
  blockLabel,
  options,
  savingId,
  onDecide,
  onBack,
}: ScrimDecisionPanelProps) {
  const { t } = useTranslation();
  const uid = useId();
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
        <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(20.625rem,100%),1fr))] gap-2.5">
          {options.map((option) => {
            const base = `${uid}-${option.id}`;
            return (
              <li
                key={option.id}
                className="relative flex flex-col gap-2 rounded-[10px] border border-dim bg-muted px-4 py-3.5 transition-colors hover:border-foreground has-[button:focus-visible]:outline-2 has-[button:focus-visible]:outline-offset-2 has-[button:focus-visible]:outline-ring"
              >
                <button
                  type="button"
                  disabled={savingId !== null}
                  aria-describedby={`${base}-description ${base}-tags ${base}-effects`}
                  onClick={() => onDecide(option.id)}
                  className="min-h-11 text-start font-heading text-xl font-semibold uppercase leading-tight tracking-wide outline-none after:absolute after:inset-0 after:rounded-[10px] disabled:cursor-not-allowed"
                >
                  {savingId === option.id ? t("common.saving") : option.label}
                </button>
                <p id={`${base}-description`} className="text-sm text-muted-foreground">
                  {option.description}
                </p>
                <div id={`${base}-tags`} className="flex flex-wrap gap-1.5">
                  {DECISION_IMPACT_TAGS[option.id].map((tag) => (
                    <ScrimTag key={tag} tag={tag} />
                  ))}
                </div>
                <ul id={`${base}-effects`} className="mt-auto flex flex-col gap-1 border-t border-line pt-2.5 text-sm">
                  {option.effects.map((line, index) => (
                    <EffectLineText key={`${line.kind}-${index}`} line={line} />
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
        {onBack ? (
          <div>
            <Button type="button" variant="outline" size="touch" onClick={onBack}>
              {t("scrims.backToBlockDecision")}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
