import { Check, CircleCheck, Circle, Lock, X, type LucideIcon } from "lucide-react";

import type { WeeklyScrimSlotContext } from "@/lib/scrims/scrimContext";

export type SlotStatus = WeeklyScrimSlotContext["status"];

export const SLOT_STATUSES: readonly SlotStatus[] = ["Open", "Locked", "Played", "Reviewed", "Cancelled"];

/** One locale key per status the game reports. A status is told by its icon and its word, never by colour. */
export const SLOT_STATUS_KEY: Record<SlotStatus, string> = {
  Open: "scrims.slotStatus.open",
  Locked: "scrims.slotStatus.locked",
  Played: "scrims.slotStatus.played",
  Reviewed: "scrims.slotStatus.reviewed",
  Cancelled: "scrims.slotStatus.cancelled",
};

export const SLOT_STATUS_ICON: Record<SlotStatus, LucideIcon> = {
  Open: Circle,
  Locked: Lock,
  Played: Check,
  Reviewed: CircleCheck,
  Cancelled: X,
};
