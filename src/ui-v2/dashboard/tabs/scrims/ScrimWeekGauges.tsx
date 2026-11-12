import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { WeeklyScrimContext } from "@/lib/scrims/scrimContext";
import { ResultLetter } from "@/ui-v2/components/ResultLetter";
import { cn } from "@/ui-v2/lib/utils";

interface ScrimWeekGaugesProps {
  week: WeeklyScrimContext;
}

function GaugeRow({ title, value, children }: { title: string; value: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-heading text-lg font-semibold uppercase leading-tight tracking-wide">{title}</span>
        <span className="font-heading text-title font-semibold leading-none tabular-nums">{value}</span>
      </div>
      {children}
    </div>
  );
}

/** The week at a glance: slots planned, the record with its results, and the scrim reputation. */
export function ScrimWeekGauges({ week }: ScrimWeekGaugesProps) {
  const { t } = useTranslation();
  const results = [...week.latestReports].reverse();
  const repPercent = Math.min(100, Math.max(0, week.reputation));

  return (
    <section
      aria-label={t("scrims.weekGauges")}
      data-slot="scrim-week-gauges"
      className="flex flex-col gap-5 rounded-xl border border-line bg-card p-4 text-card-foreground sm:p-5"
    >
      <GaugeRow
        title={t("scrims.planned")}
        value={
          <>
            {week.planned}
            <small className="text-section text-muted-foreground">/{week.capacity}</small>
          </>
        }
      >
        <div
          role="meter"
          aria-label={t("scrims.planned")}
          aria-valuemin={0}
          aria-valuemax={week.capacity}
          aria-valuenow={week.planned}
          aria-valuetext={`${week.planned}/${week.capacity}`}
          className="flex gap-1"
        >
          {Array.from({ length: week.capacity }).map((_, index) => (
            <span
              key={index}
              className={cn(
                "h-2.5 max-w-11 flex-1 basis-6 rounded-sm border",
                index < week.planned ? "border-foreground bg-foreground" : "border-dim bg-transparent",
              )}
            />
          ))}
        </div>
      </GaugeRow>

      <GaugeRow title={t("scrims.weekRecord")} value={`${week.wins}-${week.losses}`}>
        {results.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {results.map((report) => (
              <li
                key={`${report.week_key}-${report.slot_index}`}
                className={cn(
                  "inline-flex size-7 items-center justify-center rounded font-heading text-lg font-bold leading-none",
                  report.won ? "bg-positive text-positive-foreground" : "bg-negative text-negative-foreground",
                )}
              >
                <ResultLetter kind={report.won ? "win" : "loss"} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-caption text-muted-foreground">{t("scrims.noBlocksYet")}</p>
        )}
      </GaugeRow>

      <GaugeRow title={t("scrims.reputation")} value={week.reputation}>
        <div
          role="meter"
          aria-label={t("scrims.reputation")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={repPercent}
          aria-valuetext={String(week.reputation)}
          className="relative h-2.5 rounded-[5px] border border-dim bg-muted"
        >
          <div className="absolute inset-y-0 start-0 rounded-s-[4px] bg-foreground" style={{ width: `${repPercent}%` }} />
        </div>
        <p className="text-caption text-muted-foreground">{t("scrims.repNote")}</p>
      </GaugeRow>

      <dl className="grid grid-cols-2 gap-3 border-t border-line pt-3.5">
        <div className="flex flex-col gap-0.5">
          <dt className="text-caption text-muted-foreground">{t("scrims.played")}</dt>
          <dd className="font-semibold tabular-nums">{week.played}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-caption text-muted-foreground">{t("scrims.cancellations")}</dt>
          <dd className="font-semibold tabular-nums">{week.cancellations}</dd>
        </div>
        {week.avgQuality > 0 ? (
          <div className="flex flex-col gap-0.5">
            <dt className="text-caption text-muted-foreground">{t("scrims.reportQuality")}</dt>
            <dd className="font-semibold tabular-nums">Q: {week.avgQuality}</dd>
          </div>
        ) : null}
        {week.lossStreak > 1 ? (
          <div className="flex flex-col gap-0.5">
            <dt className="text-caption text-muted-foreground">{t("scrims.streaks")}</dt>
            <dd>
              <span className="inline-flex items-center rounded border border-negative px-2 py-0.5 text-sm font-semibold text-negative">
                {t("scrims.lossStreak", { count: week.lossStreak })}
              </span>
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
