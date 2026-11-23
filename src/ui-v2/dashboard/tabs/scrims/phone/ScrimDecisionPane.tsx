import { useTranslation } from "react-i18next";
import { Lock } from "lucide-react";

import { SCRIM_FOCUS_OBJECTIVE_KEYS, SCRIM_ISSUE_KEYS } from "@/lib/scrims/scrimFocusKeys";
import type { TeamIdentity } from "@/lib/teams/teamIdentity";
import type { ScrimReportData } from "@/store/gameStore";
import type { DailyScrimAction } from "@/services/trainingService";
import { cn } from "@/ui-v2/lib/utils";
import { EffectLineText } from "../EffectText";
import type { DecisionOption } from "../ScrimDecisionPanel";
import { PhoneDecisionCard } from "./PhoneDecisionCard";
import { PhoneMatchup, ResultWord } from "./PhoneMatchup";
import { ScrimViewFrame } from "./ScrimViewFrame";

export interface ScrimDecisionPaneProps {
  /** "Decide Wed A": the frame's heading and the name of its back control. */
  title: string;
  /** Leaves for Semana. */
  onBack: () => void;
  report: ScrimReportData;
  you: TeamIdentity;
  rival: TeamIdentity;
  /** "A" or "B". */
  blockLabel: string | null;
  /** The choices from the existing rules, with their effect lines. Any number of them. */
  options: readonly DecisionOption[];
  /** The decision being saved, if any. */
  savingId: DailyScrimAction | null;
  onDecide: (id: DailyScrimAction) => void;
  /** Rep scrims now: the bar of an option that cancels starts here. */
  reputation: number;
  /** The week is locked: the top row says so with the lock and one word. */
  locked: boolean;
}

/** From this many options on, the cards become dense rows so each one still holds a target. */
const DENSE_FROM = 3;

/**
 * Decidir (frame Decide). Left: the block as a medium matchup, the result as a large word, the
 * report's focus, quality and the issue the staff detected. Right: one card per option the game
 * gives, in the game's order. The frame's top row holds the lock (icon and word) and, when several
 * options close the day, the one sentence they all share.
 */
export function ScrimDecisionPane({ title, onBack, report, you, rival, blockLabel, options, savingId, onDecide, reputation, locked }: ScrimDecisionPaneProps) {
  const { t } = useTranslation();
  const won = Boolean(report.won);
  const dense = options.length >= DENSE_FROM;
  const closing = dense ? options.flatMap((option) => option.effects).find((line) => line.kind === "closesDay") : undefined;

  return (
    <ScrimViewFrame
      title={title}
      onBack={onBack}
      lead={
        locked ? (
          <span data-slot="decision-lock" className="flex min-w-0 items-center gap-1.5 text-entry text-muted-foreground">
            <Lock aria-hidden="true" className="size-[1.125rem] shrink-0" />
            {t("scrims.slotStatus.locked")}
          </span>
        ) : null
      }
      actions={
        closing ? (
          <ul data-slot="decision-closing" className="m-0 max-w-[22rem] list-none p-0 text-caption leading-4 text-muted-foreground">
            <EffectLineText line={closing} />
          </ul>
        ) : null
      }
    >
      <section data-slot="scrim-decision-pane" role="group" aria-label={title} className="flex h-full min-h-0 gap-4 pb-3 pt-2">
        <div className="flex w-[12.25rem] shrink-0 flex-col">
          <PhoneMatchup you={you} rival={rival} lines={2} className="px-1" />
          <p className="m-0 mt-1 flex items-baseline gap-2">
            <ResultWord won={won} className="text-title" />
            {blockLabel ? <span className="text-entry text-muted-foreground">{t("scrims.blockOfTwo", { label: blockLabel })}</span> : null}
          </p>
          <dl data-slot="phone-decision-facts" className="m-0 mt-1 flex min-w-0 flex-col">
            <Fact label={t("scrims.reportFocus")} value={t(SCRIM_FOCUS_OBJECTIVE_KEYS[report.focus])} />
            <div className="flex items-baseline gap-1.5 text-caption leading-4">
              <dt className="text-muted-foreground">{t("scrims.reportQuality")}</dt>
              <dd className="m-0 text-entry font-semibold tabular-nums">{report.quality}</dd>
            </div>
            {report.issue ? <Fact label={t("scrims.detectedIssue")} value={t(SCRIM_ISSUE_KEYS[report.issue])} /> : null}
          </dl>
        </div>
        <ul data-slot="decision-options" className={cn("m-0 flex min-h-0 min-w-0 flex-1 list-none flex-col p-0", dense ? "gap-0.5" : "gap-2")}>
          {options.map((option) => (
            <PhoneDecisionCard
              key={option.id}
              option={option}
              layout={dense ? "dense" : "card"}
              report={report}
              reputation={reputation}
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

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="truncate text-caption leading-[0.875rem] text-muted-foreground">{label}</dt>
      <dd className="m-0 truncate text-entry leading-4">{value}</dd>
    </div>
  );
}
