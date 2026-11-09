import DashboardModalFrame from "@/ui-v2/_legacy/components/dashboard/DashboardModalFrame";
import NegotiationFeedbackPanel from "@/ui-v2/components/negotiation/NegotiationFeedbackPanel";
import TransferNegotiationHistory from "@/ui-v2/components/negotiation/TransferNegotiationHistory";
import { formatVal } from "@/lib/common/helpers";
import type { TeamData } from "@/store/gameStore";
import type {
  TransferBidProjectionData,
  TransferDestinationData,
} from "@/services/transfersService";
import { Button } from "@/ui-v2/components/ui/button";
import { cn } from "@/ui-v2/lib/utils";
import type { TransferOfferFeedbackState } from "./usePlayerTransfer";
import { FIELD_CLASS, FIELD_LABEL_CLASS } from "./modalFieldStyles";

type TranslateFn = (key: string, options?: Record<string, string | number>) => string;

interface PlayerProfileTransferOfferModalV2Props {
  t: TranslateFn;
  playerName: string;
  isFreeAgent: boolean;
  managerTeam: TeamData | null;
  academyTeam: TeamData | null;
  destination: TransferDestinationData;
  amount: string;
  error: string | null;
  feedback: TransferOfferFeedbackState | null;
  projection: TransferBidProjectionData["projection"] | null;
  projectionFee: number | null;
  submitting: boolean;
  onDestinationChange: (destination: TransferDestinationData) => void;
  onAmountChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

const DECISION_TONE: Record<TransferOfferFeedbackState["decision"], string> = {
  accepted: "text-positive",
  rejected: "text-destructive",
  counter_offer: "text-warning",
};

export default function PlayerProfileTransferOfferModalV2({
  t,
  playerName,
  isFreeAgent,
  managerTeam,
  academyTeam,
  destination,
  amount,
  error,
  feedback,
  projection,
  projectionFee,
  submitting,
  onDestinationChange,
  onAmountChange,
  onSubmit,
  onCancel,
}: PlayerProfileTransferOfferModalV2Props) {
  return (
    <DashboardModalFrame maxWidthClassName="max-w-md">
      <div className="space-y-4">
        <h3 className="font-heading text-sm font-bold uppercase tracking-wider text-muted-foreground">
          {t("playerProfile.makeTransferOffer", { defaultValue: "Make Transfer Offer" })}
        </h3>
        <p className="text-sm text-muted-foreground">{playerName}</p>

        <div>
          <label htmlFor="transfer-offer-destination" className={FIELD_LABEL_CLASS}>
            {t("playerProfile.transferOfferDestination", { defaultValue: "Destination" })}
          </label>
          <select
            id="transfer-offer-destination"
            value={destination}
            onChange={(event) => onDestinationChange(event.target.value as TransferDestinationData)}
            className={FIELD_CLASS}
          >
            <option value="main">
              {managerTeam?.name ??
                t("playerProfile.transferOfferMainTeam", { defaultValue: "Main team" })}
            </option>
            {academyTeam ? <option value="academy">{academyTeam.name}</option> : null}
          </select>
        </div>

        {isFreeAgent ? (
          <p className="text-xs text-muted-foreground">
            {t("transfers.freeAgentSigningHint", {
              defaultValue: "This player is a free agent and can be signed without a transfer fee.",
            })}
          </p>
        ) : (
          <>
            <div>
              <label htmlFor="transfer-offer-amount" className={FIELD_LABEL_CLASS}>
                {t("playerProfile.transferOfferAmount", { defaultValue: "Offer amount" })}
              </label>
              <input
                id="transfer-offer-amount"
                type="number"
                min="1"
                step="1000"
                value={amount}
                onChange={(event) => onAmountChange(event.target.value)}
                className={FIELD_CLASS}
              />
            </div>
            {projectionFee !== null && projection ? (
              <div className="space-y-2 rounded-lg border border-border bg-card/60 p-3">
                <p className="font-heading text-caption font-bold uppercase tracking-wider text-muted-foreground">
                  {t("transfers.bidImpactTitle", { defaultValue: "Projected impact" })}
                </p>
                <p className="text-xs tabular-nums text-foreground/70">
                  {t("transfers.bidImpactTransferBudget", {
                    before: formatVal(projection.transfer_budget_before),
                    after: formatVal(projection.transfer_budget_after),
                    defaultValue: "Transfer budget {{before}} -> {{after}}",
                  })}
                </p>
                <p className="text-xs tabular-nums text-foreground/70">
                  {t("transfers.bidImpactBalance", {
                    before: formatVal(projection.finance_before),
                    after: formatVal(projection.finance_after),
                    defaultValue: "Club balance {{before}} -> {{after}}",
                  })}
                </p>
                <p className="text-xs tabular-nums text-foreground/70">
                  {t("transfers.bidImpactWagePressure", {
                    percent: projection.projected_wage_budget_usage_pct,
                    defaultValue: "Projected wage budget usage {{percent}}%",
                  })}
                </p>
                {projection.exceeds_transfer_budget ? (
                  <p className="text-xs text-destructive">
                    {t("transfers.bidImpactOverTransferBudget", {
                      defaultValue: "This bid exceeds your transfer budget",
                    })}
                  </p>
                ) : null}
                {projection.exceeds_finance ? (
                  <p className="text-xs text-destructive">
                    {t("transfers.bidImpactOverBalance", {
                      defaultValue: "This bid would push the club into debt",
                    })}
                  </p>
                ) : null}
              </div>
            ) : null}
          </>
        )}

        {feedback ? (
          <NegotiationFeedbackPanel
            feedback={feedback.feedback}
            titleKey="transfers.negotiationPulse"
            roundKey="transfers.negotiationRound"
            patienceKey="transfers.negotiationPatience"
            tensionKey="transfers.negotiationTension"
          />
        ) : null}
        <TransferNegotiationHistory offer={null} mode="outgoing" />
        {error ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {error}
          </p>
        ) : null}
        {feedback ? (
          <div
            className={cn(
              "font-heading text-xs font-bold uppercase tracking-wider",
              DECISION_TONE[feedback.decision],
            )}
          >
            {feedback.decision === "accepted"
              ? t("transfers.bidAccepted", { defaultValue: "Bid accepted!" })
              : feedback.decision === "rejected"
                ? t("transfers.bidRejected", { defaultValue: "Bid rejected." })
                : t("transfers.bidCountered", { defaultValue: "They came back with revised terms." })}
          </div>
        ) : null}
        <div className="flex gap-2">
          <Button
            onClick={onSubmit}
            disabled={submitting}
            className="flex-1 font-heading text-sm font-bold uppercase tracking-wider"
          >
            {submitting
              ? t("transfers.submitting", { defaultValue: "Submitting..." })
              : t("playerProfile.transferOfferSubmit", { defaultValue: "Send offer" })}
          </Button>
          <Button
            variant="ghost"
            onClick={onCancel}
            disabled={submitting}
            className="font-heading text-sm font-bold uppercase tracking-wider"
          >
            {t("common.cancel", { defaultValue: "Cancel" })}
          </Button>
        </div>
      </div>
    </DashboardModalFrame>
  );
}
