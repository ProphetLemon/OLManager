import type { ReactNode } from "react";
import { Activity, Briefcase, Calendar, DollarSign, Heart, TrendingUp } from "lucide-react";
import { formatDate, getContractYearsRemaining } from "@/lib/common/helpers";
import { formatPlayerMarketValue, formatPlayerWage } from "@/lib/playerProfile/helpers";
import { Badge } from "@/ui-v2/components/ui/badge";
import { Button } from "@/ui-v2/components/ui/button";
import { cn } from "@/ui-v2/lib/utils";
import { MeterBar, PlayerProfileSectionV2 } from "./PlayerProfileSectionV2";

type TranslateFn = (key: string, options?: Record<string, string | number>) => string;

type ContractRiskLevel = "critical" | "warning" | "stable";

interface PlayerProfileContractCardV2Props {
  dateOfBirth: string;
  contractEnd: string | null;
  currentDate: string;
  condition: number;
  fitness: number;
  morale: number;
  marketValue: number;
  wage: number;
  annualSuffix: string;
  language: string;
  contractRiskLevel: ContractRiskLevel;
  contractRiskLabel: string;
  /** False for free agents: contract rows and the current wage are hidden. Defaults to true. */
  hasTeam?: boolean;
  isOwnClub: boolean;
  isTransferWindowOpen: boolean;
  transferActionSubmitting: boolean;
  onOpenRenewal: () => void;
  onReleaseContract: () => void;
  onOpenTransferBid: () => void;
  t: TranslateFn;
}

const RISK_BADGE: Record<ContractRiskLevel, { variant: "destructive" | "outline"; className?: string }> = {
  critical: { variant: "destructive" },
  warning: { variant: "outline", className: "border-warning/40 text-warning" },
  stable: { variant: "outline", className: "border-positive/40 text-positive" },
};

function InfoRow({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-border/60 py-2 last:border-0">
      <div className="text-muted-foreground/70">{icon}</div>
      <span className="flex-1 text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  );
}

export default function PlayerProfileContractCardV2({
  dateOfBirth,
  contractEnd,
  currentDate,
  condition,
  fitness,
  morale,
  marketValue,
  wage,
  annualSuffix,
  language,
  contractRiskLevel,
  contractRiskLabel,
  hasTeam = true,
  isOwnClub,
  isTransferWindowOpen,
  transferActionSubmitting,
  onOpenRenewal,
  onReleaseContract,
  onOpenTransferBid,
  t,
}: PlayerProfileContractCardV2Props) {
  const risk = RISK_BADGE[contractRiskLevel];
  const isContracted = hasTeam && contractEnd !== null;

  return (
    <PlayerProfileSectionV2 title={t("playerProfile.contractInfo")}>
      <div className="flex flex-col">
        <InfoRow
          icon={<Calendar className="size-4" />}
          label={t("playerProfile.dateOfBirth")}
          value={formatDate(dateOfBirth, language)}
        />
        <InfoRow
          icon={<Briefcase className="size-4" />}
          label={t("common.contract")}
          value={
            isContracted
              ? t("finances.contractExpiresOn", { date: contractEnd })
              : t("playerProfile.noContract")
          }
        />
        {isContracted ? (
          <>
            <InfoRow
              icon={<Calendar className="size-4" />}
              label={t("playerProfile.yearsRemaining")}
              value={getContractYearsRemaining(contractEnd, currentDate)}
            />
            <InfoRow
              icon={<Briefcase className="size-4" />}
              label={t("playerProfile.contractRisk")}
              value={
                <Badge variant={risk.variant} className={cn(risk.className)}>
                  {contractRiskLabel}
                </Badge>
              }
            />
          </>
        ) : null}
        <InfoRow
          icon={<DollarSign className="size-4" />}
          label={t("finances.marketValue")}
          value={formatPlayerMarketValue(marketValue)}
        />
        {isContracted ? (
          <InfoRow
            icon={<TrendingUp className="size-4" />}
            label={t("playerProfile.annualWage")}
            value={formatPlayerWage(wage, annualSuffix)}
          />
        ) : null}
        <InfoRow
          icon={<Heart className="size-4" />}
          label={t("common.condition")}
          value={<MeterBar value={condition} label={t("common.condition")} />}
        />
        <InfoRow
          icon={<Activity className="size-4" />}
          label={t("common.fitness")}
          value={<MeterBar value={fitness} label={t("common.fitness")} />}
        />
        <InfoRow
          icon={<Activity className="size-4" />}
          label={t("common.morale")}
          value={<MeterBar value={morale} label={t("common.morale")} />}
        />
      </div>

      {isOwnClub ? (
        <div className="flex flex-wrap gap-2 pt-3">
          <Button size="sm" variant="outline" onClick={onOpenRenewal}>
            {t("common.renewContract")}
          </Button>
          {isTransferWindowOpen ? (
            <Button
              size="sm"
              variant="outline"
              onClick={onReleaseContract}
              disabled={transferActionSubmitting}
            >
              {t("playerProfile.releaseContract")}
            </Button>
          ) : null}
        </div>
      ) : isTransferWindowOpen ? (
        <div className="pt-3">
          <Button
            size="sm"
            variant="outline"
            onClick={onOpenTransferBid}
            disabled={transferActionSubmitting}
          >
            {t("playerProfile.makeTransferOffer")}
          </Button>
        </div>
      ) : null}
    </PlayerProfileSectionV2>
  );
}
