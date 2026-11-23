import { useTranslation } from "react-i18next";

import { isScrimTagBenefit, type ScrimTagKey } from "@/lib/scrims/decisionTags";
import { cn } from "@/ui-v2/lib/utils";

/**
 * One impact tag of a decision. The tone follows the meaning (less fatigue is good news), and the
 * meaning is also in the outline and the dot, solid for a benefit and dashed and hollow for a cost,
 * and in a word for assistive technology.
 */
export function ScrimTag({ tag }: { tag: ScrimTagKey }) {
  const { t } = useTranslation();
  const benefit = isScrimTagBenefit(tag);
  return (
    <span
      data-tone={benefit ? "benefit" : "cost"}
      className={cn(
        "inline-flex min-h-6 items-center gap-1.5 rounded border px-2 py-0.5 text-caption font-semibold leading-none",
        benefit ? "border-solid border-positive text-positive" : "border-dashed border-warning text-warning",
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-[7px] shrink-0 rounded-full", benefit ? "bg-current" : "border-[1.5px] border-current")}
      />
      {t(`scrims.tags.${tag}`)}
      <span className="sr-only">, {benefit ? t("scrims.tagBenefit") : t("scrims.tagCost")}</span>
    </span>
  );
}
