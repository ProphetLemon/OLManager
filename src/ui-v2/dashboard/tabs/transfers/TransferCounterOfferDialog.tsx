import { useTranslation } from "react-i18next";

import type { PlayerData, TeamData, TransferOfferData } from "@/store/gameStore";
import { formatVal, getTeamName } from "@/lib/common/helpers";
import type { TransferNegotiationResponseData } from "@/services/transfersService";
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

interface TransferCounterTarget {
  player: PlayerData;
  offerId: string;
  fromTeamId: string;
  fee: number;
}

interface TransferCounterOfferDialogProps {
  counterTarget: TransferCounterTarget;
  teams: TeamData[];
  currentDate: string;
  counterAmount: string;
  onCounterAmountChange: (value: string) => void;
  counterFeedback: NegotiationFeedbackPanelData | null;
  activeCounterOffer: TransferOfferData | null;
  counterResult: TransferNegotiationResponseData["decision"] | "error" | null;
  counterError: string | null;
  counterLoading: boolean;
  userPlayers: PlayerData[];
  selectedPlayerIds: string[];
  onSelectedPlayersChange: (ids: string[]) => void;
  onSubmit: () => void;
  onClose: () => void;
}

export default function TransferCounterOfferDialog({
  counterTarget,
  teams,
  currentDate,
  counterAmount,
  onCounterAmountChange,
  counterFeedback,
  activeCounterOffer,
  counterResult,
  counterError,
  counterLoading,
  userPlayers,
  selectedPlayerIds,
  onSelectedPlayersChange,
  onSubmit,
  onClose,
}: TransferCounterOfferDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="space-y-3">
        <DialogTitle>{t("transfers.counterOffer")}</DialogTitle>
        <DialogPlayerHeader
          player={counterTarget.player}
          caption={
            <>
              {getTeamName(teams, counterTarget.fromTeamId)} •
              {t("transfers.currentOffer", { fee: formatVal(counterTarget.fee) })}
            </>
          }
        />
        {counterFeedback ? (
          <p className="text-xs text-muted-foreground">{t("transfers.resumeNegotiationHint")}</p>
        ) : null}

        <div>
          <label htmlFor="counter-offer-amount" className={FIELD_LABEL_CLASS}>
            {t("transfers.counterAmount")}
          </label>
          <input
            id="counter-offer-amount"
            type="number"
            step="1000"
            min="0"
            value={counterAmount}
            onChange={(event) => onCounterAmountChange(event.target.value)}
            className={FIELD_CLASS}
          />
        </div>

        <TransferPlayerPicker
          userPlayers={userPlayers}
          selectedPlayerIds={selectedPlayerIds}
          onSelectedPlayersChange={onSelectedPlayersChange}
          currentDate={currentDate}
        />

        <NegotiationFeedbackPanel
          feedback={counterFeedback}
          titleKey="transfers.negotiationPulse"
          roundKey="transfers.negotiationRound"
          patienceKey="transfers.negotiationPatience"
          tensionKey="transfers.negotiationTension"
        />
        <TransferNegotiationHistory offer={activeCounterOffer} mode="incoming" />
        {counterResult ? (
          <DecisionLine tone={decisionTone(counterResult)}>
            {counterResult === "accepted"
              ? t("transfers.counterAccepted")
              : counterResult === "rejected"
                ? t("transfers.counterRejected")
                : t("transfers.counterCountered")}
          </DecisionLine>
        ) : null}
        {counterError ? <ErrorLine>{counterError}</ErrorLine> : null}

        <DialogFooter>
          <Button
            onClick={onSubmit}
            disabled={counterLoading || counterResult === "accepted"}
            className="flex-1 font-heading text-sm font-bold uppercase tracking-wider"
          >
            {counterLoading ? t("transfers.submitting") : t("transfers.submitCounter")}
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
