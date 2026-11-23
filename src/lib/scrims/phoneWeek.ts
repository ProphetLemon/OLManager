import type { ScrimFocus } from "@/store/gameStore";
import type { TodayScrimContext, WeeklyScrimContext, WeeklyScrimSlotContext } from "./scrimContext";
import { chipRival, deskPanel, displaySlotStatus, isPlanClearedToday, slotsByDay, type ChipRival, type DisplaySlotStatus } from "./scrimDesk";

/**
 * The week of the Scrims tab on the phone, as data: the cells of the left list, which one carries a
 * tag, which one the right pane opens on and where "Done" leads. Pure: it returns ids, keys and
 * values, and the component words them.
 */

export type PhoneTag = "next" | "today" | "decide";
export type PhoneRowId = "objective" | "volume" | "report" | `slot:${number}`;

export const slotRowId = (slotIndex: number): PhoneRowId => `slot:${slotIndex}`;

interface PhoneCellBase {
  id: PhoneRowId;
  tag: PhoneTag | null;
}

export interface PhoneObjectiveCell extends PhoneCellBase {
  kind: "objective";
  objective: ScrimFocus | null;
  /** The week is finalized or the assistant handles it: the pane shows it read-only. */
  locked: boolean;
}

export interface PhoneVolumeCell extends PhoneCellBase {
  kind: "volume";
  capacity: number;
  /** The distinct scrim weekdays, Monday-based, in week order. */
  days: number[];
  locked: boolean;
}

export interface PhoneReportCell extends PhoneCellBase {
  kind: "report";
  wins: number;
  losses: number;
}

export interface PhoneSlotCell extends PhoneCellBase {
  kind: "slot";
  slotIndex: number;
  /** Monday-based weekday of the label, an index into the translated weekday names. */
  weekday: number;
  /** "A" or "B", empty when the day has a single block. */
  suffix: string;
  status: DisplaySlotStatus;
  rival: ChipRival;
  result: "won" | "lost" | null;
  quality: number | null;
}

export type PhoneCell = PhoneObjectiveCell | PhoneVolumeCell | PhoneReportCell | PhoneSlotCell;

export interface PhoneGauges {
  planned: number;
  capacity: number;
  /** One flag per slot, in slot order. */
  plannedSlots: boolean[];
  wins: number;
  losses: number;
  reputation: number;
  cancellations: number;
}

export interface PhoneWeekModel {
  /** Visual rows, top to bottom: [objective], [volume, report], then one row per scrim weekday. */
  rows: PhoneCell[][];
  /** The row the right pane opens on. */
  openRow: PhoneRowId;
  gauges: PhoneGauges;
}

export interface PhoneWeekInput {
  week: WeeklyScrimContext;
  today: TodayScrimContext;
  /** The setup cannot be changed by the manager (the assistant handles scrims). */
  readOnly?: boolean;
}

const isPlanned = (slot: WeeklyScrimSlotContext) => slot.plan.length > 0 || slot.resolvedOpponentTeamId != null;

/** A slot the manager can still plan: not past, not played, and the week is neither finalized nor handled by the assistant. */
export function isEditable(slot: WeeklyScrimSlotContext, week: WeeklyScrimContext, readOnly: boolean): boolean {
  return !readOnly && !week.setupLocked && slot.canEdit;
}

function setupEditable(week: WeeklyScrimContext, readOnly: boolean): boolean {
  return week.slots.some((slot) => isEditable(slot, week, readOnly));
}

/** Decide, then Today, then Next: only one row of the week carries a tag. */
function pickTag({ week, today, readOnly = false }: PhoneWeekInput): { id: PhoneRowId; tag: PhoneTag } | null {
  if (deskPanel(today, week) === "decision" && today.report) {
    return { id: slotRowId(today.report.slot_index), tag: "decide" };
  }

  const todaySlot = today.slotIndex != null ? week.slots.find((slot) => slot.slotIndex === today.slotIndex) : undefined;
  const toBePlayed = todaySlot && (todaySlot.status === "Open" || todaySlot.status === "Locked") && todaySlot.plan.length > 0;
  if ((today.state === "Planned" || today.state === "Confirmed") && today.canEditPlan && toBePlayed) {
    return { id: slotRowId(todaySlot.slotIndex), tag: "today" };
  }

  if (!setupEditable(week, readOnly)) return null;
  if (week.objective == null && week.planned === 0) return { id: "objective", tag: "next" };
  const next = week.slots.find((slot) => isEditable(slot, week, readOnly) && slot.plan.length === 0);
  return next ? { id: slotRowId(next.slotIndex), tag: "next" } : null;
}

function slotCell(slot: WeeklyScrimSlotContext, week: WeeklyScrimContext): PhoneSlotCell {
  return {
    kind: "slot",
    id: slotRowId(slot.slotIndex),
    tag: null,
    slotIndex: slot.slotIndex,
    weekday: slot.labelDay,
    suffix: slot.labelSuffix,
    status: displaySlotStatus(slot, week),
    rival: chipRival(slot, isPlanClearedToday(slot, week)),
    result: slot.resultWon == null ? null : slot.resultWon ? "won" : "lost",
    quality: slot.report?.quality ?? null,
  };
}

export function buildPhoneWeek(input: PhoneWeekInput): PhoneWeekModel {
  const { week, readOnly = false } = input;
  const picked = pickTag(input);
  const locked = week.setupLocked || readOnly;
  const withTag = <T extends PhoneCell>(cell: T): T => (picked?.id === cell.id ? { ...cell, tag: picked.tag } : cell);

  const rows: PhoneCell[][] = [
    [withTag({ kind: "objective", id: "objective", tag: null, objective: week.objective, locked })],
    [
      withTag({ kind: "volume", id: "volume", tag: null, capacity: week.capacity, days: slotsByDay(week).map((day) => day.weekday), locked }),
      withTag({ kind: "report", id: "report", tag: null, wins: week.wins, losses: week.losses }),
    ],
    ...slotsByDay(week).map((day) => day.slots.map((slot) => withTag(slotCell(slot, week)))),
  ];

  return {
    rows,
    openRow: picked?.id ?? (setupEditable(week, readOnly) ? "volume" : "report"),
    gauges: {
      planned: week.planned,
      capacity: week.capacity,
      plannedSlots: week.slots.map(isPlanned),
      wins: week.wins,
      losses: week.losses,
      reputation: week.reputation,
      cancellations: week.cancellations,
    },
  };
}

/**
 * Where "Done" leads from a slot: the next editable slot after it with no Plan A, else the next
 * editable slot in order, and after the last one the Volume row (Autofill and Finalize live there).
 */
export function phoneDoneTarget(week: WeeklyScrimContext, fromSlotIndex: number, readOnly = false): PhoneRowId {
  const after = week.slots.filter((slot) => slot.slotIndex > fromSlotIndex && isEditable(slot, week, readOnly));
  const target = after.find((slot) => slot.plan.length === 0) ?? after[0];
  return target ? slotRowId(target.slotIndex) : "volume";
}
