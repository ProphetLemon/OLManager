import { useId } from "react";
import { useTranslation } from "react-i18next";

import type { WeeklyScrimContext } from "@/lib/scrims/scrimContext";
import { ScrimStaffSuggestions } from "../ScrimStaffSuggestions";
import { ScrimRecentReports } from "../ScrimWeeklyReport";
import { PaneHeading } from "./PhonePanePieces";

export interface ScrimReportPaneProps {
  week: WeeklyScrimContext;
  teamNameById: ReadonlyMap<string, string>;
  /** The sentences of `buildStaffSuggestions`; empty draws nothing. */
  suggestions: readonly string[];
}

/** The Report cell's pane: the week's record, quality, streaks and played count, the three newest reports and the staff's suggestions. It scrolls inside itself. */
export function ScrimReportPane({ week, teamNameById, suggestions }: ScrimReportPaneProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const reports = week.latestReports.slice(0, 3);

  return (
    <section
      data-slot="scrim-report-pane"
      role="group"
      aria-labelledby={headingId}
      className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-2"
    >
      <PaneHeading id={headingId}>{t("scrims.weeklyReportInline")}</PaneHeading>
      <dl data-slot="report-stats" className="grid shrink-0 grid-cols-2 gap-x-4 gap-y-2">
        <div className="flex flex-col gap-0.5">
          <dt className="text-caption text-muted-foreground">{t("scrims.weekRecord")}</dt>
          <dd className="font-medium tabular-nums">
            {week.wins}-{week.losses}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-caption text-muted-foreground">{t("scrims.played")}</dt>
          <dd className="font-medium tabular-nums">{week.played}</dd>
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
      {reports.length > 0 ? (
        <ScrimRecentReports reports={reports} teamNameById={teamNameById} />
      ) : (
        <div>
          <p className="font-medium">{t("scrims.noRecentReports")}</p>
          <p className="text-muted-foreground">{t("scrims.noWeeklyReportYet")}</p>
        </div>
      )}
      <ScrimStaffSuggestions suggestions={suggestions} bare />
    </section>
  );
}
