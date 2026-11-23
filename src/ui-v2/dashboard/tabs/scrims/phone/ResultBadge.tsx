import { useTranslation } from "react-i18next";

import { ResultLetter } from "@/ui-v2/components/ResultLetter";
import { cn } from "@/ui-v2/lib/utils";

/**
 * K4: a small square with an outline and the result's letter, the one drawn by Semana's blocks and
 * hero and by the report's latest block. `silent` when a word beside it says the result (it is then
 * hidden from assistive technology and holds only the letter). `className` places and sizes it.
 */
export function ResultBadge({ result, silent, className }: { result: "won" | "lost"; silent?: boolean; className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      data-slot="result-badge"
      data-result={result}
      aria-hidden={silent ? true : undefined}
      className={cn(
        "inline-flex size-[1.125rem] shrink-0 items-center justify-center rounded-[4px] border font-heading text-caption font-bold leading-none",
        result === "won" ? "border-positive text-positive" : "border-negative text-negative",
        className,
      )}
    >
      {silent ? (
        t(result === "won" ? "onAir.home.formWinLetter" : "onAir.home.formLossLetter", { defaultValue: result === "won" ? "W" : "L" })
      ) : (
        <ResultLetter kind={result === "won" ? "win" : "loss"} />
      )}
    </span>
  );
}
