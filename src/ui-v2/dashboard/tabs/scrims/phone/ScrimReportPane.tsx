import { useTranslation } from "react-i18next";
import { TrendingDown } from "lucide-react";

import type { WeeklyScrimContext } from "@/lib/scrims/scrimContext";
import { SCRIM_FOCUS_OBJECTIVE_KEYS, SCRIM_ISSUE_KEYS } from "@/lib/scrims/scrimFocusKeys";
import { teamIdentityById } from "@/lib/teams/teamIdentity";
import type { ScrimReportData, TeamData } from "@/store/gameStore";
import { Meter } from "@/ui-v2/components/ui/meter";
import { cn } from "@/ui-v2/lib/utils";
import { ScrimStaffSuggestions } from "../ScrimStaffSuggestions";
import { ScrimViewFrame } from "./ScrimViewFrame";
import { TeamShield } from "./TeamShield";

export interface ScrimReportPaneProps {
  /** The view's name: the frame's heading and the name of its back control. */
  title: string;
  onBack: () => void;
  week: WeeklyScrimContext;
  /** Every team of the game: the source of the rival's real logo. */
  teams: readonly TeamData[];
  teamNameById: ReadonlyMap<string, string>;
  /** "Wed A" for a slot of the week. */
  slotLabelOf: (slot: { labelDay: number; labelSuffix: string } | undefined) => string;
  /** The sentences of `buildStaffSuggestions`; empty draws nothing. */
  suggestions: readonly string[];
}

/** K4: a small square with an outline and the letter; the word beside it says the result, so this one is silent. */
function ResultBadge({ won }: { won: boolean }) {
  const { t } = useTranslation();
  return (
    <span
      data-slot="report-badge"
      data-result={won ? "won" : "lost"}
      aria-hidden="true"
      className={cn(
        "absolute -end-2.5 -top-1 inline-flex size-[1.375rem] items-center justify-center rounded-[4px] border-2 bg-card font-heading text-entry font-bold leading-none",
        won ? "border-positive text-positive" : "border-negative text-negative",
      )}
    >
      {won ? t("onAir.home.formWinLetter", { defaultValue: "W" }) : t("onAir.home.formLossLetter", { defaultValue: "L" })}
    </span>
  );
}

/** The most recent block as a medium matchup: the rival with its result, the quality as a bar, the focus and the detected issue. */
function RecentBlock({ report, slotLabel, name, teams }: { report: ScrimReportData; slotLabel: string; name: string; teams: readonly TeamData[] }) {
  const { t } = useTranslation();
  const identity = teamIdentityById(teams, report.opponent_team_id) ?? { name, tag: name, logoUrl: null };
  return (
    <section
      data-slot="report-block"
      aria-label={`${t("scrims.reviewBlockTitle")} ${slotLabel}`.trim()}
      className="flex min-w-0 flex-1 gap-4 rounded-xl bg-card px-4 py-3 text-card-foreground"
    >
      <div className="flex w-28 shrink-0 flex-col items-center gap-1">
        <span className="relative block">
          <TeamShield identity={identity} size="medium" />
          <ResultBadge won={report.won === true} />
        </span>
        <span className="max-w-full text-center font-heading text-entry font-semibold leading-tight">{identity.name}</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-baseline gap-2.5">
          <span className={cn("font-heading text-section font-bold leading-none", report.won === true ? "text-positive" : "text-negative")}>
            {report.won === true ? t("scrims.reviewWin") : t("scrims.reviewLoss")}
          </span>
          {slotLabel ? <span className="text-entry">{slotLabel}</span> : null}
        </div>
        <div className="flex flex-col">
          <span className="text-caption text-muted-foreground">{t("scrims.reportQuality")}</span>
          <div className="flex items-center gap-2.5">
            <span className="font-heading text-title font-bold tabular-nums">{report.quality}</span>
            <Meter className="flex-1" label={t("scrims.reportQuality")} value={report.quality} tone="club" tick={50} showValue={false} />
          </div>
        </div>
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-entry leading-[1.0625rem]">
          <dt className="text-muted-foreground">{t("scrims.reportFocus")}</dt>
          <dd className="m-0">{t(SCRIM_FOCUS_OBJECTIVE_KEYS[report.focus])}</dd>
          {report.issue ? (
            <>
              <dt className="text-muted-foreground">{t("scrims.detectedIssue")}</dt>
              <dd className="m-0">{t(SCRIM_ISSUE_KEYS[report.issue])}</dd>
            </>
          ) : null}
        </dl>
      </div>
    </section>
  );
}

