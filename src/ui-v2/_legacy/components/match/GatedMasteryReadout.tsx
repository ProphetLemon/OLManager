import { useTranslation } from "react-i18next";
import type { GatedMastery } from "@/ui-v2/_legacy/components/match/draftIntelHelpers";

const BAND_TEXT_CLASS = {
  high: "text-amber-300",
  medium: "text-emerald-300",
  low: "text-rose-300",
} as const;

export default function GatedMasteryReadout({ reading }: { reading: GatedMastery }) {
  const { t } = useTranslation();
  if (reading.kind === "exact") {
    return <span className="text-gray-400">{reading.value}</span>;
  }
  return (
    <span
      className={BAND_TEXT_CLASS[reading.band]}
      title={t("match.draft.rivalMasteryBandTooltip", {
        defaultValue: "Estimated level. Scout this player to see the exact mastery.",
      })}
    >
      {t(`match.draft.rivalMasteryBand.${reading.band}`, {
        defaultValue: reading.band === "high" ? "High" : reading.band === "medium" ? "Medium" : "Low",
      })}
    </span>
  );
}
