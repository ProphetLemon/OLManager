import { useTranslation } from "react-i18next";

import type { PlayerData, TeamData, TransferOfferData } from "@/store/gameStore";
import { formatVal, getTeamName } from "@/lib/common/helpers";
import type { WageNegotiationResponseData } from "@/services/transfersService";
import NegotiationFeedbackPanel, {
  type NegotiationFeedbackPanelData,
} from "@/ui-v2/components/negotiation/NegotiationFeedbackPanel";
import TransferNegotiationHistory from "@/ui-v2/components/negotiation/TransferNegotiationHistory";
import { Button } from "@/ui-v2/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/ui-v2/components/ui/dialog";
import { Progress } from "@/ui-v2/components/ui/progress";
import { cn } from "@/ui-v2/lib/utils";
import { FIELD_CLASS, FIELD_LABEL_CLASS } from "@/ui-v2/pages/playerProfile/modalFieldStyles";
import {
  DecisionLine,
  DialogPlayerHeader,
  ErrorLine,
  decisionTone,
} from "./TransferDialogParts";

interface WageNegotiationTarget {
  player: PlayerData;
  offerId: string;
  fromTeamId: string | null;
  fee: number;
  destinationTeamId: string;
}

interface WageNegotiationDialogProps {
  target: WageNegotiationTarget;
  teams: TeamData[];
  wageAmount: string;
  onWageAmountChange: (value: string) => void;
  contractYears: number;
  onContractYearsChange: (years: number) => void;
  feedback: NegotiationFeedbackPanelData | null;
  activeOffer: TransferOfferData | null;
  result: WageNegotiationResponseData["decision"] | "error" | null;
  error: string | null;
  loading: boolean;
  onSubmit: () => void;
  onClose: () => void;
  annualWageBudget: number;
}

export default function WageNegotiationDialog({
  target,
  teams,
  wageAmount,
  onWageAmountChange,
  contractYears,
  onContractYearsChange,
  feedback,
  activeOffer,
  result,
  error,
  loading,
  onSubmit,
  onClose,
  annualWageBudget,
}: WageNegotiationDialogProps) {
  const { t } = useTranslation();
  const wageValue = Number.parseFloat(wageAmount);
  const isWageValid = Number.isFinite(wageValue) && wageValue > 0;
  const exceedsBudget = isWageValid && wageValue > annualWageBudget;
  const closeBlocked = loading || result === "accepted";
  const fromTeamName = target.fromTeamId ? getTeamName(teams, target.fromTeamId) : null;

  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(open) => {
        if (!open && !closeBlocked) onClose();
      }}
    >
      <DialogContent className="space-y-3">
        <DialogTitle>{t("transfers.wageNegotiation")}</DialogTitle>
        <DialogPlayerHeader
          player={target.player}
          caption={
            fromTeamName
              ? `${fromTeamName} • ${t("transfers.transferFee", { fee: formatVal(target.fee) })}`
              : t("common.freeAgent")
          }
        />

        <div>
          <label htmlFor="wage-amount" className={FIELD_LABEL_CLASS}>
            {t("transfers.annualWage", { defaultValue: "Salario anual" })}
          </label>
          <input
            id="wage-amount"
            type="number"
            step="5000"
            min="0"
            value={wageAmount}
            onChange={(event) => onWageAmountChange(event.target.value)}
            aria-invalid={exceedsBudget || undefined}
            className={cn(FIELD_CLASS, exceedsBudget && "border-destructive")}
          />
        </div>

        {isWageValid && target.player.wage > 0 ? (
          <div className="space-y-1 rounded-lg border border-border bg-card/60 p-3">
            <p className="text-xs text-muted-foreground">
              {t("transfers.currentAnnualWage", {
                wage: formatVal(target.player.wage),
                defaultValue: "Salario anual actual: {{wage}}",
              })}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("transfers.proposedWeekly", {
                weekly: formatVal(Math.round(wageValue / 52)),
                defaultValue: "Equivalente semanal: {{weekly}}/sem",
              })}
            </p>
            {wageValue > target.player.wage ? (
              <p className="text-xs text-emerald-500">
                {t("transfers.wageIncrease", {
                  pct: Math.round((wageValue / target.player.wage - 1) * 100),
                  defaultValue: "Aumento: +{{pct}}%",
                })}
              </p>
            ) : null}
          </div>
        ) : null}

        {annualWageBudget > 0 ? (
          <div>
            <div className="mb-1 flex justify-between text-xs text-muted-foreground">
              <span>{t("transfers.wageBudgetUsage")}</span>
              <span className="tabular-nums">
                {isWageValid ? Math.round((wageValue / annualWageBudget) * 100) : 0}%
              </span>
            </div>
            <Progress
              value={isWageValid ? (wageValue / annualWageBudget) * 100 : 0}
              tone={exceedsBudget ? "danger" : "primary"}
            />
          </div>
        ) : null}

        <div>
          <label htmlFor="contract-years" className={FIELD_LABEL_CLASS}>
            {t("transfers.contractLength")}
          </label>
          <select
            id="contract-years"
            value={contractYears}
            onChange={(event) => onContractYearsChange(Number(event.target.value))}
            className={FIELD_CLASS}
          >
            {[1, 2, 3, 4, 5].map((years) => (
              <option key={years} value={years}>
                {t("transfers.contractYears", { count: years })}
              </option>
            ))}
          </select>
        </div>

        <NegotiationFeedbackPanel
          feedback={feedback}
          titleKey="transfers.negotiationPulse"
          roundKey="transfers.negotiationRound"
          patienceKey="transfers.negotiationPatience"
          tensionKey="transfers.negotiationTension"
        />
        <TransferNegotiationHistory offer={activeOffer} mode="outgoing" />

        {result ? (
          <DecisionLine tone={decisionTone(result)}>
            {result === "accepted"
              ? t("transfers.wageAccepted")
              : result === "rejected"
                ? t("transfers.wageRejected")
                : t("transfers.wageCountered")}
          </DecisionLine>
        ) : null}
        {error ? <ErrorLine>{error}</ErrorLine> : null}

        <DialogFooter>
          <Button
            onClick={onSubmit}
            disabled={loading || !isWageValid || result === "accepted"}
            className="flex-1 font-heading text-sm font-bold uppercase tracking-wider"
          >
            {loading ? t("transfers.submitting") : t("transfers.submitWageOffer")}
          </Button>
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={closeBlocked}
            className="font-heading text-sm font-bold uppercase tracking-wider"
          >
            {t("transfers.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