/**
 * Informe (frame Report): the week's record large, the most recent block as a medium matchup, Rep scrims
 * as a bar, Cancelaciones and the staff's suggestions. The body scrolls inside itself, and only it: it
 * starts 8 px under the frame's top row and runs to the bottom edge (4 + 48 + 8 + 226), so the cut is the edge.
 */
export function ScrimReportPane({ title, onBack, week, teams, teamNameById, slotLabelOf, suggestions }: ScrimReportPaneProps) {
  const { t } = useTranslation();
  // Newest first. A cancelled block has no result to show.
  const latest = week.latestReports.find((report) => report.status === "Played" && report.won != null);
  const nameOf = (id: string) => teamNameById.get(id) ?? id;

  return (
    <ScrimViewFrame title={title} onBack={onBack} bare>
      <div className="h-full min-h-0 pt-2">
        <section
          data-slot="scrim-report-pane"
          role="group"
          aria-label={t("scrims.weeklyReportInline")}
          className="scrollbar-v2 flex h-full min-h-0 flex-col gap-2 overflow-y-auto pe-2"
        >
          <div className="flex shrink-0 gap-5">
            <div className="flex w-[11.25rem] shrink-0 flex-col justify-center gap-0.5">
              <span data-slot="report-record" className="font-heading text-ovr font-bold tabular-nums">
                {week.wins}-{week.losses}
              </span>
              <span className="text-entry font-medium text-muted-foreground">{t("scrims.weekRecord")}</span>
              <p className="m-0 mt-2 flex items-baseline text-entry tabular-nums">
                <span className="text-muted-foreground">{t("scrims.played")}</span>
                <b className="ms-2 font-semibold">{week.played}</b>
              </p>
              {week.lossStreak > 0 ? (
                <p className="m-0 flex items-center gap-1.5 text-entry text-negative">
                  <TrendingDown aria-hidden="true" className="size-4 shrink-0" />
                  <span>{t("scrims.lossStreak", { count: week.lossStreak })}</span>
                </p>
              ) : null}
            </div>
            {latest ? (
              <RecentBlock
                report={latest}
                slotLabel={slotLabelOf(week.slots.find((slot) => slot.slotIndex === latest.slot_index))}
                name={nameOf(latest.opponent_team_id)}
                teams={teams}
              />
            ) : (
              <div className="min-w-0 flex-1 self-center">
                <p className="m-0 font-medium">{t("scrims.noRecentReports")}</p>
                <p className="m-0 text-entry text-muted-foreground">{t("scrims.noWeeklyReportYet")}</p>
              </div>
            )}
          </div>

          <div className="mt-2 flex shrink-0 items-end gap-10">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="text-entry text-muted-foreground">{t("scrims.reputation")}</span>
              <div className="flex items-center gap-2.5">
                <Meter className="flex-1" label={t("scrims.reputation")} value={week.reputation} tone="club" tick={50} showValue={false} />
                <span className="font-heading text-section font-bold tabular-nums">{week.reputation}</span>
              </div>
            </div>
            <div className="flex w-[12.5rem] shrink-0 flex-col gap-1.5">
              <span className="text-entry text-muted-foreground">{t("scrims.cancellations")}</span>
              <span className="font-heading text-section font-bold tabular-nums">{week.cancellations}</span>
            </div>
          </div>

          <ScrimStaffSuggestions suggestions={suggestions} bare />
        </section>
      </div>
    </ScrimViewFrame>
  );
}
