import { useId, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronRight } from "lucide-react";

import type { RivalRow } from "@/lib/scrims/rivalOdds";
import { cn } from "@/ui-v2/lib/utils";
import { LockLine, PaneHeading } from "./PhonePanePieces";

export interface ScrimSlotPaneProps {
  /** "Thu A": names the pane. */
  slotLabel: string;
  /** Plan A, B and C as team ids, an empty string where nothing is set. */
  plan: readonly string[];
  /** The rivals of the competition, strongest first (`buildRivalRows`). */
  rivals: readonly RivalRow[];
  teamNameById: ReadonlyMap<string, string>;
  /** The slot can no longer be edited (locked, past or played): the plans show as text and there is no grid. */
  readOnly: boolean;
  /** A save is running: the cells keep their place but a tap does nothing. */
  disabled: boolean;
  /** Why the slot is locked; shown on the first line of the read-only form. */
  blockedText: string | null;
  /** Where "Done" leads, already worded ("Thu B", "Volume"). */
  doneTo: string;
  /** The rival this slot actually played, for the "Played" mark. */
  resolvedTeamId: string | null;
  /** The plan was cleared today (wording of the read-only form). */
  cleared: boolean;
  /** Saves one plan at once; an empty `teamId` clears it. */
  onPick: (priorityIndex: number, teamId: string) => void;
  onDone: () => void;
}

const PLANS = [0, 1, 2] as const;
const PLAN_KEYS = ["training.scrims.planA", "training.scrims.planB", "training.scrims.planC"] as const;

/**
 * Moment 2: the tab row (Done, Plan A, B, C), the rivals of the competition as a two-column grid
 * that scrolls on its own, and the note under it. Mount it with a key per slot so the active tab
 * starts on Plan A. Read-only, it lists the three plans as text.
 */
export function ScrimSlotPane(props: ScrimSlotPaneProps) {
  return props.readOnly ? <ReadOnlySlot {...props} /> : <EditableSlot {...props} />;
}

