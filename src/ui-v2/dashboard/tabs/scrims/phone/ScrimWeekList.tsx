import { useEffect, useId, useMemo, useRef, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Lock } from "lucide-react";

import { useRovingFocus } from "@/hooks/useRovingFocus";
import type { PhoneCell, PhoneRowId, PhoneSlotCell, PhoneTag, PhoneWeekModel } from "@/lib/scrims/phoneWeek";
import { SCRIM_FOCUS_OBJECTIVE_KEYS } from "@/lib/scrims/scrimFocusKeys";
import { ResultLetter } from "@/ui-v2/components/ResultLetter";
import { cn } from "@/ui-v2/lib/utils";
import { SLOT_STATUS_ICON, SLOT_STATUS_KEY } from "../slotStatus";

export interface ScrimWeekListProps {
  model: PhoneWeekModel;
  /** The row the right pane shows. */
  selectedId: PhoneRowId;
  teamNameById: ReadonlyMap<string, string>;
  /** Mon..Sun, already translated. */
  weekdayLabels: readonly string[];
  /** The reputation a cancel would leave, marked on the Scrim rep bar. Nothing is marked before that choice. */
  ghostReputation?: number | null;
  onSelect: (rowId: PhoneRowId) => void;
}

const TAG_TEXT: Record<PhoneTag, { key: string; fallback: string }> = {
  next: { key: "scrims.phone.tagNext", fallback: "Next" },
  today: { key: "scrims.phone.tagToday", fallback: "Today" },
  decide: { key: "scrims.phone.tagDecide", fallback: "Decide" },
};

/** Where each cell sits on screen, so Up and Down keep the column across rows of different widths. */
function gridPositions(rows: PhoneCell[][]) {
  return rows.flatMap((row, r) => row.map((cell, c) => ({ id: cell.id, row: r, col: c, width: row.length })));
}

function Tag({ tag }: { tag: PhoneTag }) {
  const { t } = useTranslation();
  const { key, fallback } = TAG_TEXT[tag];
  return (
    <span
      data-slot="phone-week-tag"
      className="inline-flex h-6 shrink-0 items-center rounded-sm bg-club px-2 font-heading text-caption font-bold uppercase leading-none text-club-foreground"
    >
      {t(key, { defaultValue: fallback })}
    </span>
  );
}

/** A status told by an icon and a word: the icon is decorative, the word is read. */
function StatusMark({ status, locked }: { status: PhoneSlotCell["status"] | "Locked"; locked?: boolean }) {
  const { t } = useTranslation();
  if (status === "Open" && !locked) return null;
  const Icon = status === "Locked" ? Lock : SLOT_STATUS_ICON[status];
  return (
    <>
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="sr-only">, {t(SLOT_STATUS_KEY[status])}, </span>
    </>
  );
}

function SlotValue({ cell, teamNameById }: { cell: PhoneSlotCell; teamNameById: ReadonlyMap<string, string> }) {
  const { t } = useTranslation();
  const rivalName = cell.rival.kind === "team" ? (teamNameById.get(cell.rival.teamId) ?? cell.rival.teamId) : null;
  if (cell.result) {
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          className={cn(
            "inline-flex size-5 shrink-0 items-center justify-center rounded-sm font-heading text-caption font-bold leading-none",
            cell.result === "won" ? "bg-positive text-positive-foreground" : "bg-negative text-negative-foreground",
          )}
        >
          <ResultLetter kind={cell.result === "won" ? "win" : "loss"} />
        </span>
        {rivalName ? <span className="sr-only">, {rivalName}</span> : null}
        {cell.quality != null ? (
          <>
            <span aria-hidden="true" className="text-entry tabular-nums">Q{cell.quality}</span>
            <span className="sr-only">, {t("scrims.reportQuality")} {cell.quality}</span>
          </>
        ) : null}
      </span>
    );
  }
  const planned = cell.rival.kind === "team";
  return (
    <span className={cn("truncate text-entry", planned ? "text-foreground" : "text-muted-foreground")}>
      {rivalName ?? (cell.rival.kind === "cleared" ? t("scrims.planCleared") : t("scrims.notPlanned"))}
    </span>
  );
}

