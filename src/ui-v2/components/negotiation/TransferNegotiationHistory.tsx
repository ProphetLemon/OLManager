import { useTranslation } from "react-i18next";

import type { TransferOfferData } from "@/store/gameStore";
import { formatVal } from "@/lib/common/helpers";

interface TransferNegotiationHistoryProps {
  offer: TransferOfferData | null;
  mode: "outgoing" | "incoming";
}

function HistoryRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
      <span>{label}</span>
      <span className="font-semibold tabular-nums text-foreground">{formatVal(value)}</span>
    </div>
  );
}

export default function TransferNegotiationHistory({
  offer,
  mode,
}: TransferNegotiationHistoryProps) {
  const { t } = useTranslation();

  if (!offer || offer.negotiation_round < 2) {
    return null;
  }

  const managerLabel =
    mode === "outgoing" ? t("transfers.lastBidLabel") : t("transfers.lastCounterLabel");
  const clubLabel =
    mode === "outgoing" ? t("transfers.lastClubSignalLabel") : t("transfers.currentOfferLabel");
  const managerFee = offer.last_manager_fee;
  const clubFee = offer.suggested_counter_fee ?? offer.fee;

  return (
    <div className="space-y-2 rounded-lg border border-border bg-card/60 p-3">
      <p className="font-heading text-xs font-bold uppercase tracking-wider text-muted-foreground">
        {t("transfers.negotiationHistory")}
      </p>
      {managerFee !== null && managerFee !== undefined ? (
        <HistoryRow label={managerLabel} value={managerFee} />
      ) : null}
      <HistoryRow label={clubLabel} value={clubFee} />
    </div>
  );
}
