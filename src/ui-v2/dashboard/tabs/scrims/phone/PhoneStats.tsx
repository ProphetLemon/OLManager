import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, Smile, Star, Zap, type LucideIcon } from "lucide-react";

import { cn } from "@/ui-v2/lib/utils";

/** The three stats of a decision, always in this order: the table's columns, the review's rows and the spoken name. */
export const STATS = ["quality", "morale", "energy"] as const;
export type StatId = (typeof STATS)[number];

export const STAT_KEYS: Record<StatId, string> = {
  quality: "scrims.reportQuality",
  morale: "scrims.phone.statMorale",
  energy: "scrims.phone.statEnergy",
};

export const STAT_ICONS: Record<StatId, LucideIcon> = { quality: Star, morale: Smile, energy: Zap };

/** The change of each stat of an option or a result: Calidad also says where it ends. */
export interface StatChange {
  delta: number;
  /** Calidad only: the value it ends at. */
  end?: number;
}

/** A real minus sign, so a drop reads as a number and never as a hyphen. */
export const signedText = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0");

/**
 * One change: an up arrow and +n in the positive colour for a rise, a DOWN arrow and the minus in the
 * amber for a drop, a dash in the dim token for no change. A change is never told by colour alone.
 * Hidden from assistive technology: the row's name says it in words.
 */
export function StatValue({ change, className }: { change: StatChange; className?: string }) {
  if (change.delta === 0) {
    return (
      <span data-slot="stat-value" data-change="none" aria-hidden="true" className={cn("text-entry font-semibold text-dim", className)}>
        {"—"}
      </span>
    );
  }
  const up = change.delta > 0;
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <span
      data-slot="stat-value"
      data-change={up ? "up" : "down"}
      aria-hidden="true"
      className={cn("inline-flex items-baseline gap-1 whitespace-nowrap font-heading text-section font-bold leading-none tabular-nums", up ? "text-positive" : "text-warning", className)}
    >
      <Icon className="size-4 shrink-0 self-center" strokeWidth={3} />
      {signedText(change.delta)}
      {change.end != null ? <span className="font-sans text-caption font-medium text-muted-foreground">{"→"} {change.end}</span> : null}
    </span>
  );
}

/** "Calidad sube 6, acaba en 65", "Moral: sin cambio": one stat in words, for the accessible name. */
export function useStatWords() {
  const { t } = useTranslation();
  return (stat: StatId, change: StatChange): string => {
    const name = t(STAT_KEYS[stat]);
    if (change.delta === 0) return t("scrims.phone.changeNone", { stat: name });
    const n = Math.abs(change.delta);
    const words = t(change.delta > 0 ? "scrims.phone.changeUp" : "scrims.phone.changeDown", { stat: name, n });
    return change.end != null ? `${words}, ${t("scrims.phone.changeEnds", { n: change.end })}` : words;
  };
}
