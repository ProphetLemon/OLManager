import { useTranslation } from "react-i18next";

import type { PlayerData, TeamData, TransferOfferData } from "@/store/gameStore";
import { formatVal, getTeamName } from "@/lib/common/helpers";
import type {
  TransferBidProjectionData,
  TransferDestinationData,
  TransferNegotiationResponseData,
} from "@/services/transfersService";
import NegotiationFeedbackPanel, {
  type NegotiationFeedbackPanelData,
} from "@/ui-v2/components/negotiation/NegotiationFeedbackPanel";
import TransferNegotiationHistory from "@/ui-v2/components/negotiation/TransferNegotiationHistory";
import { Button } from "@/ui-v2/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/ui-v2/components/ui/dialog";
import { FIELD_CLASS, FIELD_LABEL_CLASS } from "@/ui-v2/pages/playerProfile/modalFieldStyles";
import {
  DecisionLine,
  DialogPlayerHeader,
  ErrorLine,
  decisionTone,
} from "./TransferDialogParts";
import TransferPlayerPicker from "./TransferPlayerPicker";

interface TransferBidDialogProps {
  bidTarget: PlayerData;
  teams: TeamData[];
  currentDate: string;
  bidAmount: string;
  onBidAmountChange: (value: string) => void;
  destination: TransferDestinationData;
  onDestinationChange: (value: TransferDestinationData) => void;
  academyTeam: TeamData | null;
  myTeam: TeamData | null;
  bidFee: number | null;
  bidProjection: TransferBidProjectionData["projection"] | null;
  bidFeedback: NegotiationFeedbackPanelData | null;
  activeBidOffer: TransferOfferData | null;
  hasExistingOffer: boolean;
  userPlayers: PlayerData[];
  selectedPlayerIds: string[];
  onSelectedPlayersChange: (ids: string[]) => void;
  bidResult: TransferNegotiationResponseData["decision"] | "error" | null;
  bidLoading: boolean;
  bidSubmitDisabled: boolean;
  onSubmit: () => void;
  onClose: () => void;
  isFreeAgent: boolean;
  bidError?: string | null;
}

export default function TransferBidDialog({
  bidTarget,
  teams,
  currentDate,
  bidAmount,
  onBidAmountChange,
  destination,
  onDestinationChange,
  academyTeam,
  myTeam,
  bidFee,
  bidProjection,
  bidFeedback,
  activeBidOffer,
  hasExistingOffer,
  userPlayers,
  selectedPlayerIds,
  onSelectedPlayersChange,
  bidResult,
  bidLoading,
  bidSubmitDisabled,
  onSubmit,
  onClose,
  isFreeAgent,
  bidError,
}: TransferBidDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="space-y-3">
        <DialogTitle>{t("transfers.makeBid")}</DialogTitle>
        <DialogPlayerHeader
          player={bidTarget}
          caption={
            <>
              {getTeamName(teams, bidTarget.team_id, {
                freeAgent: t("common.freeAgent"),
                unknown: t("common.unknown"),
              })}{" "}
              •{" "}
              {t("transfers.playerValue", { value: formatVal(bidTarget.market_value) })}
            </>
          }
        />
        {hasExistingOffer ? (
          <p className="text-xs text-muted-foreground">{t("transfers.resumeNegotiationHint")}</p>
        ) : null}

        <div>
          <label htmlFor="transfer-destination" className={FIELD_LABEL_CLASS}>
            {t("transfers.destination")}
          </label>
          <select
            id="transfer-destination"
            value={destination}
            onChange={(event) => onDestinationChange(event.target.value as TransferDestinationData)}
            className={FIELD_CLASS}
          >
            <option value="main">
              {myTeam?.name ?? t("transfers.mainTeamDestination", { defaultValue: "Main team" })}
            </option>
            {academyTeam ? <option value="academy">{academyTeam.name}</option> : null}
          </select>
        </div>

        {!isFreeAgent ? (
          <>
            <div>
              <label htmlFor="bid-amount" className={FIELD_LABEL_CLASS}>
                {t("transfers.bidAmount")}
              </label>
              <input
                id="bid-amount"
                type="number"
                step="1000"
                min="0"
                value={bidAmount}
                onChange={(event) => onBidAmountChange(event.target.value)}
                className={FIELD_CLASS}
              />
            </div>

            <TransferPlayerPicker
              userPlayers={userPlayers}
              selectedPlayerIds={selectedPlayerIds}
              onSelectedPlayersChange={onSelectedPlayersChange}
              currentDate={currentDate}
            />

            {myTeam && bidFee !== null && bidProjection ? (
              <div className="space-y-2 rounded-lg border border-border bg-card/60 p-3">
                <p className="font-heading text-caption font-bold uppercase tracking-wider text-muted-foreground">
                  {t("transfers.bidImpactTitle", { defaultValue: "Projected impact" })}
                </p>
                <p className="text-xs tabular-nums text-foreground/70">
                  {t("transfers.bidImpactTransferBudget", {
                    before: formatVal(bidProjection.transfer_budget_before),
                    after: formatVal(bidProjection.transfer_budget_after),
                    defaultValue: "Transfer budget {{before}} -> {{after}}",
                  })}
                </p>
                <p className="text-xs tabular-nums text-foreground/70">
                  {t("transfers.bidImpactBalance", {
                    before: formatVal(bidProjection.finance_before),
                    after: formatVal(bidProjection.finance_after),
                    defaultValue: "Club balance {{before}} -> {{after}}",
                  })}
                </p>
                <p className="text-xs tabular-nums text-foreground/70">
                  {t("transfers.bidImpactWagePressure", {
                    percent: bidProjection.projected_wage_budget_usage_pct,
                    defaultValue: "Projected wage budget usage {{percent}}%",
                  })}
                </p>
                {bidProjection.exceeds_transfer_budget ? (
                  <p className="text-xs text-destructive">
                    {t("transfers.bidImpactOverTransferBudget", {
                      defaultValue: "This bid exceeds your transfer budget",
                    })}
                  </p>
                ) : null}
                {bidProjection.exceeds_finance ? (
                  <p className="text-xs text-destructive">
                    {t("transfers.bidImpactOverBalance", {
                      defaultValue: "This bid would push the club into debt",
                    })}
                  </p>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}

        <NegotiationFeedbackPanel
          feedback={bidFeedback}
          titleKey="transfers.negotiationPulse"
          roundKey="transfers.negotiationRound"
          patienceKey="transfers.negotiationPatience"
          tensionKey="transfers.negotiationTension"
        />
        <TransferNegotiationHistory offer={activeBidOffer} mode="outgoing" />
        {bidError ? <ErrorLine>{bidError}</ErrorLine> : null}
        {bidResult ? (
          <DecisionLine tone={decisionTone(bidResult)}>
            {bidResult === "accepted"
              ? t("transfers.bidAccepted")
              : bidResult === "rejected"
                ? t("transfers.bidRejected")
                : bidResult === "counter_offer"
                  ? t("transfers.bidCountered")
                  : bidResult}
          </DecisionLine>
        ) : null}

        <DialogFooter>
          <Button
            onClick={onSubmit}
            disabled={bidSubmitDisabled}
            className="flex-1 font-heading text-sm font-bold uppercase tracking-wider"
          >
            {bidLoading ? t("transfers.submitting") : t("transfers.submitBid")}
          </Button>
          <Button
            variant="ghost"
            onClick={onClose}
            className="font-heading text-sm font-bold uppercase tracking-wider"
          >
            {t("transfers.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
