import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { DecisionResult, ResultClosing, ResultRow } from "@/lib/scrims/decisionResult";
import { cn } from "@/ui-v2/lib/utils";
import { CostMark, RESULT_FIELD_KEY, resultRowIsCost, usePlayerChanges } from "./EffectText";

interface ScrimDecisionResultProps {
  result: DecisionResult | null;
  /** The one live line of the tab: the decision just applied, or the prompt of a step that applies nothing. */
  statusText: string;
  /** Narrow pane: no border or padding of its own, smaller type and tighter rows. Desktop keeps the default. */
  compact?: boolean;
  /** Compact only: the pane's own heading, shown between the live line and the rows. */
  heading?: ReactNode;
}

const CLOSING_KEY: Record<ResultClosing, string> = {
  blockTwoPlayed: "scrims.result.blockTwoPlayed",
  nextReportLater: "scrims.result.nextReportLater",
  blockCancelled: "scrims.result.blockCancelled",
  dayClosed: "scrims.result.dayClosed",
};

function RowValue({ row }: { row: ResultRow }) {
  const { t } = useTranslation();
  const playerChanges = usePlayerChanges();
  switch (row.kind) {
    case "change":
      return <span className="tabular-nums">{row.before} → {row.after}</span>;
    case "players":
      return <span>{playerChanges(row.morale, row.condition)}</span>;
    case "block":
      return <span>{row.state === "cancelled" ? t("scrims.result.cancelled") : t("scrims.result.playedWaiting")}</span>;
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
 * What a decision changed, right under the heading of the wide column and before the next card. The status line is the only live region: it
 * announces the decision once, and the rows are read on demand instead of being announced whole.
 */
export function ScrimDecisionResult({ result, statusText, compact = false, heading }: ScrimDecisionResultProps) {
  const { t } = useTranslation();

  return (
    <div
      data-slot="scrim-decision-result"
      className={cn(result && (compact ? "flex flex-col gap-2" : "flex flex-col gap-3 border-b border-line p-4 sm:p-5"))}
    >
      <p
        // The phone keeps one live region for the whole tab (a region that mounts with its text is often skipped).
        aria-live={compact ? undefined : "polite"}
        aria-atomic={compact ? undefined : "true"}
        className={cn(
          statusText
            ? compact
              ? "text-entry font-medium leading-tight"
              : result
              ? "font-heading text-section font-bold uppercase leading-tight tracking-wide"
              : "border-b border-line px-4 py-2.5 text-sm font-medium sm:px-5"
            : "sr-only",
        )}
      >
        {statusText}
      </p>
      {result && compact ? heading : null}
      {result ? (
        <>
          <dl aria-label={t("scrims.whatChanged")} className="flex flex-col">
            {result.rows.map((row, index) => (
              <div
                key={`${row.kind}-${index}`}
                className={cn(
                  "grid items-baseline gap-x-4 gap-y-1 border-t border-line first:border-t-0 first:pt-0",
                  compact
                    ? "grid-cols-[minmax(0,1fr)_auto] py-1 text-caption"
                    : "grid-cols-[minmax(8.125rem,0.9fr)_minmax(0,1.4fr)] py-2",
                )}
              >
                <dt className={compact ? "text-muted-foreground" : "text-sm text-muted-foreground"}>{rowLabel(row, t)}</dt>
                <dd className={cn("flex flex-wrap items-center gap-2 font-medium", compact && "justify-end")}>
                  <RowValue row={row} />
                  {resultRowIsCost(row) ? <CostMark /> : null}
                </dd>
              </div>
            ))}
          </dl>
          <p className={cn("text-muted-foreground", compact && "text-entry")}>{t(CLOSING_KEY[result.closing])}</p>
        </>
      ) : null}
    </div>
  );
}