/** The two lines of a cell: a short label over its value. */
function CellText({ cell, teamNameById, weekdayLabels }: { cell: PhoneCell; teamNameById: ReadonlyMap<string, string>; weekdayLabels: readonly string[] }) {
  const { t } = useTranslation();
  let label: string;
  let value: React.ReactNode;
  let status: React.ReactNode = null;
  switch (cell.kind) {
    case "objective":
      label = t("scrims.phone.objective", { defaultValue: "Objective" });
      value = cell.objective ? t(SCRIM_FOCUS_OBJECTIVE_KEYS[cell.objective]) : t("training.scrims.objectives.none");
      status = cell.locked ? <StatusMark status="Locked" locked /> : null;
      break;
    case "volume":
      label = t("scrims.phone.volume", { defaultValue: "Volume" });
      value = [cell.capacity, ...cell.days.map((day) => weekdayLabels[day] ?? "")].join(", ");
      status = cell.locked ? <StatusMark status="Locked" locked /> : null;
      break;
    case "report":
      label = t("scrims.phone.report", { defaultValue: "Report" });
      value = cell.wins + cell.losses > 0 ? `${t("scrims.weekRecord")} ${cell.wins}-${cell.losses}` : t("scrims.noRecentReports");
      break;
    case "slot":
      label = `${weekdayLabels[cell.weekday] ?? ""} ${cell.suffix}`.trim();
      value = <SlotValue cell={cell} teamNameById={teamNameById} />;
      status = <StatusMark status={cell.status} />;
      break;
  }
  const slot = cell.kind === "slot";
  return (
    <span className="flex min-w-0 flex-1 flex-col justify-center">
      <span className="flex items-center gap-1">
        <span className={cn("truncate font-heading uppercase leading-tight", slot ? "text-entry font-bold" : "text-caption text-muted-foreground")}>
          {label}
        </span>
        {status}
      </span>
      {typeof value === "string" ? <span className="truncate text-entry leading-tight">{value}</span> : value}
    </span>
  );
}

