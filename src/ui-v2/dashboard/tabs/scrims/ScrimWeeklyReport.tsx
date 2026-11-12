import { useTranslation } from "react-i18next";

import type { WeeklyScrimContext } from "@/lib/scrims/scrimContext";
import { SCRIM_FOCUS_OBJECTIVE_KEYS } from "@/lib/scrims/scrimFocusKeys";
import { ResultLetter } from "@/ui-v2/components/ResultLetter";
import { cn } from "@/ui-v2/lib/utils";
import { ScrimDisclosure } from "./ScrimDisclosure";

interface ScrimWeeklyReportProps {
  week: WeeklyScrimContext;
  teamNameById: ReadonlyMap<string, string>;
}

/** The week's report, closed by default: the record, the average quality and the latest reports. */
export function ScrimWeeklyReport({ week, teamNameById }: ScrimWeeklyReportProps) {
  const { t } = useTranslation();
  const reports = week.latestReports.slice(0, 3);
  const objective = week.objective ? t(SCRIM_FOCUS_OBJECTIVE_KEYS[week.objective]) : t("training.scrims.objectives.none");
  const summary = reports.length > 0
    ? `${t("scrims.weekRecord")} ${week.wins}-${week.losses}${week.avgQuality > 0 ? `, Q: ${week.avgQuality}` : ""}`
    : t("scrims.noRecentReports");

  return (
    <ScrimDisclosure title={t("scrims.weeklyReportInline")} summary={summary}>
      {reports.length > 0 ? (
        <>
          <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(13.75rem,100%),1fr))] gap-3">
            <div className="flex flex-col gap-0.5">
              <dt className="text-caption text-muted-foreground">{t("scrims.weeklyObjective")}</dt>
              <dd className="font-medium">{objective}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-caption text-muted-foreground">{t("scrims.weekRecord")}</dt>
              <dd className="font-medium tabular-nums">{week.wins}-{week.losses}</dd>
            </div>
            {week.avgQuality > 0 ? (
              <div className="flex flex-col gap-0.5">
                <dt className="text-caption text-muted-foreground">{t("scrims.reportQuality")}</dt>
                <dd className="font-medium tabular-nums">Q: {week.avgQuality}</dd>
              </div>
            ) : null}
            {week.lossStreak > 0 ? (
              <div className="flex flex-col gap-0.5">
                <dt className="text-caption text-muted-foreground">{t("scrims.streaks")}</dt>
                <dd className="font-medium">{t("scrims.lossStreak", { count: week.lossStreak })}</dd>
              </div>
            ) : null}
          </dl>
          <div>
            <h3 className="mb-1 font-heading text-lg font-semibold uppercase leading-tight tracking-wide">
              {t("scrims.recentReports")}
            </h3>
            <ul>
              {reports.map((report) => (
                <li
                  key={`${report.week_key}-${report.slot_index}`}
                  className="grid grid-cols-[1.75rem_minmax(0,1.6fr)_minmax(0,1fr)_auto] items-center gap-3 border-t border-line py-2 first:border-t-0"
                >
                  <span
                    className={cn(
                      "inline-flex size-7 items-center justify-center rounded font-heading text-lg font-bold leading-none",
                      report.won ? "bg-positive text-positive-foreground" : "bg-negative text-negative-foreground",
                    )}
                  >
                    <ResultLetter kind={report.won ? "win" : "loss"} />
                  </span>
                  <span className="min-w-0 truncate">{teamNameById.get(report.opponent_team_id) ?? report.opponent_team_id}</span>
                  <span className="min-w-0 truncate text-sm text-muted-foreground">{t(SCRIM_FOCUS_OBJECTIVE_KEYS[report.focus])}</span>
                  <span className="tabular-nums">Q{report.quality}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : (
        <div>
          <p className="font-medium">{t("scrims.noRecentReports")}</p>
          <p className="text-muted-foreground">{t("scrims.noWeeklyReportYet")}</p>
        </div>
      )}
    </ScrimDisclosure>
  );
}
