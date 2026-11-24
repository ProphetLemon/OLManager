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
import { ChangeValue } from "./PhoneChange";
import { DECISION_TEXT_KEY } from "@/lib/scrims/decisionTextKey";
import type { DailyScrimAction } from "@/services/trainingService";
import { COLUMNS, EffectsHeader } from "./PhoneEffectsTable";
import { STATS, StatValue, useStatWords, type StatChange, type StatId } from "./PhoneStats";
import { GlossaryButton } from "./ScrimGlossary";
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
  /** A played block whose own decision was taken: it shows its result instead of "report waiting". */
  decided?: boolean;
  result?: "won" | "lost" | null;
}

/** One decided block of the day, as a read-only row of the table. */
export interface ResultDecision {
  /** "Wed A". */
  slotLabel: string;
  /** The decision taken; null only when the stored report does not name it. */
  action: DailyScrimAction | null;
  /** What the game applied, as read when the decision landed; null when it is no longer known (after a restart only the stored decision remains). */
  result: DecisionResult | null;
  /** The block this review was opened for. */
  current: boolean;
}

export interface ScrimResultPaneProps {
  /** "Block review": the frame's heading and the name of its back control. */
  title: string;
  /** Leaves for Semana. */
  onBack: () => void;
  /** The result of the block this review is for: its costs and its closing sentence. */
  result: DecisionResult;
  /** One entry per decided block of the day, in day order. */
  decisions: readonly ResultDecision[];
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
    ) : block.state === "played" && block.decided && block.result ? (
      <ResultWord won={block.result === "won"} className="text-section" />
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

const ROW = "flex min-h-6 flex-1 basis-0 items-center justify-between gap-3 border-b border-line";

/** What the decision did to one stat, read from the result's rows; an untouched stat is a dash. */
function statChangeOf(stat: StatId, rows: readonly ResultRow[]): StatChange {
  if (stat === "quality") {
    const row = rows.find((candidate) => candidate.kind === "change" && candidate.field === "quality");
    return row?.kind === "change" ? { delta: row.after - row.before, end: row.after } : { delta: 0 };
  }
  const players = rows.find((candidate) => candidate.kind === "players");
  if (players?.kind !== "players") return { delta: 0 };
  return { delta: stat === "morale" ? players.morale : players.condition };
}

function DecisionRow({ decision }: { decision: ResultDecision }) {
  const { t } = useTranslation();
  const statWords = useStatWords();
  const { slotLabel, action, result, current } = decision;
  const name = action ? t(`scrims.decision.${DECISION_TEXT_KEY[action]}`) : null;
  const spoken = [slotLabel, ...(name ? [name] : [])];
  if (result) spoken.push(...STATS.map((stat) => statWords(stat, statChangeOf(stat, result.rows))));
  else spoken.push(t("scrims.phone.changesUnavailable"));
  return (
    <li
      data-slot="decision-row"
      aria-current={current ? "true" : undefined}
      className={cn("relative grid min-h-9 shrink-0 items-center rounded-lg bg-card px-3 py-0.5", current && "before:absolute before:inset-y-1 before:start-0 before:w-1 before:rounded-full before:bg-foreground")}
      style={{ gridTemplateColumns: COLUMNS }}
    >
      <span aria-hidden="true" className="flex min-w-0 flex-col">
        <span className="font-heading text-entry font-bold uppercase leading-4 tracking-wide">{name ?? slotLabel}</span>
        {name ? <span className="text-caption leading-4 text-muted-foreground">{slotLabel}</span> : null}
      </span>
      {result ? (
        STATS.map((stat) => (
          <span key={stat} data-stat={stat} className="flex justify-end">
            <StatValue change={statChangeOf(stat, result.rows)} />
          </span>
        ))
      ) : (
        <span aria-hidden="true" className="col-span-3 text-end text-caption text-muted-foreground">{t("scrims.phone.changesUnavailable")}</span>
      )}
      <span className="sr-only">{`${spoken.join(". ")}.`}</span>
    </li>
  );
}

function RowValue({ row }: { row: ResultRow }) {
  const { t } = useTranslation();
  switch (row.kind) {
    case "change":
      return <ChangeValue tone={row.cost ? "cost" : "gain"} before={row.before} after={row.after} big />;
    case "players":
      return null;
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
export function ScrimResultPane({ title, onBack, result, decisions, statusText, you, rival, won, slotLabel, other, nextSlotLabel, onDecideNext }: ScrimResultPaneProps) {
  const { t } = useTranslation();
  const labelId = useId();
  // Calidad, Moral and Energía come first and always; then the costs and the other block's row. Gravedad is never listed.
  const costRows = result.rows.filter((row) => (row.kind === "change" && (row.field === "reputation" || row.field === "cancellations")) || row.kind === "block");

  return (
    <ScrimViewFrame
      title={title}
      onBack={onBack}
      actions={
        <>
          {statusText ? (
            <p data-slot="result-applied" className="m-0 flex max-w-[22rem] items-center gap-2 text-entry font-medium leading-tight">
              <Check aria-hidden="true" className="size-5 shrink-0 text-positive" strokeWidth={3} />
              <span className="min-w-0">{statusText}</span>
            </p>
          ) : null}
          <GlossaryButton />
        </>
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
          <div role="group" aria-labelledby={labelId} className="flex min-h-0 flex-1 flex-col">
            <EffectsHeader chevron={false} />
            <ul data-slot="decision-rows" className="m-0 flex list-none flex-col gap-1 p-0">
              {decisions.map((decision) => (
                <DecisionRow key={decision.slotLabel} decision={decision} />
              ))}
            </ul>
            <dl className="m-0 flex min-h-0 flex-1 flex-col pt-1">
            {costRows.map((row, index) => (
              <div key={`${row.kind}-${index}`} className={ROW}>
                <dt className="min-w-0 text-entry text-muted-foreground">{rowLabel(row, t)}</dt>
                <dd className="m-0 shrink-0">
                  <RowValue row={row} />
                </dd>
              </div>
            ))}
            </dl>
          </div>
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