function Gauges({ model, ghostReputation }: Pick<ScrimWeekListProps, "model" | "ghostReputation">) {
  const { t } = useTranslation();
  const noteId = useId();
  const { planned, capacity, plannedSlots, wins, losses, reputation, cancellations } = model.gauges;
  const repPercent = Math.min(100, Math.max(0, reputation));
  const ghost = ghostReputation != null && ghostReputation !== reputation ? ghostReputation : null;
  const line = "flex min-h-[1.3125rem] min-w-0 flex-col justify-end px-3 py-0.5";
  const head = "flex items-baseline justify-between gap-2 font-heading text-caption uppercase leading-none";

  return (
    <div data-slot="phone-week-gauges" className="grid grid-cols-2 border-t border-line">
      <div className={line}>
        <div className={head}>
          <span className="truncate text-muted-foreground">{t("scrims.planned")}</span>
          <span className="tabular-nums text-foreground">{planned}/{capacity}</span>
        </div>
        <div
          role="meter"
          aria-label={t("scrims.planned")}
          aria-valuemin={0}
          aria-valuemax={capacity}
          aria-valuenow={planned}
          aria-valuetext={`${planned}/${capacity}`}
          className="mt-0.5 flex gap-0.5"
        >
          {Array.from({ length: capacity }).map((_, index) => (
            <span key={index} className={cn("h-0.5 flex-1", plannedSlots[index] ? "bg-foreground" : "bg-dim")} />
          ))}
        </div>
      </div>
      <div className={cn(line, "border-s border-line")}>
        <div className={head}>
          <span className="truncate text-muted-foreground">{t("scrims.weekRecord")}</span>
          <span className="tabular-nums text-foreground">{wins}-{losses}</span>
        </div>
      </div>
      <div className={cn(line, "border-t border-line")}>
        <div className={head}>
          <span className="truncate text-muted-foreground">{t("scrims.reputation")}</span>
          <span className="tabular-nums text-foreground">{reputation}</span>
        </div>
        <div
          role="meter"
          aria-label={t("scrims.reputation")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={repPercent}
          aria-valuetext={String(reputation)}
          aria-describedby={ghost != null ? noteId : undefined}
          className="relative mt-0.5 h-0.5 bg-dim"
        >
          <div className="absolute inset-y-0 start-0 bg-foreground" style={{ width: `${repPercent}%` }} />
          {ghost != null ? (
            <div
              data-slot="scrim-rep-ghost"
              aria-hidden="true"
              className="absolute -inset-y-1 w-0 border-s-2 border-dashed border-warning"
              style={{ insetInlineStart: `${Math.min(100, Math.max(0, ghost))}%` }}
            />
          ) : null}
        </div>
        {ghost != null ? <span id={noteId} className="sr-only">{t("scrims.repGhostNote", { value: ghost })}</span> : null}
      </div>
      <div className={cn(line, "border-s border-t border-line")}>
        <div className={head}>
          <span className="truncate text-muted-foreground">{t("scrims.cancellations")}</span>
          <span className="tabular-nums text-foreground">{cancellations}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * The week as the left list of the phone's two panes: the objective, volume and report cells and a
 * block A and B cell per scrim day, with the gauges under them. It only shows what the model says
 * and reports taps; every cell is a real button (`--hit` high) and a locked one keeps its place.
 */
export function ScrimWeekList({ model, selectedId, teamNameById, weekdayLabels, ghostReputation = null, onSelect }: ScrimWeekListProps) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement>(null);
  const positions = useMemo(() => gridPositions(model.rows), [model.rows]);
  const ids = positions.map((p) => p.id);

  const { activeIndex, shouldFocus, setActiveIndex, handleKeyDown, getTabIndex } = useRovingFocus({
    itemCount: ids.length,
    loop: false,
    // The selected cell is the tab stop; a pane change from outside never moves focus.
    index: ids.indexOf(selectedId),
    focusOnMount: false,
    onKey: (event, index) => {
      // Enter and Space stay with the button, so a key press selects once.
      if (event.key === "Enter" || event.key === " ") return true;
      const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
      if (step === 0) return false;
      event.preventDefault();
      const from = positions[index];
      const target = from && positions.find((p) => p.row === from.row + step && p.col === Math.min(from.col, p.width - 1));
      if (target) setActiveIndex(positions.indexOf(target));
      return true;
    },
  });
  const activeId = ids[activeIndex];

  // Follow the arrows, only while focus is inside the list.
  useEffect(() => {
    if (!shouldFocus || !activeId || !listRef.current?.contains(document.activeElement)) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-row-id="${activeId}"]`);
    if (el && el !== document.activeElement) el.focus({ preventScroll: true });
  }, [shouldFocus, activeId]);

  let flat = -1;
  return (
    <div data-slot="phone-week-list" className="flex min-h-0 flex-col overflow-hidden bg-card text-card-foreground">
      <div
        ref={listRef}
        role="group"
        aria-label={t("scrims.phone.weekList", { defaultValue: "Scrims week" })}
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => handleKeyDown(event)}
        className="flex flex-col divide-y divide-line"
      >
        {model.rows.map((row, r) => (
          <div key={r} className={cn("grid divide-x divide-line", row.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
            {row.map((cell) => {
              const index = ++flat;
              const selected = cell.id === selectedId;
              return (
                <button
                  key={cell.id}
                  type="button"
                  data-slot="phone-week-cell"
                  data-row-id={cell.id}
                  aria-current={selected ? "true" : undefined}
                  tabIndex={getTabIndex(index)}
                  onFocus={() => index !== activeIndex && setActiveIndex(index)}
                  onClick={() => onSelect(cell.id)}
                  className={cn(
                    "flex min-h-[var(--hit)] w-full min-w-0 items-center gap-2 px-3 py-1 text-start outline-hidden transition-colors",
                    "hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    selected && "outline-2 -outline-offset-2 outline-solid outline-club",
                  )}
                >
                  {cell.tag ? <Tag tag={cell.tag} /> : null}
                  <CellText cell={cell} teamNameById={teamNameById} weekdayLabels={weekdayLabels} />
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <Gauges model={model} ghostReputation={ghostReputation} />
    </div>
  );
}
