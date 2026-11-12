import type { SoloQHistoryDay } from "@/api/types";
import {
  dayKindWord,
  focusLabel,
  formatNumber,
  formatShortDate,
  offsetOf,
  type Translate,
} from "@/lib/players/soloqHistory";
import { cn } from "@/ui-v2/lib/utils";

const GRID = "grid grid-cols-[1fr_1.4fr_1.8fr_0.8fr_0.8fr_1fr_0.9fr] gap-2 px-4";

interface SoloqDayTableV2Props {
  id: string;
  days: readonly SoloQHistoryDay[];
  start: number;
  selected: number;
  decayOn: boolean;
  language: string;
  t: Translate;
}

/** The same record as the chart, as text: newest day first, with the focus and the hidden offset. */
export default function SoloqDayTableV2({ id, days, start, selected, decayOn, language, t }: SoloqDayTableV2Props) {
  const notApplicable = t("soloqHistory.table.na");
  const rows: number[] = [];
  for (let i = days.length - 1; i >= start; i -= 1) rows.push(i);

  return (
    <div
      id={id}
      role="region"
      aria-label={t("soloqHistory.table.region")}
      tabIndex={0}
      className="max-h-80 overflow-auto rounded-lg bg-rail focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <div role="table" aria-label={t("soloqHistory.table.name")} className="min-w-[820px] text-sm">
        <div role="row" className={cn(GRID, "sticky top-0 bg-rail py-2.5 shadow-[0_1px_0_var(--line)]")}>
          {["date", "focus", "day", "grace", "offset", "formula", decayOn ? "lpDecay" : "lp"].map((column) => (
            <div key={column} role="columnheader" className="font-heading text-2xs uppercase tracking-wide text-muted-foreground">
              {t(`soloqHistory.table.${column}`)}
            </div>
          ))}
        </div>
        {rows.map((index) => {
          const day = days[index];
          const offset = offsetOf(day);
          return (
            <div
              key={day.date}
              role="row"
              aria-current={index === selected ? "true" : undefined}
              className={cn(GRID, "border-t border-line py-2", index === selected && "bg-secondary")}
            >
              <div role="cell">{formatShortDate(day.date, language)}</div>
              <div role="cell">{focusLabel(day.focus, t)}</div>
              <div role="cell">{dayKindWord(day, decayOn, t)}</div>
              <div role="cell">{decayOn ? t("soloqHistory.table.graceOf", { bank: day.bank, cap: day.bank_max }) : notApplicable}</div>
              <div role="cell">{decayOn ? (offset > 0 ? formatNumber(-offset, language) : "0") : notApplicable}</div>
              <div role="cell" className="text-muted-foreground">{formatNumber(day.formula_lp, language)}</div>
              <div role="cell" className="font-semibold">{formatNumber(day.lp, language)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
