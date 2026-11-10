import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BedDouble,
  Binoculars,
  Camera,
  Dumbbell,
  Lock,
  Monitor,
  RefreshCw,
  Search,
  User,
} from "lucide-react";

import type { GameStateData, PlayerSelectionOptions } from "@/store/gameStore";
import {
  formatVal,
  getContractRiskLevel,
  getContractYearsRemaining,
} from "@/lib/common/helpers";
import {
  getFinancialLedger,
  filterLedgerEntries,
  getLedgerEntryBalanceAfter,
  getLedgerEntrySource,
  getLedgerEntrySourceLabelKey,
  getLedgerSources,
  groupLedgerEntriesByDate,
  safeFinanceNumber,
  getTeamFinanceSnapshot,
  getTransferBudgetSummary,
  getSeasonNetSummary,
} from "@/lib/finances/finance";
import type { FinancialTransactionKind } from "@/store/types";
import type { FacilityUpgradeId } from "@/lib/finances/lolFinanceContracts";
import {
  getClubInstallationContract,
  getSponsorshipContractView,
} from "@/lib/finances/lolFinanceContracts";
import { getLolRoleForPlayer } from "@/lib/squad/helpers";
import { resolvePlayerPhoto } from "@/lib/players/playerPhotos";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui-v2/components/ui/card";
import { Badge } from "@/ui-v2/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui-v2/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui-v2/components/ui/table";
import { cn } from "@/ui-v2/lib/utils";
import { activeCurrencySymbol, formatCurrencyAmount } from "@/lib/formatting/valueFormatting";

interface FinancesTabV2Props {
  gameState: GameStateData;
  onGameUpdate: (state: GameStateData) => void;
  onSelectPlayer?: (id: string, options?: PlayerSelectionOptions) => void;
}

function formatCurrencyAmountParam(value: number): string {
  return value.toLocaleString();
}

function getFacilityUpgradeCost(level: number): number {
  return (level + 1) * 250_000;
}

function getMainHubExpansionCost(level: number): number {
  return (level + 1) * 500_000;
}

type SortKey = "name" | "position" | "wage" | "value" | "contract";

const LEDGER_KIND_LABELS: Record<FinancialTransactionKind, string> = {
  Salary: "Salary",
  StaffWage: "Staff wage",
  FacilityUpkeep: "Facility upkeep",
  FacilityUpgrade: "Facility upgrade",
  TransferPurchase: "Transfer purchase",
  TransferSale: "Transfer sale",
  ReleasePenalty: "Release penalty",
  AcademyAcquisition: "Academy acquisition",
  Sponsorship: "Sponsorship",
  MatchdayRevenue: "Matchday revenue",
  PrizeMoney: "Prize money",
  BudgetRefresh: "Budget refresh",
  Other: "Other",
};

function formatLedgerAmount(amount: number): string {
  const sign = amount < 0 ? "-" : "+";
  const absoluteAmount = Math.abs(amount);
  const formattedAmount = absoluteAmount % 1_000 === 0
    ? formatVal(absoluteAmount)
    : formatCurrencyAmount(absoluteAmount);
  return `${sign}${formattedAmount}`;
}

const FACILITY_ICONS: Record<string, React.ReactNode> = {
  ScrimsRoom: <Monitor className="size-5" />,
  AnalysisRoom: <Search className="size-5" />,
  BootcampArea: <Dumbbell className="size-5" />,
  RecoverySuite: <BedDouble className="size-5" />,
  ContentStudio: <Camera className="size-5" />,
  ScoutingLab: <Binoculars className="size-5" />,
};

