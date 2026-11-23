import { useId } from "react";
import { useTranslation } from "react-i18next";
import { CircleCheck, CircleDot, Clock, Minus, X, type LucideIcon } from "lucide-react";

import type { ScrimDayState } from "@/lib/scrims/scrimContext";
import { dayStateKey, type RiskLevel } from "@/lib/scrims/scrimDesk";
import { RiskMarker } from "../RiskMarker";
import { LockLine, PaneHeading } from "./PhonePanePieces";

export interface ScrimTodayPaneProps {
  /** "Wed A": the block of today the pane is about. */
  slotLabel: string;
  dayState: ScrimDayState;
  /** What the day asks of the manager, already worded for the state of the day. */
  message: string;
  /** Today's opponent and risk; null once the block was played or cancelled. */
  facts: { opponent: string | null; risk: RiskLevel | null } | null;
  /** Plan A, B and C as rival names, null where empty; null once there is nothing to play. */
  plans: readonly [string | null, string | null, string | null] | null;
  /** The lock or assistant sentence; null when there is none. */
  lockText: string | null;
}

// An icon and a word tell the state, never colour alone.
const BADGE_ICON: Record<ScrimDayState, LucideIcon> = {
  Planned: Clock,
  Confirmed: Clock,
  PlayedNeedsReview: CircleDot,
  Reviewed: CircleCheck,
  Cancelled: X,
  NoScrimToday: Minus,
};

const PLAN_LABELS = ["training.scrims.planA", "training.scrims.planB", "training.scrims.planC"] as const;
const PLAN_LETTERS = ["A", "B", "C"] as const;

/** Moment 4: today's block, read-only. Nothing here is a control; "what now" is Continue, and the sentence says so. */
export function ScrimTodayPane({ slotLabel, dayState, message, facts, plans, lockText }: ScrimTodayPaneProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const Icon = BADGE_ICON[dayState];

  return (
    <div
      data-slot="scrim-today-pane"
      role="group"
      aria-labelledby={headingId}
      className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto p-2"
    >
      <div className="flex shrink-0 items-center justify-between gap-2">
        <PaneHeading id={headingId}>
          {t("scrims.todayBlock")} <span className="text-muted-foreground">{slotLabel}</span>
        </PaneHeading>
        <span
          data-slot="day-badge"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-entry font-medium leading-none"
        >
          <Icon aria-hidden="true" className="size-4" />
          {t(dayStateKey(dayState))}
        </span>
      </div>
      <p className="shrink-0 text-entry leading-snug">{message}</p>
      {facts ? (
        <dl className="grid shrink-0 grid-cols-2 gap-2">
          <div className="flex min-h-[var(--hit)] min-w-0 flex-col justify-center rounded-lg bg-muted px-3 py-1">
            <dt className="truncate text-caption text-muted-foreground">{t("scrims.todayOpponent")}</dt>
            <dd className="truncate font-heading text-entry font-semibold uppercase tracking-wide">
              {facts.opponent ?? t("scrims.noOpponentSet")}
            </dd>
          </div>
          {facts.risk ? (
            <div className="flex min-h-[var(--hit)] min-w-0 flex-col justify-center rounded-lg bg-muted px-3 py-1">
              <dt className="truncate text-caption text-muted-foreground">{t("scrims.todayRisk")}</dt>
              <dd className="font-heading text-entry font-semibold uppercase tracking-wide">
                <RiskMarker level={facts.risk} />
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {plans ? (
        <ul aria-label={t("scrims.opponentPlans")} className="grid shrink-0 grid-cols-3 gap-2">
          {plans.map((name, index) => (
            <li key={PLAN_LETTERS[index]} className="flex min-h-[var(--hit)] min-w-0 items-center gap-2 rounded-lg bg-muted px-2 py-1">
              <span
                aria-hidden="true"
                className="inline-flex size-6 shrink-0 items-center justify-center rounded border border-line font-heading text-caption font-bold"
              >
                {PLAN_LETTERS[index]}
              </span>
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-caption text-muted-foreground">{t(PLAN_LABELS[index])}</span>
                <span className="truncate text-entry font-medium">
                  {name ?? (index === 0 ? t("scrims.noOpponentSet") : t("training.scrims.noFallback"))}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {lockText ? <LockLine className="mt-auto">{lockText}</LockLine> : null}
    </div>
  );
}
