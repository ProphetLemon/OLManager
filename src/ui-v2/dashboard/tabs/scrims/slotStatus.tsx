import { Check, CircleCheck, Circle, Lock, Minus, X, type LucideIcon } from "lucide-react";

import type { DisplaySlotStatus } from "@/lib/scrims/scrimDesk";

export type SlotStatus = DisplaySlotStatus;

export const SLOT_STATUSES: readonly SlotStatus[] = ["Open", "Locked", "Played", "Reviewed", "Cancelled", "NotPlayed"];

/** One locale key per status a chip can word: the game's five and a past slot that was never planned. A status is told by its icon and its word, never by colour. */
export const SLOT_STATUS_KEY: Record<SlotStatus, string> = {
  Open: "scrims.slotStatus.open",
  Locked: "scrims.slotStatus.locked",
  Played: "scrims.slotStatus.played",
  Reviewed: "scrims.slotStatus.reviewed",
  Cancelled: "scrims.slotStatus.cancelled",
  NotPlayed: "scrims.slotStatus.notPlayed",
};

export const SLOT_STATUS_ICON: Record<SlotStatus, LucideIcon> = {
  Open: Circle,
  Locked: Lock,
  Played: Check,
  Reviewed: CircleCheck,
  Cancelled: X,
  NotPlayed: Minus,
};
