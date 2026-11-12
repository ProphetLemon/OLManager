import { useTranslation } from "react-i18next";

import type { RiskLevel } from "@/lib/scrims/scrimDesk";
import { cn } from "@/ui-v2/lib/utils";

const RISK_BARS: Record<RiskLevel, number> = { low: 1, medium: 2, high: 3 };
const RISK_TEXT_KEY: Record<RiskLevel, string> = {
  high: "scrims.risk.high",
  medium: "scrims.risk.medium",
  low: "scrims.risk.low",
};

/** Today's risk as rising bars plus its word, so the level never rests on colour. */
export function RiskMarker({ level }: { level: RiskLevel }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-2" data-risk={level}>
      <span aria-hidden="true" className="flex items-end gap-0.5">
        {[0, 1, 2].map((bar) => (
          <i
            key={bar}
            className={cn("block w-1.5 rounded-[1px]", bar < RISK_BARS[level] ? "bg-foreground" : "bg-line")}
            style={{ height: `${0.625 + bar * 0.5}rem` }}
          />
        ))}
      </span>
      <span>{t(RISK_TEXT_KEY[level])}</span>
    </span>
  );
}