export function FinancesTabV2({ gameState, onGameUpdate, onSelectPlayer }: FinancesTabV2Props) {
  const { t } = useTranslation();
  const annualSuffix = t("finances.perYearSuffix", "/yr");
  const monthlySuffix = t("finances.perMonthSuffix", "/mo");

  const myTeam = gameState.teams.find((tm) => tm.id === gameState.manager.team_id);
  const roster = myTeam ? gameState.players.filter((p) => p.team_id === myTeam.id) : [];
  const teamStaff = myTeam
    ? gameState.staff.filter((s) => s.team_id === myTeam.id)
    : [];

  const [activeTab, setActiveTab] = useState("overview");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [delegatedRenewalsSummary, setDelegatedRenewalsSummary] = useState<string | null>(null);
  const [selectedRiskPlayerIds, setSelectedRiskPlayerIds] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("wage");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [ledgerKindFilter, setLedgerKindFilter] = useState<FinancialTransactionKind | "all">("all");
  const [ledgerSourceFilter, setLedgerSourceFilter] = useState("all");

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "wage" || key === "value" ? "desc" : "asc");
    }
  };

  const teamBalance = safeFinanceNumber(myTeam?.finance);
  const teamTransferBudget = safeFinanceNumber(myTeam?.transfer_budget);
  const seasonNetSummary = myTeam
    ? getSeasonNetSummary(myTeam)
    : { income: 0, expenses: 0, net: 0 };
  const transferBudgetSummary = myTeam
    ? getTransferBudgetSummary(myTeam)
    : { spend: 0, remaining: 0, total: 0, usagePercent: 0 };
  const financialLedger = myTeam ? getFinancialLedger(myTeam) : [];
  const ledgerSources = useMemo(() => getLedgerSources(financialLedger), [financialLedger]);
  const filteredLedger = useMemo(
    () => filterLedgerEntries(financialLedger, {
      search: ledgerSearch,
      kind: ledgerKindFilter,
      source: ledgerSourceFilter,
    }),
    [financialLedger, ledgerSearch, ledgerKindFilter, ledgerSourceFilter],
  );
  const ledgerGroups = useMemo(() => groupLedgerEntriesByDate(filteredLedger), [filteredLedger]);
  const totalValue = roster.reduce((s, p) => s + safeFinanceNumber(p.market_value), 0);

  const financeSnapshot = myTeam
    ? getTeamFinanceSnapshot(myTeam, roster, teamStaff)
    : {
        annualWageBill: 0, annualWageBudget: 0, annualSponsorIncome: 0,
        monthlyWageBudget: 0, projectedAnnualNet: 0, cashRunwayMonths: null,
        wageBudgetUsagePercent: 0, wageBudgetStatus: "stable" as const,
        runwayStatus: "stable" as const, overallStatus: "stable" as const,
      };
  const totalWages = financeSnapshot.annualWageBill;
  const annualWageBudget = financeSnapshot.annualWageBudget;
  const annualSponsorIncome = financeSnapshot.annualSponsorIncome;
  const projectedAnnualNet = financeSnapshot.projectedAnnualNet;
  const cashRunwayMonths = financeSnapshot.cashRunwayMonths;
  const wageBudgetUsagePercent = financeSnapshot.wageBudgetUsagePercent;
  const playerWages = roster.reduce((s, p) => s + safeFinanceNumber(p.wage), 0);
  const staffWages = teamStaff.reduce((s, st) => s + safeFinanceNumber(st.wage), 0);
  const installationContract = myTeam ? getClubInstallationContract(myTeam) : [];
  const mainHubLevel = installationContract.reduce((max, m) => Math.max(max, m.level), 1);
  const nextHubExpansionCost = getMainHubExpansionCost(mainHubLevel);
  const canExpandMainHub = teamBalance >= nextHubExpansionCost;
  const activeSponsorship = getSponsorshipContractView(myTeam?.sponsorship);
  const contractRiskPlayers = useMemo(
    () =>
      roster
        .map((player) => {
          const riskLevel = getContractRiskLevel(player.contract_end, gameState.clock.current_date);
          return { player, riskLevel };
        })
        .filter(({ riskLevel, player }) => player.contract_end && riskLevel !== "stable")
        .sort((a, b) => (a.player.contract_end ?? "9999-12-31").localeCompare(b.player.contract_end ?? "9999-12-31")),
    [roster, gameState.clock.current_date],
  );
  const atRiskWages = contractRiskPlayers.reduce((s, { player }) => s + safeFinanceNumber(player.wage), 0);
  const allRiskPlayerIds = contractRiskPlayers.map(({ player }) => player.id);
  const selectedRiskPlayers = contractRiskPlayers.filter(({ player }) => selectedRiskPlayerIds.includes(player.id));

  useEffect(() => {
    setSelectedRiskPlayerIds((current) => {
      const available = new Set(allRiskPlayerIds);
      const next = current.filter((id) => available.has(id));
      return next.length > 0 ? next : allRiskPlayerIds;
    });
  }, [allRiskPlayerIds.join("|")]);

  const handleToggleRiskPlayer = (playerId: string) =>
    setSelectedRiskPlayerIds((current) =>
      current.includes(playerId) ? current.filter((id) => id !== playerId) : [...current, playerId],
    );

  const handleToggleAllRiskPlayers = () =>
    setSelectedRiskPlayerIds((current) =>
      current.length === allRiskPlayerIds.length ? [] : allRiskPlayerIds,
    );

  const handleUpgradeFacility = async (facility: FacilityUpgradeId) => {
    setActionLoading(facility);
    try {
      const updated = await invoke<GameStateData>("upgrade_main_facility_module", { module: facility });
      onGameUpdate(updated);
    } catch (err) {
      console.error("Failed to upgrade facility:", err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleExpandMainHub = async () => {
    setActionLoading("expand-main-hub");
    try {
      const updated = await invoke<GameStateData>("expand_main_facility_hub");
      onGameUpdate(updated);
    } catch (err) {
      console.error("Failed to expand hub:", err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelegateRenewals = async () => {
    if (selectedRiskPlayers.length === 0) return;
    const loadingKey = "delegate-renewals";
    setActionLoading(loadingKey);
    setDelegatedRenewalsSummary(null);
    try {
      const result = await invoke<{
        game: GameStateData;
        report: { success_count: number; failure_count: number; stalled_count: number };
      }>("delegate_renewals", {
        playerIds: selectedRiskPlayers.map(({ player }) => player.id),
        maxWageIncreasePct: 35,
        maxContractYears: 3,
      });
      onGameUpdate(result.game);
      setDelegatedRenewalsSummary(
        t("finances.delegatedRenewalsSummary", {
          successes: result.report.success_count,
          stalled: result.report.stalled_count,
          failures: result.report.failure_count,
        }),
      );
    } catch (err) {
      console.error("Failed to delegate renewals:", err);
    } finally {
      setActionLoading(null);
    }
  };

  if (!myTeam) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="font-heading text-sm uppercase tracking-wider text-muted-foreground">
          {t("common.noTeam")}
        </p>
      </div>
    );
  }

  const sortedRoster = [...roster].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    switch (sortKey) {
      case "name": return dir * a.match_name.localeCompare(b.match_name);
      case "position": return dir * getLolRoleForPlayer(a).localeCompare(getLolRoleForPlayer(b));
      case "wage": return dir * (safeFinanceNumber(a.wage) - safeFinanceNumber(b.wage));
      case "value": return dir * (safeFinanceNumber(a.market_value) - safeFinanceNumber(b.market_value));
      case "contract": return dir * (a.contract_end || "").localeCompare(b.contract_end || "");
      default: return 0;
    }
  });

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-6">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0">
        <TabsList variant="line">
          <TabsTrigger value="overview">{t("finances.overviewTab", "Resumen")}</TabsTrigger>
          <TabsTrigger value="facilities">{t("finances.facilitiesTab", "Instalaciones")}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex flex-col gap-4">
      {/* Overview */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="font-heading text-sm uppercase tracking-widest text-muted-foreground">
            {t("finances.overview")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-lg bg-muted/50 p-3 text-center">
              <p className="font-heading text-2xs uppercase tracking-wider text-muted-foreground">{t("finances.clubBalance")}</p>
              <p className={cn("mt-1 font-heading text-lg font-bold tabular-nums", teamBalance >= 0 ? "text-positive" : "text-negative")}>{formatVal(teamBalance)}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3 text-center">
              <p className="font-heading text-2xs uppercase tracking-wider text-muted-foreground">{t("finances.annualWageBudget", "Annual wage budget")}</p>
              <p className="mt-1 font-heading text-lg font-bold tabular-nums text-foreground">{formatVal(annualWageBudget)}</p>
              <p className="mt-1 text-2xs text-muted-foreground">
                {t("finances.monthlyCommitment", "Monthly commitment")}: {activeCurrencySymbol()}{financeSnapshot.monthlyWageBudget.toLocaleString()}{monthlySuffix}
              </p>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                <div className={cn("h-full rounded-full transition-all", wageBudgetUsagePercent > 100 ? "bg-negative" : "bg-primary")} style={{ width: `${Math.min(100, wageBudgetUsagePercent)}%` }} />
              </div>
            </div>
            <div className="rounded-lg bg-muted/50 p-3 text-center">
              <p className="font-heading text-2xs uppercase tracking-wider text-muted-foreground">{t("finances.transferBudgetRemaining", "Transfer budget remaining")}</p>
              <p className="mt-1 font-heading text-lg font-bold tabular-nums text-foreground">{formatVal(teamTransferBudget)}</p>
              <p className="mt-1 text-2xs text-muted-foreground">
                {t("finances.transferSpendThisSeason", "Transfer spend this season")}: {formatVal(transferBudgetSummary.spend)} spent
              </p>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary/60 transition-all" style={{ width: `${Math.min(100, transferBudgetSummary.usagePercent)}%` }} />
              </div>
            </div>
            <div className="rounded-lg bg-muted/50 p-3 text-center">
              <p className="font-heading text-2xs uppercase tracking-wider text-muted-foreground">{t("finances.seasonIncome")}</p>
              <p className="mt-1 font-heading text-lg font-bold tabular-nums text-positive">{formatVal(seasonNetSummary.income)}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3 text-center">
              <p className="font-heading text-2xs uppercase tracking-wider text-muted-foreground">{t("finances.seasonExpenses")}</p>
              <p className="mt-1 font-heading text-lg font-bold tabular-nums text-negative">{formatVal(seasonNetSummary.expenses)}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3 text-center">
              <p className="font-heading text-2xs uppercase tracking-wider text-muted-foreground">{t("finances.seasonNet", "Season net")}</p>
              <p className={cn("mt-1 font-heading text-lg font-bold tabular-nums", seasonNetSummary.net >= 0 ? "text-positive" : "text-negative")}>{formatVal(seasonNetSummary.net)}</p>
              <p className="mt-1 text-2xs text-muted-foreground">{t("finances.squadValue")}: {formatVal(totalValue)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Wage Bill + Cash Flow */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="space-y-0">
            <CardTitle className="font-heading text-sm uppercase tracking-widest text-muted-foreground">
              {t("finances.annualWageBill", "Annual wage bill")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center">
              <p className="font-heading text-2xl font-bold tabular-nums text-foreground">
                {activeCurrencySymbol()}{totalWages.toLocaleString()}{annualSuffix}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("finances.budget")}: {activeCurrencySymbol()}{annualWageBudget.toLocaleString()}{annualSuffix}
                {totalWages <= annualWageBudget ? (
                  <span className="ml-1 text-positive">— {t("finances.underBudget")}</span>
                ) : (
                  <span className="ml-1 inline-flex items-center gap-1 text-negative">
                    <AlertTriangle className="size-3" /> {t("finances.overBudget")}
                  </span>
                )}
              </p>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full transition-all", totalWages <= annualWageBudget ? "bg-positive" : "bg-negative")}
                  style={{ width: `${Math.min(100, Math.round((totalWages / Math.max(1, annualWageBudget)) * 100))}%` }}
                />
              </div>
            </div>

            {/* Wage breakdown */}
            <div className="mt-4 space-y-2 border-t border-border pt-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{t("finances.playerWages", "Sueldos jugadores")}</span>
                <span className="tabular-nums text-foreground">{activeCurrencySymbol()}{playerWages.toLocaleString()}{annualSuffix}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(100, (playerWages / Math.max(1, totalWages)) * 100)}%` }} />
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{t("finances.staffWages", "Sueldos staff")}</span>
                <span className="tabular-nums text-foreground">{activeCurrencySymbol()}{staffWages.toLocaleString()}{annualSuffix}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-warning transition-all" style={{ width: `${Math.min(100, (staffWages / Math.max(1, totalWages)) * 100)}%` }} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-0">
            <CardTitle className="font-heading text-sm uppercase tracking-widest text-muted-foreground">
              {t("finances.cashFlow")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-muted/50 p-3 text-center">
                <p className="font-heading text-2xs uppercase tracking-wider text-muted-foreground">{t("finances.annualWageSpend")}</p>
                <p className="mt-1 font-heading text-lg font-bold text-negative tabular-nums">{activeCurrencySymbol()}{totalWages.toLocaleString()}{annualSuffix}</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3 text-center">
                <p className="font-heading text-2xs uppercase tracking-wider text-muted-foreground">{t("finances.annualSponsorIncome")}</p>
                <p className="mt-1 font-heading text-lg font-bold text-positive tabular-nums">{activeCurrencySymbol()}{annualSponsorIncome.toLocaleString()}{annualSuffix}</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-muted/50 p-3 text-center">
                <p className="font-heading text-2xs uppercase tracking-wider text-muted-foreground">{t("finances.projectedAnnualNet")}</p>
                <p className={cn("mt-1 font-heading text-lg font-bold tabular-nums", projectedAnnualNet >= 0 ? "text-positive" : "text-negative")}>
                  {activeCurrencySymbol()}{projectedAnnualNet.toLocaleString()}{annualSuffix}
                </p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3 text-center">
                <p className="font-heading text-2xs uppercase tracking-wider text-muted-foreground">{t("finances.cashRunway")}</p>
                <p className={cn("mt-1 font-heading text-lg font-bold tabular-nums", cashRunwayMonths !== null && cashRunwayMonths < 12 ? "text-negative" : cashRunwayMonths !== null && cashRunwayMonths < 52 ? "text-warning" : "text-foreground")}>
                  {cashRunwayMonths === null ? t("finances.runwayStable") : t("finances.runwayMonths", { count: cashRunwayMonths })}
                </p>
              </div>
            </div>
            {cashRunwayMonths !== null && (
              <div className="mt-3">
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{t("finances.cashRunway")}</span>
                  <span className={cn("tabular-nums font-medium", cashRunwayMonths < 12 ? "text-negative" : cashRunwayMonths < 52 ? "text-warning" : "text-positive")}>
                    {cashRunwayMonths}m
                  </span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("h-full rounded-full transition-all", cashRunwayMonths < 12 ? "bg-negative" : cashRunwayMonths < 52 ? "bg-warning" : "bg-positive")}
                    style={{ width: `${Math.min(100, (cashRunwayMonths / 60) * 100)}%` }}
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="space-y-0">
          <CardTitle className="font-heading text-sm uppercase tracking-widest text-muted-foreground">
            {t("finances.recentLedger", "Recent ledger")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {financialLedger.length > 0 ? (
            <div className="space-y-3">
              <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
                <label className="sr-only" htmlFor="ledger-search">{t("finances.ledgerSearchLabel")}</label>
                <input
                  id="ledger-search"
                  value={ledgerSearch}
                  onChange={(event) => setLedgerSearch(event.target.value)}
                  placeholder={t("finances.ledgerSearchPlaceholder")}
                  className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-foreground transition-colors placeholder:text-muted-foreground focus:border-primary"
                />
                <label className="sr-only" htmlFor="ledger-kind-filter">{t("finances.ledgerKindFilter")}</label>
                <select
                  id="ledger-kind-filter"
                  value={ledgerKindFilter}
                  onChange={(event) => setLedgerKindFilter(event.target.value as FinancialTransactionKind | "all")}
                  className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-foreground focus:border-primary"
                >
                  <option value="all">{t("finances.ledgerAllKinds")}</option>
                  {(Object.keys(LEDGER_KIND_LABELS) as FinancialTransactionKind[]).map((kind) => (
                    <option key={kind} value={kind}>{LEDGER_KIND_LABELS[kind]}</option>
                  ))}
                </select>
                <label className="sr-only" htmlFor="ledger-source-filter">{t("finances.ledgerSourceFilter")}</label>
                <select
                  id="ledger-source-filter"
                  value={ledgerSourceFilter}
                  onChange={(event) => setLedgerSourceFilter(event.target.value)}
                  className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-foreground focus:border-primary"
                >
                  <option value="all">{t("finances.ledgerAllSources")}</option>
                  {ledgerSources.map((source) => (
                    <option key={source} value={source}>{t(`finances.ledgerSource.${source}`)}</option>
                  ))}
                </select>
              </div>
              {ledgerGroups.length > 0 ? ledgerGroups.map((group) => (
                <section key={group.date} className="space-y-2">
                  <h4 className="font-heading text-2xs uppercase tracking-wider text-muted-foreground tabular-nums">{group.date}</h4>
                  {group.entries.map((entry, index) => {
                    const balanceAfter = getLedgerEntryBalanceAfter(entry);
                    return (
                      <div key={`${entry.id ?? entry.date}-${entry.kind}-${index}`} className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-lg bg-muted/40 px-3 py-2 text-sm md:grid-cols-[1fr_8rem_auto]">
                        <div className="min-w-0">
                          <span className="block truncate text-foreground">{entry.description || (LEDGER_KIND_LABELS[entry.kind] ?? entry.kind)}</span>
                          <span className="mt-0.5 inline-flex gap-2 text-caption text-muted-foreground">
                            <span>{LEDGER_KIND_LABELS[entry.kind] ?? entry.kind}</span>
                            <span>·</span>
                            <span>{t(getLedgerEntrySourceLabelKey(entry), getLedgerEntrySource(entry))}</span>
                          </span>
                        </div>
                        <span className="hidden text-xs tabular-nums text-muted-foreground md:inline">
                          {balanceAfter === null ? "—" : `${t("finances.ledgerRunningBalance")}: ${formatVal(balanceAfter)}`}
                        </span>
                        <span className={cn("font-heading font-bold tabular-nums", entry.amount < 0 ? "text-negative" : "text-positive")}>
                          {formatLedgerAmount(entry.amount)}
                        </span>
                      </div>
                    );
                  })}
                </section>
              )) : (
                <p className="text-sm text-muted-foreground">{t("finances.ledgerNoMatches")}</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("finances.ledgerEmpty", "No financial ledger entries yet.")}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Sponsors + Contract Risk */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="space-y-0">
            <CardTitle className="font-heading text-sm uppercase tracking-widest text-muted-foreground">
              {t("finances.activeSponsor")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activeSponsorship ? (
              <div className="flex items-start gap-4">
                <div className="flex size-14 shrink-0 items-center justify-center rounded-xl border-2 border-border bg-muted/50 font-heading text-xl font-bold uppercase text-muted-foreground">
                  {activeSponsorship.sponsorName.charAt(0)}
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate font-heading text-base font-bold uppercase tracking-wide text-foreground">
                      {activeSponsorship.sponsorName}
                    </h3>
                    <Badge variant={activeSponsorship.theme === "esports" ? "default" : "secondary"} className="text-2xs">
                      {activeSponsorship.theme === "esports" ? t("finances.esportsSponsor") : t("finances.standardSponsor")}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("finances.sponsorWeeklyValue", { amount: Math.round(activeSponsorship.baseValue / 12) })}
                    <span className="mx-1.5 text-border">·</span>
                    {t("finances.sponsorRemainingMonths", { count: activeSponsorship.remainingMonths })}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("finances.noActiveSponsor")}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="font-heading text-sm uppercase tracking-widest text-muted-foreground">
              {t("finances.contractRisk")}
            </CardTitle>
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted-foreground tabular-nums">
                {t("finances.atRiskWages", { amount: formatVal(atRiskWages) })}
              </p>
              {contractRiskPlayers.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={handleToggleAllRiskPlayers}
                    className="rounded-md border border-border px-2 py-1 text-2xs font-medium text-muted-foreground transition-colors hover:bg-muted"
                  >
                    {t("finances.selectAllAtRisk")}
                  </button>
                  <button
                    type="button"
                    disabled={actionLoading === "delegate-renewals" || selectedRiskPlayers.length === 0}
                    onClick={handleDelegateRenewals}
                    className="rounded-md border border-primary bg-primary/10 px-2 py-1 text-2xs font-medium text-club-text transition-colors hover:bg-primary/20 disabled:pointer-events-none disabled:opacity-50"
                  >
                    {actionLoading === "delegate-renewals" ? (
                      <RefreshCw className="mr-1 inline size-3 animate-spin" />
                    ) : null}
                    {t("finances.delegateSelectedRenewals")}
                  </button>
                </>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {delegatedRenewalsSummary && (
              <p className="mb-3 text-xs text-positive">{delegatedRenewalsSummary}</p>
            )}
            {contractRiskPlayers.length > 0 ? (
              <div className="space-y-2">
                {contractRiskPlayers.map(({ player, riskLevel }) => {
                  const yearsRemaining = Number.parseFloat(getContractYearsRemaining(player.contract_end, gameState.clock.current_date));
                  return (
                    <div
                      key={player.id}
                      className={cn(
                        "flex items-center gap-3 rounded-lg border p-3 transition-colors",
                        riskLevel === "critical" ? "border-negative/20 bg-negative/5" : "border-warning/20 bg-warning/5",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selectedRiskPlayerIds.includes(player.id)}
                        onChange={() => handleToggleRiskPlayer(player.id)}
                        className="size-4 accent-primary"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">{player.match_name}</p>
                        <div className="mt-1 flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn("h-full rounded-full transition-all", riskLevel === "critical" ? "bg-negative" : "bg-warning")}
                              style={{ width: `${Math.min(100, (yearsRemaining / 5) * 100)}%` }}
                            />
                          </div>
                          <span className="font-heading text-2xs tabular-nums text-muted-foreground">{yearsRemaining.toFixed(1)}y</span>
                        </div>
                      </div>
                      <Badge variant={riskLevel === "critical" ? "destructive" : "secondary"} className="text-2xs">
                        {riskLevel === "critical" ? t("finances.contractRiskCritical") : t("finances.contractRiskWarning")}
                      </Badge>
                      <p className="font-heading text-xs font-bold tabular-nums text-foreground">
                        {activeCurrencySymbol()}{safeFinanceNumber(player.wage).toLocaleString()}{annualSuffix}
                      </p>
                      {onSelectPlayer && (
                        <button
                          type="button"
                          onClick={() => onSelectPlayer(player.id, { openRenewal: true })}
                          className="rounded-md border border-border px-2 py-1 text-2xs font-medium text-muted-foreground transition-colors hover:bg-muted"
                        >
                          {t("common.renewContract")}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("finances.noContractRisks")}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Payroll */}
      <Card>
        <CardHeader className="space-y-0">
          <CardTitle className="font-heading text-sm uppercase tracking-widest text-muted-foreground">
            {t("finances.payroll")}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14" />
                  {(["name", "position", "wage", "value", "contract"] as const).map((key) => (
                    <TableHead key={key} className="cursor-pointer" onClick={() => toggleSort(key)}>
                      <span className="inline-flex items-center gap-1">
                        {key === "name" && t("common.player")}
                        {key === "position" && t("common.position")}
                        {key === "wage" && t("finances.wagePerWeek")}
                        {key === "value" && t("finances.marketValue")}
                        {key === "contract" && t("common.contract")}
                        {sortKey === key ? (
                          sortDir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />
                        ) : (
                          <ArrowUpDown className="size-3 opacity-40" />
                        )}
                      </span>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRoster.map((p, i) => {
                  const role = getLolRoleForPlayer(p);
                  const photo = resolvePlayerPhoto(p.id, p.match_name, p.profile_image_url);
                  return (
                    <TableRow
                      key={p.id}
                      onClick={() => onSelectPlayer?.(p.id)}
                      className="cursor-pointer"
                    >
                      <TableCell className={cn(i % 2 === 1 && "bg-muted/20")}>
                        {photo ? (
                          <img src={photo} alt={p.match_name} className="size-8 rounded-full object-cover" />
                        ) : (
                          <div className="flex size-8 items-center justify-center rounded-full bg-muted">
                            <User className="size-4 text-muted-foreground" />
                          </div>
                        )}
                      </TableCell>
                      <TableCell className={cn(i % 2 === 1 && "bg-muted/20")}>
                        <span className="text-sm font-medium text-foreground">{p.match_name}</span>
                      </TableCell>
                      <TableCell className={cn(i % 2 === 1 && "bg-muted/20")}>
                        <span className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 font-heading text-2xs uppercase tracking-wider text-muted-foreground">
                          {role}
                        </span>
                      </TableCell>
                      <TableCell className={cn("tabular-nums text-sm text-foreground", i % 2 === 1 && "bg-muted/20")}>
                        {activeCurrencySymbol()}{safeFinanceNumber(p.wage).toLocaleString()}
                      </TableCell>
                      <TableCell className={cn("tabular-nums text-sm text-muted-foreground", i % 2 === 1 && "bg-muted/20")}>
                        {formatVal(safeFinanceNumber(p.market_value))}
                      </TableCell>
                      <TableCell className={cn("text-sm text-muted-foreground", i % 2 === 1 && "bg-muted/20")}>
                        {p.contract_end ? t("finances.until", { year: p.contract_end.substring(0, 4) }) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      </TabsContent>

      <TabsContent value="facilities" className="flex flex-col flex-1">
      <Card className="flex-1">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="font-heading text-sm uppercase tracking-widest text-muted-foreground">
            {t("finances.facilities")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Hub expansion */}
          <div className="mb-4 rounded-lg border-2 border-dashed border-border bg-muted/20 p-4">
            <div className="flex flex-col items-start gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/50">
                  <Monitor className="size-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="font-heading text-sm font-bold text-foreground">
                    {t("finances.mainHub", "Hub principal")} · Lv.{mainHubLevel}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("finances.nextUpgradeCost", { amount: nextHubExpansionCost.toLocaleString() })}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={!canExpandMainHub || actionLoading === "expand-main-hub"}
                onClick={handleExpandMainHub}
                className="shrink-0 rounded-md border border-primary bg-primary/10 px-3 py-1.5 text-xs font-medium text-club-text transition-colors hover:bg-primary/20 disabled:pointer-events-none disabled:opacity-50"
              >
                {actionLoading === "expand-main-hub" ? (
                  <RefreshCw className="mr-1 inline size-3 animate-spin" />
                ) : null}
                {t("finances.expandOffices")}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {installationContract.map((facility) => {
              const level = facility.level;
              const nextCost = getFacilityUpgradeCost(level);
              const unlocksNextLevel = level + 1 <= mainHubLevel;
              const canUpgrade = Boolean(facility.upgradeFacility) && unlocksNextLevel && teamBalance >= nextCost;
              const isLoading = actionLoading === facility.upgradeFacility;

              return (
                <div key={facility.key} className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 shrink-0 text-muted-foreground">
                      {FACILITY_ICONS[facility.key] ?? <Monitor className="size-5" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-heading text-sm font-bold uppercase tracking-wide text-foreground">
                          {t(facility.labelKey, facility.label)}
                        </h3>
                        <span className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 font-heading text-2xs tabular-nums text-muted-foreground">
                          Lv.{level}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{t(facility.effectKey)}</p>
                      <p className="text-xs text-muted-foreground">
                        {t("finances.monthlyUpkeep", {
                          amount: formatCurrencyAmountParam(facility.monthlyUpkeep),
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="mt-auto space-y-1">
                    <p className="font-heading text-2xs uppercase tracking-wider text-muted-foreground">
                      {t("finances.nextUpgradeCost", { amount: nextCost.toLocaleString() })}
                    </p>
                    <button
                      type="button"
                      disabled={!canUpgrade || isLoading}
                      onClick={() => facility.upgradeFacility && handleUpgradeFacility(facility.upgradeFacility)}
                      className="rounded-md border border-primary bg-primary/10 px-3 py-1 text-xs font-medium text-club-text transition-colors hover:bg-primary/20 disabled:pointer-events-none disabled:opacity-50"
                    >
                      {isLoading ? <RefreshCw className="mr-1 inline size-3 animate-spin" /> : null}
                      {t("finances.upgradeFacility")}
                    </button>
                    {(!facility.upgradeFacility || !unlocksNextLevel) && (
                      <p className="flex items-center gap-1 text-2xs text-muted-foreground">
                        <Lock className="size-3" /> {t("finances.hubExpansionRequired")}
                      </p>
                    )}
                    {canUpgrade === false && facility.upgradeFacility && unlocksNextLevel && (
                      <p className="text-2xs text-negative">{t("finances.insufficientFunds")}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
      </TabsContent>
    </Tabs>
    </div>
  );
}
