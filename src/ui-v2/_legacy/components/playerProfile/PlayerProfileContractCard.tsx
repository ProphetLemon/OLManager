import {
    Activity,
    Briefcase,
    Calendar,
    DollarSign,
    Heart,
    TrendingUp,
} from "lucide-react";
import {
    formatDate,
    getContractRiskBadgeVariant,
    getContractYearsRemaining,
} from "@/lib/common/helpers";
import { formatPlayerMarketValue, formatPlayerWage } from "@/lib/playerProfile/helpers";
import { Badge, Button, Card, CardBody, CardHeader } from "@/ui-v2/_legacy/components/ui";

type TranslateFn = (
    key: string,
    options?: Record<string, string | number>,
) => string;

interface PlayerProfileContractCardProps {
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
    contractRiskLevel: "critical" | "warning" | "stable";
    contractRiskLabel: string;
    isOwnClub: boolean;
    isTransferWindowOpen: boolean;
    transferActionSubmitting: boolean;
    onOpenRenewal: () => void;
    onReleaseContract: () => void;
    onOpenTransferBid: () => void;
    t: TranslateFn;
}

export default function PlayerProfileContractCard({
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
    isOwnClub,
    isTransferWindowOpen,
    transferActionSubmitting,
    onOpenRenewal,
    onReleaseContract,
    onOpenTransferBid,
    t,
}: PlayerProfileContractCardProps) {
    return (
        <Card>
            <CardHeader>{t("playerProfile.contractInfo")}</CardHeader>
            <CardBody>
                <div className="flex flex-col gap-3">
                    <InfoRow
                        icon={<Calendar className="w-4 h-4" />}
                        label={t("playerProfile.dateOfBirth")}
                        value={formatDate(dateOfBirth, language)}
                    />
                    <InfoRow
                        icon={<Briefcase className="w-4 h-4" />}
                        label={t("common.contract")}
                        value={
                            contractEnd
                                ? t("finances.contractExpiresOn", { date: contractEnd })
                                : t("playerProfile.noContract")
                        }
                    />
                    <InfoRow
                        icon={<Calendar className="w-4 h-4" />}
                        label={t("playerProfile.yearsRemaining")}
                        value={getContractYearsRemaining(contractEnd, currentDate)}
                    />
                    <InfoRow
                        icon={<Briefcase className="w-4 h-4" />}
                        label={t("playerProfile.contractRisk")}
                        value={
                            <Badge variant={getContractRiskBadgeVariant(contractRiskLevel)}>
                                {contractRiskLabel}
                            </Badge>
                        }
                    />
                    <InfoRow
                        icon={<DollarSign className="w-4 h-4" />}
                        label={t("finances.marketValue")}
                        value={formatPlayerMarketValue(marketValue)}
                    />
                    <InfoRow
                        icon={<TrendingUp className="w-4 h-4" />}
                        label={t("playerProfile.annualWage")}
                        value={formatPlayerWage(wage, annualSuffix)}
                    />
                    <InfoRow
                        icon={<Heart className="w-4 h-4" />}
                        label={t("common.condition")}
                        value={
                            <div className="flex items-center gap-1.5 flex-1 max-w-40">
                                <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                                    <div className="absolute inset-0 rounded-full" style={{ background: 'linear-gradient(to right, #f59e0b, #22c55e)' }} />
                                    <div className="absolute inset-y-0 right-0 bg-muted transition-all duration-500" style={{ width: `${100 - condition}%` }} />
                                </div>
                                <span className="font-heading text-xs font-bold tabular-nums">{condition}%</span>
                            </div>
                        }
                    />
                    <InfoRow
                        icon={<Activity className="w-4 h-4" />}
                        label={t("common.fitness")}
                        value={
                            <div className="flex items-center gap-1.5 flex-1 max-w-40">
                                <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                                    <div className="absolute inset-0 rounded-full" style={{ background: 'linear-gradient(to right, #f59e0b, #22c55e)' }} />
                                    <div className="absolute inset-y-0 right-0 bg-muted transition-all duration-500" style={{ width: `${100 - fitness}%` }} />
                                </div>
                                <span className="font-heading text-xs font-bold tabular-nums">{fitness}%</span>
                            </div>
                        }
                    />
                    <InfoRow
                        icon={<Activity className="w-4 h-4" />}
                        label={t("common.morale")}
                        value={
                            <div className="flex items-center gap-1.5 flex-1 max-w-40">
                                <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                                    <div className="absolute inset-0 rounded-full" style={{ background: 'linear-gradient(to right, #f59e0b, #22c55e)' }} />
                                    <div className="absolute inset-y-0 right-0 bg-muted transition-all duration-500" style={{ width: `${100 - morale}%` }} />
                                </div>
                                <span className="font-heading text-xs font-bold tabular-nums">{morale}%</span>
                            </div>
                        }
                    />
                </div>
                {isOwnClub ? (
                    <div className="pt-3 flex flex-wrap gap-2">
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
            </CardBody>
        </Card>
    );
}

function InfoRow({
    icon,
    label,
    value,
}: {
    icon: React.ReactNode;
    label: string;
    value: React.ReactNode;
}) {
    return (
        <div className="flex items-center gap-3 py-2 border-b border-border/60 last:border-0">
            <div className="text-muted-foreground/70">{icon}</div>
            <span className="text-sm text-muted-foreground flex-1">
                {label}
            </span>
            <span className="text-sm font-semibold text-foreground">
                {value}
            </span>
        </div>
    );
}




