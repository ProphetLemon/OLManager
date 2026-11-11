import DashboardModalFrame from "@/ui-v2/_legacy/components/dashboard/DashboardModalFrame";
import NegotiationFeedbackPanel from "@/ui-v2/components/negotiation/NegotiationFeedbackPanel";
import { formatPlayerWage } from "@/lib/playerProfile/helpers";
import type { NegotiationFeedbackData, RenewalProjection } from "@/lib/playerProfile/renewal";
import { Button } from "@/ui-v2/components/ui/button";
import { cn } from "@/ui-v2/lib/utils";
import { FIELD_CLASS, FIELD_LABEL_CLASS } from "./modalFieldStyles";

type TranslateFn = (key: string, options?: Record<string, string | number>) => string;

interface PlayerProfileRenewalModalV2Props {
  show: boolean;
  playerName: string;
  t: TranslateFn;
  annualSuffix: string;
  renewalWage: string;
  renewalLength: string;
  renewalIsTerminal: boolean;
  isRenewalWageValid: boolean;
  isRenewalLengthValid: boolean;
  renewalViolatesSoftCap: boolean;
  renewalProjection: RenewalProjection | null;
  renewalStatusMessage: string | null;
  renewalStatusClassName: string;
  renewalCooledOff: boolean;
  renewalFeedback: NegotiationFeedbackData | null;
  renewalSubmitting: boolean;
  renewalSubmitDisabled: boolean;
  onWageChange: (value: string) => void;
  onLengthChange: (value: string) => void;
  onClose: () => void;
  onDelegate: () => void;
  onSubmit: () => void;
}

function budgetUsagePct(bill: number, budget: number): number {
  return budget > 0 ? Math.round((bill / budget) * 100) : 0;
}

export default function PlayerProfileRenewalModalV2({
  show,
  playerName,
  t,
  annualSuffix,
  renewalWage,
  renewalLength,
  renewalIsTerminal,
  isRenewalWageValid,
  isRenewalLengthValid,
  renewalViolatesSoftCap,
  renewalProjection,
  renewalStatusMessage,
  renewalStatusClassName,
  renewalCooledOff,
  renewalFeedback,
  renewalSubmitting,
  renewalSubmitDisabled,
  onWageChange,
  onLengthChange,
  onClose,
  onDelegate,
  onSubmit,
}: PlayerProfileRenewalModalV2Props) {
  if (!show) return null;

  const runway = (weeks: number | null) =>
    weeks === null ? t("finances.runwayStable") : t("finances.runwayWeeks", { count: weeks });

  return (
    <DashboardModalFrame maxWidthClassName="max-w-md">
      <div className="space-y-4">
        <div>
          <h3 className="font-heading text-lg font-bold uppercase tracking-wider text-foreground">
            {t("playerProfile.renewalTitle")}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{playerName}</p>
        </div>

        <div className="space-y-3">
          <div>
            <label htmlFor="renewal-wage" className={FIELD_LABEL_CLASS}>
              {t("playerProfile.renewalWage")}
            </label>
            <input
              id="renewal-wage"
              type="number"
              min="1"
              step="1"
              value={renewalWage}
              onChange={(event) => onWageChange(event.target.value)}
              disabled={renewalIsTerminal}
              className={FIELD_CLASS}
            />
          </div>

          <div>
            <label htmlFor="renewal-length" className={FIELD_LABEL_CLASS}>
              {t("playerProfile.renewalLength")}
            </label>
            <input
              id="renewal-length"
              type="number"
              min="1"
              max="5"
              step="1"
              value={renewalLength}
              onChange={(event) => onLengthChange(event.target.value)}
              disabled={renewalIsTerminal}
              aria-invalid={!isRenewalLengthValid}
              aria-describedby={isRenewalLengthValid ? undefined : "renewal-length-error"}
              className={FIELD_CLASS}
            />
          </div>
        </div>

        {!isRenewalWageValid && renewalWage !== "" ? (
          <p className="text-sm text-destructive">{t("playerProfile.renewalInvalidWage")}</p>
        ) : null}

        {!isRenewalLengthValid ? (
          <p id="renewal-length-error" className="text-sm text-destructive">
            {t("transfers.contractLengthError")}
          </p>
        ) : null}

        {renewalViolatesSoftCap ? (
          <p className="text-sm text-destructive">
            {t("playerProfile.renewalBudgetWarning", {
              defaultValue: "Offer exceeds the board wage pressure limit",
            })}
          </p>
        ) : null}

        {renewalProjection ? (
          <div className="space-y-2 rounded-lg border border-border bg-muted/50 p-3">
            <p className="font-heading text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {t("playerProfile.renewalProjectionTitle", {
                defaultValue: "Projected financial impact",
              })}
            </p>
            <p className="text-xs tabular-nums text-foreground/70">
              {t("playerProfile.renewalProjectionWageBill", {
                before: formatPlayerWage(renewalProjection.current_annual_wage_bill, annualSuffix),
                after: formatPlayerWage(renewalProjection.projected_annual_wage_bill, annualSuffix),
                defaultValue: "Annual wage bill {{before}} -> {{after}}",
              })}
            </p>
            <p className="text-xs tabular-nums text-foreground/70">
              {t("playerProfile.renewalProjectionBudgetUsage", {
                before: budgetUsagePct(
                  renewalProjection.current_annual_wage_bill,
                  renewalProjection.annual_wage_budget,
                ),
                after: budgetUsagePct(
                  renewalProjection.projected_annual_wage_bill,
                  renewalProjection.annual_wage_budget,
                ),
                defaultValue: "Wage budget use {{before}}% -> {{after}}%",
              })}
            </p>
            <p className="text-xs tabular-nums text-foreground/70">
              {t("playerProfile.renewalProjectionRunway", {
                before: runway(renewalProjection.current_cash_runway_weeks),
                after: runway(renewalProjection.projected_cash_runway_weeks),
                defaultValue: "Cash runway {{before}} -> {{after}}",
              })}
            </p>
          </div>
        ) : null}

        {renewalStatusMessage ? (
          <p className={cn("text-sm font-medium", renewalStatusClassName)}>{renewalStatusMessage}</p>
        ) : null}

        {renewalCooledOff ? (
          <p className="text-sm text-warning">
            {t("playerProfile.renewalCooledOff")}
          </p>
        ) : null}

        <NegotiationFeedbackPanel
          feedback={renewalFeedback}
          titleKey="playerProfile.renewalConversationTitle"
          roundKey="playerProfile.renewalRound"
          patienceKey="playerProfile.renewalPatience"
          tensionKey="playerProfile.renewalTension"
        />

        <div className="flex justify-end gap-2">
          {renewalIsTerminal ? (
            <Button variant="ghost" onClick={onClose}>
              {t("common.done")}
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>
                {t("common.cancel")}
              </Button>
              <Button variant="outline" onClick={onDelegate} disabled={renewalSubmitting}>
                {t("playerProfile.delegateRenewal")}
              </Button>
              <Button onClick={onSubmit} disabled={renewalSubmitDisabled}>
                {t("playerProfile.renewalSubmit")}
              </Button>
            </>
          )}
        </div>
      </div>
    </DashboardModalFrame>
  );
}
