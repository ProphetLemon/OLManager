import { useId } from "react";
import { useTranslation } from "react-i18next";

import type { WeeklyScrimContext, WeeklyScrimSlotContext } from "@/lib/scrims/scrimContext";
import { chipRival, isPlanClearedToday, slotsByDay, type RiskLevel } from "@/lib/scrims/scrimDesk";
import { ResultLetter } from "@/ui-v2/components/ResultLetter";
import { cn } from "@/ui-v2/lib/utils";
import { RiskMarker } from "./RiskMarker";
import { SLOT_STATUSES, SLOT_STATUS_ICON, SLOT_STATUS_KEY } from "./slotStatus";

interface ScrimWeekStripProps {
  week: WeeklyScrimContext;
  teamNameById: ReadonlyMap<string, string>;
  /** Mon..Sun, already translated. */
  weekdayLabels: readonly string[];
  todayOpponentName: string | null;
  /** Only while today's block is still to be played. */
  todayRisk: RiskLevel | null;
}

function SlotChip({
  slot,
  week,
  teamNameById,
  weekdayLabels,
}: {
  slot: WeeklyScrimSlotContext;
  week: WeeklyScrimContext;
  teamNameById: ReadonlyMap<string, string>;
  weekdayLabels: readonly string[];
}) {
  const { t } = useTranslation();
  const rival = chipRival(slot, isPlanClearedToday(slot, week));
  const label = `${weekdayLabels[slot.labelDay] ?? ""}${slot.labelSuffix ? ` ${slot.labelSuffix}` : ""}`.trim();
  const StatusIcon = SLOT_STATUS_ICON[slot.status];
  const hasResult = slot.resultWon != null;
  const quality = slot.report?.quality ?? null;

  return (
    <li className="@container">
      <div
        data-slot="scrim-slot-chip"
        data-status={slot.status}
        className="grid min-h-11 grid-cols-[1.75rem_auto_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0.5 rounded-lg border border-line bg-muted py-1.5 pe-3 ps-2 @[24rem]:grid-cols-[1.75rem_3.25rem_minmax(0,1fr)_auto_auto]"
      >
        <span
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-md font-heading text-base font-bold",
            !hasResult && "border border-dashed border-dim text-transparent",
            hasResult && slot.resultWon && "bg-positive text-positive-foreground",
            hasResult && !slot.resultWon && "bg-negative text-negative-foreground",
          )}
        >
          {hasResult ? <ResultLetter kind={slot.resultWon ? "win" : "loss"} /> : <span aria-hidden="true">-</span>}
        </span>
        <span className="font-heading text-lg font-semibold uppercase leading-none tracking-wide">{label}</span>
        <span
          className={cn(
            "min-w-0 truncate text-sm",
            rival.kind === "team" ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {rival.kind === "team"
            ? teamNameById.get(rival.teamId) ?? rival.teamId
            : rival.kind === "cleared"
              ? t("scrims.planCleared")
              : t("scrims.notPlanned")}
        </span>
        <span className="min-w-9 text-end text-caption tabular-nums text-muted-foreground">
          {quality != null ? `Q${quality}` : ""}
        </span>
        <span className="col-span-3 col-start-2 inline-flex items-center gap-1.5 whitespace-nowrap text-caption text-muted-foreground @[24rem]:col-span-1 @[24rem]:col-start-auto">
          <StatusIcon aria-hidden="true" className="size-4 shrink-0" />
          {t(SLOT_STATUS_KEY[slot.status])}
        </span>
      </div>
    </li>
  );
}

/**
 * The week as one strip: a chip per slot with its day, block, rival, quality, status and result.
 * It also carries today's opponent and risk, which are static facts about the day.
 */
export function ScrimWeekStrip({ week, teamNameById, weekdayLabels, todayOpponentName, todayRisk }: ScrimWeekStripProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const days = slotsByDay(week);

  return (
    <section
      aria-labelledby={headingId}
      data-slot="scrim-week-strip"
      className="flex flex-col gap-3.5 rounded-xl border border-line bg-card p-4 text-card-foreground sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 id={headingId} className="font-heading text-section font-bold uppercase leading-tight tracking-wide">
            {t("scrims.thisWeek")}
          </h2>
          <span className="text-caption tabular-nums text-muted-foreground">
            {t("training.scrims.weekCapacity")}: {week.capacity}
          </span>
        </div>
        <ul aria-label={t("scrims.slotStatusKey")} className="flex flex-wrap gap-x-4 gap-y-1.5 text-caption text-muted-foreground">
          {SLOT_STATUSES.map((status) => {
            const Icon = SLOT_STATUS_ICON[status];
            return (
              <li key={status} className="inline-flex items-center gap-1.5">
                <Icon aria-hidden="true" className="size-4" />
                {t(SLOT_STATUS_KEY[status])}
              </li>
            );
          })}
        </ul>
      </div>

      {todayOpponentName ? (
        <dl className="flex flex-wrap items-end gap-x-8 gap-y-2 border-y border-line py-3" data-slot="scrim-day-bar">
          <div className="flex flex-col gap-0.5">
            <dt className="text-caption text-muted-foreground">{t("scrims.todayOpponent")}</dt>
            <dd className="font-heading text-title font-semibold uppercase leading-none tracking-wide">{todayOpponentName}</dd>
          </div>
          {todayRisk ? (
            <div className="flex flex-col gap-0.5">
              <dt className="text-caption text-muted-foreground">{t("scrims.todayRisk")}</dt>
              <dd className="font-heading text-section font-semibold uppercase leading-tight tracking-wide">
                <RiskMarker level={todayRisk} />
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(18.75rem,100%),1fr))] gap-3">
        {days.map((day) => (
          <div
            key={day.weekday}
            role="group"
            aria-label={t("scrims.dayBlocks", { day: weekdayLabels[day.weekday] ?? "" })}
            className="flex flex-col gap-1.5"
          >
            <div className="font-heading text-base font-semibold uppercase tracking-wide text-muted-foreground">
              {weekdayLabels[day.weekday] ?? ""}
            </div>
            <ul className="flex flex-col gap-1.5">
              {day.slots.map((slot) => (
                <SlotChip key={slot.slotIndex} slot={slot} week={week} teamNameById={teamNameById} weekdayLabels={weekdayLabels} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