function ReadOnlySlot({ slotLabel, plan, teamNameById, blockedText, resolvedTeamId, cleared }: ScrimSlotPaneProps) {
  const { t } = useTranslation();
  const headingId = useId();
  return (
    <div data-slot="scrim-slot-pane" role="group" aria-labelledby={headingId} className="flex h-full min-h-0 flex-col gap-2 p-4">
      <PaneHeading id={headingId}>{slotLabel}</PaneHeading>
      {blockedText ? <LockLine>{blockedText}</LockLine> : null}
      <ul className="flex flex-col gap-2">
        {PLANS.map((index) => {
          const value = plan[index] ?? "";
          const text = value
            ? (teamNameById.get(value) ?? value)
            : cleared
              ? index === 0 ? t("scrims.planCleared") : "-"
              : index === 0 ? t("scrims.noOpponentSet") : t("training.scrims.noFallback");
          return (
            <li key={index} className="flex min-h-[var(--hit)] items-center gap-3 rounded-lg border border-line bg-muted px-3">
              <span className="w-14 shrink-0 font-heading text-entry font-bold uppercase tracking-wide text-muted-foreground">{t(PLAN_KEYS[index])}</span>
              <span className={cn("min-w-0 flex-1 truncate text-entry", value ? "text-foreground" : "text-muted-foreground")}>{text}</span>
              {value && resolvedTeamId === value ? (
                <span className="shrink-0 rounded border border-positive px-1.5 py-px text-caption text-positive">{t("scrims.played")}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function EditableSlot({ slotLabel, plan, rivals, teamNameById, disabled, doneTo, onPick, onDone }: ScrimSlotPaneProps) {
  const { t } = useTranslation();
  const [active, setActive] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const own = plan[active] ?? "";

  const select = (index: number) => {
    setActive(index);
    tabRefs.current[index]?.focus();
  };
  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const target = event.key === "Home" ? 0 : event.key === "End" ? 2 : (active + step + 3) % 3;
    if (step === 0 && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    select(target);
  };

  const pick = (teamId: string) => {
    if (disabled || own === teamId) return;
    onPick(active, teamId);
    if (teamId !== "" && active < 2) setActive(active + 1);
  };

  const tabValue = (index: number) => {
    const id = plan[index] ?? "";
    if (id) return teamNameById.get(id) ?? id;
    if (index === active) return t("scrims.phone.choosing", { defaultValue: "Choosing" });
    return index === 0 ? t("scrims.notPlanned") : t("training.scrims.noFallback");
  };

  const cell = "flex min-h-[var(--hit)] min-w-0 flex-col justify-center rounded-lg border px-3 py-1 text-start outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-default";
  const mark = <Check data-slot="choice-check" aria-hidden="true" className="size-5 shrink-0" />;

  return (
    <div data-slot="scrim-slot-pane" role="group" aria-label={slotLabel} className="flex h-full min-h-0 flex-col gap-1 p-1">
      <div className="flex shrink-0 gap-1">
        <button
          type="button"
          onClick={onDone}
          className="flex min-h-[var(--hit)] w-[6.25rem] shrink-0 items-center justify-between gap-1 rounded-lg border border-border bg-background px-2 text-start outline-hidden hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="font-heading text-entry font-bold uppercase tracking-wide">{t("common.done")}</span>
            <span className="truncate text-caption text-muted-foreground">{doneTo}</span>
          </span>
          <ChevronRight aria-hidden="true" className="size-4 shrink-0" />
        </button>
        <div role="tablist" aria-label={t("scrims.opponentPlans")} onKeyDown={onTabKey} className="grid min-w-0 flex-1 grid-cols-3 gap-1">
          {PLANS.map((index) => (
            <button
              key={index}
              ref={(el) => {
                tabRefs.current[index] = el;
              }}
              type="button"
              role="tab"
              aria-selected={active === index}
              tabIndex={active === index ? 0 : -1}
              onClick={() => setActive(index)}
              className={cn(
                "flex min-h-[var(--hit)] min-w-0 flex-col justify-center border-b-2 px-2 text-start leading-tight outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                active === index ? "border-club bg-card" : "border-transparent",
              )}
            >
              <span className={cn("font-heading text-entry uppercase tracking-wide", active === index ? "font-bold" : "font-semibold text-muted-foreground")}>
                {t(PLAN_KEYS[index])}
              </span>
              <span className="truncate text-caption text-muted-foreground">{tabValue(index)}</span>
            </button>
          ))}
        </div>
      </div>

      <div
        role="group"
        aria-label={t("scrims.rivalsTable")}
        data-slot="slot-rivals-grid"
        className="grid min-h-0 flex-1 grid-cols-2 content-start gap-1 overflow-y-auto"
      >
        {rivals.map((rival) => {
          const heldBy = plan.findIndex((id, index) => index !== active && id === rival.teamId);
          const chosen = own === rival.teamId;
          if (heldBy >= 0) {
            return (
              <button
                key={rival.teamId}
                type="button"
                aria-disabled="true"
                className={cn(cell, "border-line bg-muted opacity-80")}
              >
                <span className="truncate text-entry font-medium leading-tight">{rival.name}</span>
                <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
                  <span className="inline-flex size-5 items-center justify-center rounded-sm border border-line font-heading font-bold">{"ABC"[heldBy]}</span>
                  {mark}
                  {t(PLAN_KEYS[heldBy])}
                </span>
              </button>
            );
          }
          return (
            <button
              key={rival.teamId}
              type="button"
              aria-pressed={chosen}
              aria-disabled={disabled || undefined}
              onClick={() => pick(rival.teamId)}
              className={cn(cell, "border-line bg-card hover:bg-muted aria-disabled:opacity-65", chosen && "outline-2 -outline-offset-2 outline-solid outline-club")}
            >
              <span className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-entry font-medium leading-tight">{rival.name}</span>
                {chosen ? mark : null}
                <span className="shrink-0 font-heading text-caption tabular-nums text-muted-foreground">OVR {rival.ovr}</span>
              </span>
              <span className="flex min-w-0 gap-2 font-heading text-caption tabular-nums text-muted-foreground">
                <span>{t("scrims.rivalRep")} {rival.reputation}</span>
                <span>{t("scrims.rivalWin")} {rival.winPercent}%</span>
                <span className="truncate">{t("scrims.rivalAccepts")} {rival.acceptPercent}%</span>
              </span>
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={own === ""}
          aria-disabled={disabled || undefined}
          onClick={() => pick("")}
          className={cn(cell, "flex-row items-center justify-between border-line bg-card hover:bg-muted aria-disabled:opacity-65", own === "" && "outline-2 -outline-offset-2 outline-solid outline-club")}
        >
          <span className="text-entry font-medium">{active === 0 ? t("scrims.notPlanned") : t("training.scrims.noFallback")}</span>
          {own === "" ? mark : null}
        </button>
      </div>

      <p role="note" className="shrink-0 px-2 pb-1 text-caption leading-snug text-muted-foreground">
        {active === 0
          ? t("scrims.phone.noteWinAccepts", { defaultValue: "Win is your chance to win the scrim. Accepts is the chance this rival takes a slot with two or more plans." })
          : t("scrims.phone.notePlans", { defaultValue: "A slot with one plan always plays it, and Plan A plays if every plan declines." })}
      </p>
    </div>
  );
}
