import { useTranslation } from "react-i18next";
import { TriangleAlert } from "lucide-react";

import type { DecisionResult, ResultClosing, ResultRow } from "@/lib/scrims/decisionResult";
import { cn } from "@/ui-v2/lib/utils";
import { RESULT_FIELD_KEY, resultRowIsCost, usePlayerChanges } from "./EffectText";

interface ScrimDecisionResultProps {
  result: DecisionResult | null;
  /** The one live line of the tab: the decision just applied, or the prompt of a step that applies nothing. */
  statusText: string;
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
 * What a decision changed, under the wide column. The status line is the only live region: it
 * announces the decision once, and the rows are read on demand instead of being announced whole.
 */
export function ScrimDecisionResult({ result, statusText }: ScrimDecisionResultProps) {
  const { t } = useTranslation();

  return (
    <div
      data-slot="scrim-decision-result"
      className={cn(result && "flex flex-col gap-3 rounded-xl border border-line bg-card p-4 sm:p-5")}
    >
      <p
        aria-live="polite"
        aria-atomic="true"
        className={cn(
          statusText
            ? result
              ? "font-heading text-section font-bold uppercase leading-tight tracking-wide"
              : "rounded-lg border border-line bg-card px-3.5 py-2.5 text-sm font-medium"
            : "sr-only",
        )}
      >
        {statusText}
      </p>
      {result ? (
        <>
          <dl aria-label={t("scrims.whatChanged")} className="flex flex-col">
            {result.rows.map((row, index) => (
              <div
                key={`${row.kind}-${index}`}
                className="grid grid-cols-[minmax(8.125rem,0.9fr)_minmax(0,1.4fr)] items-baseline gap-x-4 gap-y-1 border-t border-line py-2 first:border-t-0 first:pt-0"
              >
                <dt className="text-sm text-muted-foreground">{rowLabel(row, t)}</dt>
                <dd className="flex flex-wrap items-center gap-2 font-medium">
                  <RowValue row={row} />
                  {resultRowIsCost(row) ? (
                    <span className="inline-flex items-center gap-1 rounded border border-dashed border-warning px-1.5 py-0.5 text-caption font-semibold leading-none text-warning">
                      <TriangleAlert aria-hidden="true" className="size-3" />
                      {t("scrims.costMark")}
                    </span>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-muted-foreground">{t(CLOSING_KEY[result.closing])}</p>
        </>
      ) : null}
    </div>
  );
}
