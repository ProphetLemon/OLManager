import { useTranslation } from "react-i18next";
import { ArrowUp } from "lucide-react";

import { cn } from "@/ui-v2/lib/utils";
import { CostMark } from "../EffectText";

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
