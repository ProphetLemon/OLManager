import { useTranslation } from "react-i18next";
import { ArrowUp, TriangleAlert } from "lucide-react";

import { cn } from "@/ui-v2/lib/utils";
import { CostMark, usePlayerChanges } from "../EffectText";

export type ChangeTone = "gain" | "cost";

/**
 * A before-and-after number (K2, K3). A gain wears the up arrow; a cost wears the dashed "Cost" chip
 * (warning icon and the word). The colour only repeats what the icon or the word already says.
 */
export function ChangeValue({ tone, before, after, big }: { tone: ChangeTone; before: number; after: number; big?: boolean }) {
  const { t } = useTranslation();
  return (
    <span
      data-slot="phone-change"
      data-tone={tone}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap font-semibold tabular-nums",
        tone === "gain" ? "text-positive" : "text-warning",
        big && "font-heading text-section leading-none",
      )}
    >
      {tone === "gain" ? (
        <>
          <ArrowUp aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2.5} />
          <span className="sr-only">{t("scrims.tagBenefit")}: </span>
        </>
      ) : (
        <CostMark />
      )}
      <span>
        {before} → {after}
      </span>
    </span>
  );
}

/** What a decision does to the five picked players, in words, with the arrow or the warning icon. Losing morale or condition is a cost. */
export function PlayersChange({ morale, condition, label = true }: { morale: number; condition: number; label?: boolean }) {
  const { t } = useTranslation();
  const playerChanges = usePlayerChanges();
  const cost = morale < 0 || condition < 0;
  const Icon = cost ? TriangleAlert : ArrowUp;
  const changes = playerChanges(morale, condition);
  return (
    <span data-slot="phone-change" data-tone={cost ? "cost" : "gain"} className="inline-flex items-center gap-1.5">
      <Icon aria-hidden="true" className={cn("size-3.5 shrink-0", cost ? "text-warning" : "text-positive")} strokeWidth={2.5} />
      <span className="sr-only">{cost ? t("scrims.tagCost") : t("scrims.tagBenefit")}: </span>
      <span>{label ? t("scrims.effect.players", { changes }) : changes}</span>
    </span>
  );
}
