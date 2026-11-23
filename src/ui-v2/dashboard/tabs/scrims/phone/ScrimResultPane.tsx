import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronRight, X } from "lucide-react";

import type { DecisionResult, ResultRow } from "@/lib/scrims/decisionResult";
import type { PhoneBlockState } from "@/lib/scrims/phoneHome";
import type { TeamIdentity } from "@/lib/teams/teamIdentity";
import { Button } from "@/ui-v2/components/ui/button";
import { cn } from "@/ui-v2/lib/utils";
import { RESULT_FIELD_KEY } from "../EffectText";
import { CLOSING_KEY } from "../ScrimDecisionResult";
import { ChangeValue, PlayersChange } from "./PhoneChange";
import { PhoneMatchup, ResultWord } from "./PhoneMatchup";
import { ScrimViewFrame } from "./ScrimViewFrame";
import { EmptyShield, TeamShield } from "./TeamShield";

/** The day's other block, drawn under the one that was just decided. */
export interface ResultOtherBlock {
  /** "Wed B". */
  label: string;
  /** Its rival; null draws an empty shield. */
  identity: TeamIdentity | null;
  state: PhoneBlockState;
}

export interface ScrimResultPaneProps {
  /** "Block review": the frame's heading and the name of its back control. */
  title: string;
  /** Leaves for Semana. */
  onBack: () => void;
  result: DecisionResult;
  /** "Decision applied to scrim block: …": shown in the top row; the layout's one live region is the only one that speaks. */
  statusText: string;
  you: TeamIdentity;
  rival: TeamIdentity;
  won: boolean;
  /** "Wed A": the block that was decided. */
  slotLabel: string;
  other: ResultOtherBlock | null;
  /** "Wed B" when the next block was played and waits for its decision; null otherwise. */
  nextSlotLabel: string | null;
  onDecideNext: () => void;
}

/** Cancelled: the secondary colour with the X (K2). Not dimmed, not red. */
function CancelledWord({ slot, className }: { slot?: string; className?: string }) {
  const { t } = useTranslation();
  return (
    <span data-slot={slot} className={cn("inline-flex items-center gap-1 font-heading font-semibold uppercase text-muted-foreground", className)}>
      <X aria-hidden="true" className="size-4 shrink-0" strokeWidth={3} />
      {t("scrims.slotStatus.cancelled")}
    </span>
  );
}

function OtherBlock({ block }: { block: ResultOtherBlock }) {
  const { t } = useTranslation();
  const state =
    block.state === "cancelled" ? (
      <CancelledWord slot="result-block-state" className="text-entry" />
    ) : block.state === "played" ? (
      <span data-slot="result-block-state" className="text-entry font-medium">{t("scrims.result.playedWaiting")}</span>
    ) : block.state === "notPlayed" ? (
      <span data-slot="result-block-state" className="text-entry font-medium text-muted-foreground">{t("scrims.slotStatus.notPlayed")}</span>
    ) : null;
  return (
    <div data-slot="result-block-b" className="flex items-start gap-3 pt-2">
      <span className="w-12 shrink-0 text-entry text-muted-foreground">{block.label}</span>
      <div className="flex w-[5.5rem] shrink-0 flex-col items-center gap-1">
        {block.identity ? <TeamShield identity={block.identity} size="medium" /> : <EmptyShield size="medium" />}
        {block.identity || block.state !== "cancelled" ? (
          <span className="max-w-full text-center font-heading text-entry font-semibold leading-tight line-clamp-2">
            {block.identity ? block.identity.name : t("scrims.notPlanned")}
          </span>
        ) : null}
      </div>
      <div className="pt-4">{state}</div>
    </div>
  );
}

function RowValue({ row }: { row: ResultRow }) {
  const { t } = useTranslation();
  switch (row.kind) {
    case "change":
      return <ChangeValue tone={row.cost ? "cost" : "gain"} before={row.before} after={row.after} big />;
    case "players":
      return <PlayersChange morale={row.morale} condition={row.condition} label={false} />;
    case "block":
      return row.state === "cancelled" ? <CancelledWord className="text-section" /> : <span className="text-entry font-medium">{t("scrims.result.playedWaiting")}</span>;
  }
}

function rowLabel(row: ResultRow, t: (key: string, options?: Record<string, unknown>) => string): string {
  switch (row.kind) {
    case "change": return t(RESULT_FIELD_KEY[row.field]);
    case "players": return t("scrims.effect.playersLabel");
    case "block": return t("scrims.result.blockLabel", { label: row.label });
  }
}

/**
 * Resultado (frame Result). Left: the block that was decided as a medium matchup with its result word,
 * and the day's other block under it with its state. Right: what changed as rows of before-and-after
 * values, the closing sentence and, when the next block's report waits, the button that opens it.
 * The top row says which decision was applied; it is plain text, the layout's polite line speaks.
 */
export function ScrimResultPane({ title, onBack, result, statusText, you, rival, won, slotLabel, other, nextSlotLabel, onDecideNext }: ScrimResultPaneProps) {
  const { t } = useTranslation();
  const labelId = useId();

  return (
    <ScrimViewFrame
      title={title}
      onBack={onBack}
      actions={
        statusText ? (
          <p data-slot="result-applied" className="m-0 flex max-w-[22rem] items-center gap-2 text-entry font-medium leading-tight">
            <Check aria-hidden="true" className="size-5 shrink-0 text-positive" strokeWidth={3} />
            <span className="min-w-0">{statusText}</span>
          </p>
        ) : null
      }
    >
      <section data-slot="scrim-result-pane" role="group" aria-label={title} className="flex h-full min-h-0 gap-6 pb-3 pt-2">
        <div className="flex w-[19rem] shrink-0 flex-col">
          <div data-slot="result-block-a" className="flex items-start gap-3 pb-2">
            <span className="w-12 shrink-0 text-entry text-muted-foreground">{slotLabel}</span>
            <PhoneMatchup you={you} rival={rival} lines={2} className="flex-1" middle={<ResultWord won={won} className="mt-4 text-section" />} />
          </div>
          {other ? (
            <div className="border-t border-line">
              <OtherBlock block={other} />
            </div>
          ) : null}
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <p id={labelId} data-slot="result-changes-title" className="m-0 shrink-0 font-heading text-entry font-bold uppercase leading-5 tracking-wide">
            {t("scrims.whatChanged")}
          </p>
          <dl aria-labelledby={labelId} role="group" className="m-0 flex min-h-0 flex-1 flex-col">
            {result.rows.map((row, index) => (
              <div key={`${row.kind}-${index}`} className="flex min-h-6 flex-1 basis-0 items-center justify-between gap-3 border-b border-line">
                <dt className="min-w-0 text-entry text-muted-foreground">{rowLabel(row, t)}</dt>
                <dd className="m-0 shrink-0">
                  <RowValue row={row} />
                </dd>
              </div>
            ))}
          </dl>
          <p data-slot="result-closing" className="m-0 shrink-0 pt-1.5 text-entry leading-[1.125rem]">
            {t(CLOSING_KEY[result.closing])}
          </p>
          {nextSlotLabel ? (
            <Button type="button" variant="outline" size="touch" className="mt-1.5 shrink-0 justify-between font-heading text-entry uppercase tracking-wide" onClick={onDecideNext}>
              {t("scrims.phone.decideSlot", { slot: nextSlotLabel })}
              <ChevronRight aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </section>
    </ScrimViewFrame>
  );
}
