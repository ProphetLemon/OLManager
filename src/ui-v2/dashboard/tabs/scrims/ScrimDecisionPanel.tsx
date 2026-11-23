import { useId } from "react";
import { useTranslation } from "react-i18next";

import { DECISION_IMPACT_TAGS } from "@/lib/scrims/decisionTags";
import type { EffectLine } from "@/lib/scrims/decisionEffects";
import type { ScrimReportData } from "@/store/gameStore";
import type { DailyScrimAction } from "@/services/trainingService";
import { Button } from "@/ui-v2/components/ui/button";
import { EffectLineText } from "./EffectText";
import { ScrimDecisionFacts } from "./ScrimDecisionFacts";
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

  return (
    <div>
      <ScrimDecisionFacts report={report} slotLabel={slotLabel} blockLabel={blockLabel} />

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
