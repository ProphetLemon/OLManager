import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronLeft,
  ChevronRight,
  Gavel,
  Globe,
  Handshake,
  Search,
  ShoppingCart,
  TrendingUp,
  X,
} from "lucide-react";

import type {
  GameStateData,
  PlayerData,
  PlayerSelectionOptions,
} from "@/store/gameStore";
import { useTabUiField } from "@/store/tabUiStore";
import { formatVal, calcAge, getTeamName } from "@/lib/common/helpers";
import { calculateLolOvr } from "@/lib/players/lolPlayerStats";
import { resolvePlayerPhoto } from "@/lib/players/playerPhotos";
import { resolvePlayerCurrentLolRole } from "@/lib/players/lolIdentity";
import { ROLE_ICON_PATHS } from "@/lib/players/roleIcons";
import { countryName } from "@/lib/common/countries";
import { resolveSeasonContext } from "@/lib/season/seasonContext";
import { getAnnualWageBill, getTransferBudgetSummary } from "@/lib/finances/finance";
import {
  counterOffer,
  makeTransferBid,
  previewTransferBidFinancialImpact,
  respondToOffer,
  negotiatePlayerWage,
} from "@/services/transfersService";
import type {
  TransferBidProjectionData,
  TransferNegotiationResponseData,
} from "@/services/transfersService";

type NegotiationResult = TransferNegotiationResponseData["decision"] | "error" | null;
import {
  buildResumedBidFeedback,
  buildResumedCounterFeedback,
  getOutgoingNegotiationOffer,
  mapTransferNegotiationError,
} from "@/lib/transfers/helpers";
import {
  deriveTransferCollections,
  filterTransferPlayers,
  getCurrentTransferList,
  sortTransferPlayers,
  type TransferSortKey,
  type TransferSortState,
  type TransferTabView,
} from "@/lib/transfers/model";
import { type NegotiationFeedbackPanelData } from "@/lib/transfers/negotiationFeedback";
import TransferBidDialog from "./transfers/TransferBidDialog";
import TransferCounterOfferDialog from "./transfers/TransferCounterOfferDialog";
import WageNegotiationDialog from "./transfers/WageNegotiationDialog";
import { CountryFlag } from "@/ui-v2/components/ui/country-flag";

import { Badge } from "@/ui-v2/components/ui/badge";
import { Card, CardContent } from "@/ui-v2/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui-v2/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/ui-v2/components/ui/tabs";
import { cn } from "@/ui-v2/lib/utils";

interface TransfersTabV2Props {
  gameState: GameStateData;
  onSelectPlayer: (id: string, options?: PlayerSelectionOptions) => void;
  onSelectTeam: (id: string) => void;
  onGameUpdate: (game: GameStateData) => void;
}

type CounterTarget = {
  player: PlayerData;
  offerId: string;
  fromTeamId: string;
  fee: number;
};

type WageNegotiationTarget = {
  player: PlayerData;
  offerId: string;
  fromTeamId: string | null;
  fee: number;
  destinationTeamId: string;
};

const TABS: { id: TransferTabView; labelKey: string; icon: React.ReactNode }[] = [
  { id: "my_list", labelKey: "transfers.myTransferList", icon: <ShoppingCart className="size-4" /> },
  { id: "market", labelKey: "transfers.transferMarket", icon: <TrendingUp className="size-4" /> },
  { id: "erl", labelKey: "transfers.erlMarket", icon: <Globe className="size-4" /> },
  { id: "loans", labelKey: "transfers.loanMarket", icon: <ArrowRightLeft className="size-4" /> },
  { id: "offers", labelKey: "transfers.offers", icon: <Handshake className="size-4" /> },
];

const POSITIONS = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"] as const;



function soloqTierImage(lp: number | undefined): string {
  if (!lp || lp <= 0) return "/ladder-icons/unranked.webp";
  if (lp >= 1300) return "/ladder-icons/challenger.webp";
  if (lp >= 800) return "/ladder-icons/grandmaster.webp";
  return "/ladder-icons/master.webp";
}

export function TransfersTabV2({
  gameState,
  onSelectPlayer,
  onSelectTeam,
  onGameUpdate,
}: TransfersTabV2Props) {
  const { t, i18n } = useTranslation();
  const userTeamId = gameState.manager.team_id;
  const myTeam = gameState.teams.find((team) => team.id === userTeamId);
  const academyTeam = gameState.teams.find(
    (team) => team.id === myTeam?.academy_team_id,
  ) ?? gameState.teams.find(
    (team) => team.team_kind === "Academy" && team.parent_team_id === myTeam?.id,
  ) ?? null;
  const managedTeamIds = [myTeam?.id, academyTeam?.id].filter(Boolean) as string[];

  const myRoster = myTeam ? gameState.players.filter((p) => p.team_id === myTeam.id) : [];
  const totalAnnualWages = getAnnualWageBill(myRoster);

  // ─── View + Sort + Filter state ───
  // Persisted in a store so the state survives the tab unmounting while a profile is open.
  const [viewState, setView] = useTabUiField("transfers", "view");
  const view = viewState as TransferTabView;
  const [search, setSearch] = useTabUiField("transfers", "search");
  const [posFilter, setPosFilter] = useTabUiField("transfers", "posFilter");
  const [competitionFilter, setCompetitionFilter] = useTabUiField("transfers", "competitionFilter");
  const [sortState, setSort] = useTabUiField("transfers", "sort");
  const sort = sortState as TransferSortState | null;
  const [page, setPage] = useTabUiField("transfers", "page");
  const PAGE_SIZE = 25;

  // ─── Bid modal state ───
  const [bidTarget, setBidTarget] = useState<PlayerData | null>(null);
  const [bidAmount, setBidAmount] = useState("");
  const [bidDestination, setBidDestination] = useState<"main" | "academy">("main");
  const [bidLoading, setBidLoading] = useState(false);
  const [bidResult, setBidResult] = useState<NegotiationResult>(null);
  const [bidFeedback, setBidFeedback] = useState<NegotiationFeedbackPanelData | null>(null);
  const [bidError, setBidError] = useState<string | null>(null);
  const [bidProjection, setBidProjection] = useState<
    TransferBidProjectionData["projection"] | null
  >(null);
  const [bidSelectedPlayerIds, setBidSelectedPlayerIds] = useState<string[]>([]);

  // ─── Counter modal state ───
  const [counterTarget, setCounterTarget] = useState<CounterTarget | null>(null);
  const [counterAmount, setCounterAmount] = useState("");
  const [counterLoading, setCounterLoading] = useState(false);
  const [counterResult, setCounterResult] = useState<NegotiationResult>(null);
  const [counterFeedback, setCounterFeedback] = useState<NegotiationFeedbackPanelData | null>(null);
  const [counterError, setCounterError] = useState<string | null>(null);
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>([]);

  // ─── Wage modal state ───
  const [wageTarget, setWageTarget] = useState<WageNegotiationTarget | null>(null);
  const [wageAmount, setWageAmount] = useState("");
  const [contractYears, setContractYears] = useState(3);
  const [wageLoading, setWageLoading] = useState(false);
  const [wageResult, setWageResult] = useState<NegotiationResult>(null);
  const [wageFeedback, setWageFeedback] = useState<NegotiationFeedbackPanelData | null>(null);
  const [wageError, setWageError] = useState<string | null>(null);

  // ─── Data ───
  const seasonContext = resolveSeasonContext(gameState);
  const transferWindow = seasonContext.transfer_window;
  const transferCollections = deriveTransferCollections(gameState, userTeamId);
  const { myTransferList, myLoanList, marketPlayers, erlPlayers, loanPlayers, playersWithOffers } =
    transferCollections;

  const competitionTeamIds = useMemo(() => {
    if (!competitionFilter) return null;
    return new Set(
      gameState.teams.filter((t) => t.competition_id === competitionFilter).map((t) => t.id),
    );
  }, [gameState.teams, competitionFilter]);

  const leagueOptions = useMemo(
    () => gameState.leagues.map((l) => ({ id: l.competition_id ?? l.id, name: l.name })),
    [gameState.leagues],
  );

  const currentList = getCurrentTransferList(view, transferCollections);
  const filteredList = useMemo(
    () => sortTransferPlayers(
      filterTransferPlayers(currentList, search, posFilter, competitionTeamIds),
      sort,
    ),
    [currentList, search, posFilter, competitionTeamIds, sort],
  );

  const totalPages = Math.max(1, Math.ceil(filteredList.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paginatedList = useMemo(
    () => filteredList.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE),
    [filteredList, safePage],
  );

  // Reset page when filters change
  const previousFilters = useRef<unknown[] | null>(null);
  useEffect(() => {
    const current = [search, posFilter, competitionFilter, view];
    const previous = previousFilters.current;
    previousFilters.current = current;
    // Skip the first run so a restored page is not reset on remount.
    if (previous && previous.some((value, i) => value !== current[i])) setPage(0);
  }, [search, posFilter, competitionFilter, view, setPage]);

  const tabCounts: Record<TransferTabView, number> = useMemo(
    () => ({
      my_list: myTransferList.length + myLoanList.length,
      market: marketPlayers.length,
      erl: (erlPlayers ?? []).length,
      loans: loanPlayers.length,
      offers: playersWithOffers.length,
    }),
    [myTransferList, myLoanList, marketPlayers, erlPlayers, loanPlayers, playersWithOffers],
  );

  // ─── Handlers ───
  const toggleSort = useCallback((key: TransferSortKey) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, direction: key === "ovr" || key === "value" || key === "wage" || key === "age" ? "desc" : "asc" };
      return { key, direction: prev.direction === "asc" ? "desc" : "asc" };
    });
  }, []);

  const renderSortIcon = (key: TransferSortKey) => {
    if (sort?.key !== key) return <ArrowUpDown className="size-3 opacity-40" />;
    return sort.direction === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />;
  };

  const openBidNegotiation = (player: PlayerData) => {
    setBidTarget(player);
    setBidAmount(String(player.team_id ? Math.round(player.market_value * 0.6) : 0));
    setBidDestination("main");
    setBidResult(null);
    setBidFeedback(null);
    setBidError(null);
    setBidProjection(null);
    setBidSelectedPlayerIds([]);

    const existing = getOutgoingNegotiationOffer(player, userTeamId);
    if (existing) {
      setBidAmount(String(existing.suggested_counter_fee ?? existing.fee));
      const fb = buildResumedBidFeedback(existing);
      if (fb) setBidFeedback(fb);
    }
  };

  const openCounterNegotiation = (player: PlayerData, offer: { id: string; from_team_id: string; fee: number }) => {
    setCounterTarget({ player, offerId: offer.id, fromTeamId: offer.from_team_id, fee: offer.fee });
    setCounterAmount(String(Math.round(offer.fee * 0.75)));
    setCounterError(null);
    setCounterResult(null);
    setCounterFeedback(null);
    setSelectedPlayerIds([]);

    const existing = getOutgoingNegotiationOffer(player, userTeamId);
    if (existing) {
      setCounterAmount(String(existing.suggested_counter_fee ?? existing.fee));
      const fb = buildResumedCounterFeedback(existing);
      if (fb) setCounterFeedback(fb);
    }
  };

  const isFreeAgentBid = bidTarget ? !bidTarget.team_id : false;

  const bidFee = (() => {
    const v = Number.parseFloat(bidAmount);
    if (!Number.isFinite(v)) return null;
    if (isFreeAgentBid) return Math.max(0, Math.round(v));
    return v > 0 ? Math.round(v) : null;
  })();

  useEffect(() => {
    if (!bidTarget || bidFee === null || (!isFreeAgentBid && bidFee <= 0)) {
      setBidProjection(null);
      return;
    }
    let cancelled = false;
    previewTransferBidFinancialImpact(bidTarget.id, bidFee, bidDestination)
      .then((result) => { if (!cancelled) setBidProjection(result.projection ?? null); })
      .catch(() => { if (!cancelled) setBidProjection(null); });
    return () => { cancelled = true; };
  }, [bidTarget, bidFee, bidDestination, isFreeAgentBid]);

  const userPlayersForBid = bidTarget
    ? gameState.players.filter(
        (p) => managedTeamIds.includes(p.team_id ?? "") && p.id !== bidTarget.id && p.transfer_offers.every((o) => o.status !== "Pending"),
      )
    : [];

  const userPlayersForCounter = counterTarget
    ? gameState.players.filter(
        (p) => managedTeamIds.includes(p.team_id ?? "") && p.id !== counterTarget.player.id && p.transfer_offers.every((o) => o.status !== "Pending"),
      )
    : [];

  const activeBidOffer = bidTarget ? getOutgoingNegotiationOffer(bidTarget, userTeamId) : null;
  const activeCounterOffer = counterTarget
    ? counterTarget.player.transfer_offers.find((o) => o.id === counterTarget.offerId) ?? null
    : null;
  const activeWageOffer = wageTarget
    ? wageTarget.player.transfer_offers.find((o) => o.id === wageTarget.offerId) ?? null
    : null;

  const bidSubmitDisabled =
    bidLoading ||
    bidResult === "accepted" ||
    bidFee === null ||
    (!isFreeAgentBid &&
      (bidFee <= 0 ||
        bidProjection === null ||
        bidProjection.exceeds_transfer_budget ||
        bidProjection.exceeds_finance));

  const handleMakeBid = async () => {
    if (!bidTarget || bidFee === null) return;
    setBidLoading(true);
    setBidError(null);
    setBidResult(null);
    setBidFeedback(null);
    try {
      const response = await makeTransferBid(bidTarget.id, bidFee, bidDestination, bidSelectedPlayerIds.length > 0 ? bidSelectedPlayerIds : undefined);
      onGameUpdate(response.game);
      setBidResult(response.decision);
      setBidFeedback(response.feedback);
      if (response.decision === "accepted" && !response.is_terminal) {
        const updatedPlayer = response.game.players.find((p: PlayerData) => p.id === bidTarget.id);
        const acceptedOffer = updatedPlayer?.transfer_offers.find((o) => o.status === "Accepted" && o.destination_team_id);
        if (updatedPlayer && acceptedOffer && acceptedOffer.destination_team_id) {
          setWageTarget({
            player: updatedPlayer,
            offerId: acceptedOffer.id,
            fromTeamId: String(updatedPlayer.team_id ?? ""),
            fee: bidFee,
            destinationTeamId: acceptedOffer.destination_team_id,
          });
          setWageAmount(String(Math.round(updatedPlayer.wage * 1.5)));
          setContractYears(acceptedOffer.contract_years_offered ?? 3);
          setWageResult(null);
          setWageFeedback(null);
          setWageError(null);
        }
        setBidTarget(null);
        setBidAmount("");
        setBidResult(null);
        setBidFeedback(null);
        setBidSelectedPlayerIds([]);
      } else if (response.decision === "accepted") {
        setTimeout(() => {
          setBidTarget(null);
          setBidAmount("");
          setBidResult(null);
          setBidFeedback(null);
          setBidSelectedPlayerIds([]);
        }, 1500);
      }
    } catch (err: any) {
      setBidError(mapTransferNegotiationError(t, err?.toString() || "error"));
    } finally {
      setBidLoading(false);
    }
  };

  const handleRespondOffer = async (playerId: string, offerId: string, accept: boolean) => {
    try {
      const response = await respondToOffer(playerId, offerId, accept);
      onGameUpdate(response);
    } catch (err) {
      console.error("Failed to respond to offer:", err);
    }
  };

  const handleCounterOffer = async () => {
    if (!counterTarget) return;
    const requestedFee = Math.round(parseFloat(counterAmount));
    setCounterLoading(true);
    setCounterError(null);
    setCounterResult(null);
    setCounterFeedback(null);
    try {
      const response = await counterOffer(counterTarget.player.id, counterTarget.offerId, requestedFee, selectedPlayerIds.length > 0 ? selectedPlayerIds : undefined);
      onGameUpdate(response.game);
      setCounterResult(response.decision);
      setCounterFeedback(response.feedback);
      if (response.decision === "accepted" && !response.is_terminal) {
        const updatedPlayer = response.game.players.find((p: PlayerData) => p.id === counterTarget.player.id);
        const acceptedOffer = updatedPlayer?.transfer_offers.find((o) => o.status === "Accepted" && o.destination_team_id);
        if (updatedPlayer && acceptedOffer && acceptedOffer.destination_team_id) {
          setWageTarget({
            player: updatedPlayer,
            offerId: acceptedOffer.id,
            fromTeamId: counterTarget.fromTeamId,
            fee: requestedFee,
            destinationTeamId: acceptedOffer.destination_team_id,
          });
          setWageAmount(String(Math.round(updatedPlayer.wage * 1.5)));
          setContractYears(acceptedOffer.suggested_counter_years ?? 3);
          setWageResult(null);
          setWageFeedback(null);
          setWageError(null);
        }
        setCounterTarget(null);
        setCounterAmount("");
        setCounterResult(null);
        setCounterFeedback(null);
        setSelectedPlayerIds([]);
      } else if (response.decision === "accepted") {
        setTimeout(() => {
          setCounterTarget(null);
          setCounterAmount("");
          setCounterResult(null);
          setCounterFeedback(null);
          setSelectedPlayerIds([]);
        }, 1500);
      }
    } catch (err: any) {
      setCounterError(mapTransferNegotiationError(t, err?.toString() || "error"));
    } finally {
      setCounterLoading(false);
    }
  };

  const handleWageNegotiation = async () => {
    if (!wageTarget || !wageAmount) return;
    setWageLoading(true);
    setWageError(null);
    setWageResult(null);
    setWageFeedback(null);
    try {
      const annualWage = Math.round(parseFloat(wageAmount));
      const response = await negotiatePlayerWage(wageTarget.player.id, wageTarget.offerId, annualWage, contractYears);
      onGameUpdate(response.game);
      setWageResult(response.decision);
      setWageFeedback(response.feedback);
      if (response.suggested_wage !== null) setWageAmount(String(Math.round(response.suggested_wage)));
      if (response.is_terminal && response.decision === "accepted") {
        setTimeout(() => {
          setWageTarget(null);
          setWageAmount("");
          setWageResult(null);
          setWageFeedback(null);
          setWageError(null);
        }, 2000);
      }
    } catch (err: any) {
      setWageError(mapTransferNegotiationError(t, err?.toString() || "error"));
    } finally {
      setWageLoading(false);
    }
  };

  const transferBudgetSummary = myTeam
    ? getTransferBudgetSummary(myTeam)
    : { spend: 0, remaining: 0, total: 0, usagePercent: 0 };
  const annualSuffix = t("finances.perYearSuffix", { defaultValue: "/yr" });
  const annualWageBudget = myTeam ? myTeam.wage_budget : 0;
  const wageBudgetUsagePercent = Math.round(
    (totalAnnualWages / Math.max(1, annualWageBudget)) * 100,
  );

  // ─── Render helpers ───
  const renderEmptyState = (icon: React.ReactNode, message: string, action?: React.ReactNode) => (
    <div className="flex flex-col items-center gap-3 py-16">
      <div className="text-muted-foreground/30">{icon}</div>
      <p className="text-sm text-muted-foreground">{message}</p>
      {action}
    </div>
  );

  const getTransferWindowLabel = () => {
    if (transferWindow.status === "DeadlineDay") return t("season.windowClosesToday");
    if (transferWindow.status === "Open" && transferWindow.days_remaining !== null)
      return t("season.windowClosesInDays", { count: transferWindow.days_remaining });
    if (transferWindow.status === "Closed" && transferWindow.days_until_opens !== null)
      return t("season.windowOpensInDays", { count: transferWindow.days_until_opens });
    return t("season.windowClosed");
  };

  const transferWindowVariant: "default" | "secondary" | "destructive" | "outline" =
    transferWindow.status === "DeadlineDay" ? "destructive"
    : transferWindow.status === "Open" ? "default"
    : "secondary";

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-6 scrollbar-v2">
      {/* Budget Header */}
      {myTeam && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-4 py-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="font-heading text-lg font-bold uppercase tracking-wide text-foreground">
                  <TrendingUp className="mr-2 inline size-5 text-primary" />
                  {t("transfers.centre")}
                </h2>
                <Badge variant={transferWindowVariant} className="text-[10px]">
                  {t(`season.transferWindowStatus.${transferWindow.status}`)}
                </Badge>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("transfers.transferWindow", { team: myTeam.name })} — {getTransferWindowLabel()}
              </p>
              {transferWindow.status === "Open" && transferWindow.days_remaining !== null && (
                <div className="mt-1.5 h-1 w-32 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${Math.max(5, (transferWindow.days_remaining / 30) * 100)}%` }}
                  />
                </div>
              )}
            </div>
            <div className="flex gap-3">
              <div className="min-w-[100px] rounded-lg bg-muted/30 px-3 py-2 text-center">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  {t("finances.transferBudgetRemaining", "Transfer budget remaining")}
                </p>
                <p className="font-heading text-lg font-bold tabular-nums text-primary">{formatVal(transferBudgetSummary.remaining)}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {t("finances.transferSpendThisSeason", "Transfer spend this season")}
                </p>
                <p className="text-[10px] tabular-nums text-muted-foreground">
                  {t("finances.transferSpentAmount", {
                    amount: formatVal(transferBudgetSummary.spend),
                    defaultValue: `${formatVal(transferBudgetSummary.spend)} spent`,
                  })}
                </p>
                {transferBudgetSummary.total > 0 && (
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary/60"
                      style={{ width: `${Math.min(100, transferBudgetSummary.usagePercent)}%` }}
                    />
                  </div>
                )}
              </div>
              <div className="min-w-[100px] rounded-lg bg-muted/30 px-3 py-2 text-center">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  {t("finances.annualWageBudget", "Annual wage budget")}
                </p>
                <p className="font-heading text-lg font-bold tabular-nums text-foreground">
                  {formatVal(annualWageBudget)} {annualSuffix}
                </p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {t("finances.annualWageBill", "Annual wage bill")}
                </p>
                <p className="text-[10px] tabular-nums text-muted-foreground">
                  {formatVal(totalAnnualWages)} {annualSuffix}
                </p>
                {totalAnnualWages > 0 && (
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-emerald-400/60"
                      style={{ width: `${Math.min(100, wageBudgetUsagePercent)}%` }}
                    />
                  </div>
                )}
              </div>
              <div className="min-w-[60px] rounded-lg bg-muted/30 px-3 py-2 text-center">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  {t("transfers.listed")}
                </p>
                <p className="font-heading text-lg font-bold tabular-nums text-foreground">
                  {myTransferList.length + myLoanList.length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs
        value={view}
        onValueChange={(v) => setView(v as TransferTabView)}
        className="shrink-0"
      >
        <TabsList>
          {TABS.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id} className="gap-1.5">
              {tab.icon}
              <span className="hidden sm:inline">{t(tab.labelKey)}</span>
              <span className="font-heading text-[10px] tabular-nums text-muted-foreground">
                ({tabCounts[tab.id]})
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <div className="relative h-8 min-w-40 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("transfers.searchByName")}
            className="h-full w-full rounded-md border border-border bg-muted/30 pl-8 pr-8 text-xs text-foreground placeholder:text-muted-foreground/50"
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 rounded bg-muted px-1 py-0.5 font-heading text-[10px] tabular-nums text-muted-foreground">
            {filteredList.length}
          </span>
        </div>
        <select
          value={competitionFilter ?? ""}
          onChange={(e) => setCompetitionFilter(e.target.value || null)}
          className="h-8 rounded-md border border-border bg-card pl-2 pr-8 text-xs font-heading font-bold uppercase tracking-wider text-muted-foreground"
        >
          <option value="">{t("common.all")}</option>
          {leagueOptions.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
        <div className="flex gap-1">
          {POSITIONS.map((pos) => (
            <button
              key={pos}
              onClick={() => setPosFilter(posFilter === pos ? null : pos)}
              className={cn(
                "flex size-8 items-center justify-center rounded-md border transition-colors",
                posFilter === pos
                  ? "border-primary bg-primary/10"
                  : "border-border bg-card text-muted-foreground hover:border-muted-foreground/50",
              )}
              title={pos}
            >
              <img src={ROLE_ICON_PATHS[pos]} alt={pos} className="size-4 object-contain" />
            </button>
          ))}
        </div>
      </div>

      {/* Table / Empty states */}
      {view === "my_list" && filteredList.length === 0 ? (
        renderEmptyState(
          <ShoppingCart className="size-12" />,
          t("transfers.noPlayersListed"),
          <button
            onClick={() => setView("market")}
            className="rounded-md border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-heading uppercase tracking-wider text-primary transition-all hover:bg-primary/20"
          >
            <TrendingUp className="mr-1 inline size-3" /> {t("transfers.browseMarket")}
          </button>,
        )
      ) : view === "offers" && filteredList.length === 0 ? (
        renderEmptyState(<Handshake className="size-12" />, t("transfers.noOffers"))
      ) : (view === "market" || view === "erl" || view === "loans") && filteredList.length === 0 ? (
        renderEmptyState(
          <TrendingUp className="size-12" />,
          view === "market"
            ? t("transfers.noTransferMarket")
            : view === "erl"
              ? t("transfers.noErlMarket", "Sin jugadores ERL disponibles para fichar.")
              : t("transfers.noLoanMarket"),
        )
      ) : (
        <Card className="flex min-h-0 flex-1 flex-col">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 cursor-pointer select-none text-center" onClick={() => toggleSort("position")}>
                    <span className="inline-flex items-center gap-1">{t("common.position")}{renderSortIcon("position")}</span>
                  </TableHead>
                  <TableHead className="w-44 cursor-pointer select-none" onClick={() => toggleSort("name")}>
                    <span className="inline-flex items-center gap-1">{t("common.player")}{renderSortIcon("name")}</span>
                  </TableHead>
                  <TableHead className="w-20 cursor-pointer select-none text-center" onClick={() => toggleSort("nationality")}>
                    <span className="inline-flex items-center gap-1 justify-center">{t("common.nationality")}{renderSortIcon("nationality")}</span>
                  </TableHead>
                  <TableHead className="w-20 cursor-pointer select-none text-right" onClick={() => toggleSort("soloq")}>
                    <span className="inline-flex items-center gap-1 justify-end">{t("common.soloq")}{renderSortIcon("soloq")}</span>
                  </TableHead>
                  <TableHead className="w-14 cursor-pointer select-none text-right" onClick={() => toggleSort("age")}>
                    <span className="inline-flex items-center gap-1 justify-end">{t("common.age")}{renderSortIcon("age")}</span>
                  </TableHead>
                  <TableHead className="w-40 cursor-pointer select-none" onClick={() => toggleSort("team")}>
                    <span className="inline-flex items-center gap-1">{t("common.team")}{renderSortIcon("team")}</span>
                  </TableHead>
                  <TableHead className="w-24 cursor-pointer select-none text-right" onClick={() => toggleSort("value")}>
                    <span className="inline-flex items-center gap-1 justify-end">{t("common.value")}{renderSortIcon("value")}</span>
                  </TableHead>
                  <TableHead className="w-24 cursor-pointer select-none text-right" onClick={() => toggleSort("wage")}>
                    <span className="inline-flex items-center gap-1 justify-end">{t("common.wage")}{renderSortIcon("wage")}</span>
                  </TableHead>
                  <TableHead className="w-16 cursor-pointer select-none text-center" onClick={() => toggleSort("ovr")}>
                    <span className="inline-flex items-center gap-1 justify-center">{t("common.ovr")}{renderSortIcon("ovr")}</span>
                  </TableHead>
                  <TableHead className="w-24 cursor-pointer select-none text-center" onClick={() => toggleSort("status")}>
                    <span className="inline-flex items-center gap-1 justify-center">{t("common.status")}{renderSortIcon("status")}</span>
                  </TableHead>
                  {view === "offers" && (
                    <TableHead className="w-40 text-center">{t("transfers.offers")}</TableHead>
                  )}
                  {(view === "market" || view === "erl" || view === "loans") && (
                    <TableHead className="w-24 text-center">{t("common.actions")}</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedList.map((player) => {
                  const ovr = calculateLolOvr(player);
                  const age = calcAge(player.date_of_birth, gameState.clock.current_date);
                  const lolRole = resolvePlayerCurrentLolRole(player, myTeam ?? null);
                  const photo = resolvePlayerPhoto(player.id, player.match_name, player.profile_image_url);
                  const offersForThisPlayer = player.transfer_offers;

                  return (
                    <TableRow
                      key={player.id}
                      onClick={() => onSelectPlayer(player.id)}
                      className="cursor-pointer"
                    >
                      <TableCell className="text-center">
                        <img
                          src={ROLE_ICON_PATHS[lolRole as keyof typeof ROLE_ICON_PATHS] ?? ROLE_ICON_PATHS.TOP}
                          alt={lolRole}
                          className="size-5 object-contain mx-auto"
                          title={lolRole}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <img
                            src={photo ?? "/default/defaultplayer.webp"}
                            alt={player.match_name}
                            className="size-8 rounded-full bg-muted object-cover shrink-0"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              if (target.src.endsWith("defaultplayer.webp")) return;
                              target.src = "/default/defaultplayer.webp";
                            }}
                          />
                          <span className="text-sm font-semibold text-foreground truncate">{player.match_name || player.full_name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-left">
                        <div className="flex items-center gap-1.5">
                          <CountryFlag code={player.nationality} locale={i18n.language} className="text-xs leading-none" />
                          <span className="text-xs text-muted-foreground truncate">{countryName(player.nationality, i18n.language)}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {player.soloq_lp ? (
                          <div className="flex items-center justify-end gap-2">
                            <span className="tabular-nums text-xs text-muted-foreground">
                              {Math.round(player.soloq_lp).toLocaleString()} LP
                            </span>
                            <img
                              src={soloqTierImage(player.soloq_lp)}
                              alt=""
                              className="size-7 object-contain"
                              loading="lazy"
                            />
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-2">
                            <span className="text-xs text-muted-foreground">—</span>
                            <img
                              src="/ladder-icons/unranked.webp"
                              alt=""
                              className="size-7 object-contain opacity-50"
                              loading="lazy"
                            />
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm text-muted-foreground">{age}</TableCell>
                      <TableCell>
                        {player.team_id ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); onSelectTeam(player.team_id!); }}
                            className="text-left text-sm font-medium text-foreground transition-colors hover:text-primary truncate block max-w-[140px]"
                          >
                            {getTeamName(gameState.teams, player.team_id!)}
                          </button>
                        ) : (
                          <span className="text-sm italic text-muted-foreground/60">{t("common.freeAgent")}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                        {formatVal(player.market_value)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                        {formatVal(player.wage)}/yr
                      </TableCell>
                      <TableCell className="text-center">
                        <span
                          className={cn(
                            "font-heading text-base font-bold tabular-nums",
                            ovr >= 75 ? "text-primary" : ovr >= 55 ? "text-amber-400" : "text-muted-foreground",
                          )}
                        >
                          {ovr}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex flex-wrap justify-center gap-1">
                          {player.transfer_listed && (
                            <Badge variant="secondary" className="text-[10px]">
                              {t("transfers.transfer")}
                            </Badge>
                          )}
                          {player.loan_listed && (
                            <Badge variant="outline" className="text-[10px]">
                              {t("transfers.loan")}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      {(view === "market" || view === "erl" || view === "loans") && (
                        <TableCell className="text-center">
                          <button
                            onClick={(e) => { e.stopPropagation(); openBidNegotiation(player); }}
                            className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-heading font-bold uppercase tracking-wider text-primary-foreground transition-all hover:bg-primary/90"
                          >
                            <Gavel className="size-3" /> {t("transfers.bid")}
                          </button>
                        </TableCell>
                      )}
                      {view === "offers" && (
                        <TableCell>
                          {offersForThisPlayer.length === 0 ? (
                            <span className="text-xs text-muted-foreground">{t("transfers.none")}</span>
                          ) : (
                            <div className="flex flex-col gap-1">
                              {offersForThisPlayer.map((offer) => (
                                <div key={offer.id} className="flex flex-wrap items-center gap-1">
                                  <span className="text-xs text-foreground">
                                    {getTeamName(gameState.teams, offer.from_team_id)}
                                  </span>
                                  <Badge
                                    variant={
                                      offer.status === "Pending" ? "default"
                                      : offer.status === "Accepted" ? "secondary"
                                      : "outline"
                                    }
                                    className="text-[10px]"
                                  >
                                    {formatVal(offer.fee)}
                                  </Badge>
                                  {offer.status === "Pending" && player.team_id === userTeamId && (
                                    <div className="flex gap-0.5">
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleRespondOffer(player.id, offer.id, true); }}
                                        className="flex size-5 items-center justify-center rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"
                                        title={t("transfers.acceptOffer")}
                                      >
                                        <Check className="size-3" />
                                      </button>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleRespondOffer(player.id, offer.id, false); }}
                                        className="flex size-5 items-center justify-center rounded bg-red-500/20 text-red-400 hover:bg-red-500/30"
                                        title={t("transfers.rejectOffer")}
                                      >
                                        <X className="size-3" />
                                      </button>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); openCounterNegotiation(player, offer); }}
                                        className="flex items-center gap-0.5 rounded bg-amber-500/20 px-1.5 text-[10px] text-amber-400 hover:bg-amber-500/30"
                                        title={t("transfers.counterOffer")}
                                      >
                                        <Gavel className="size-2.5" /> {t("transfers.counter")}
                                      </button>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-border px-4 py-3">
              <span className="text-[10px] text-muted-foreground">
                {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, filteredList.length)} / {filteredList.length}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={safePage === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  className="inline-flex size-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"
                >
                  <ChevronLeft className="size-3.5" />
                </button>
                <span className="font-heading text-xs tabular-nums text-muted-foreground">
                  {safePage + 1}/{totalPages}
                </span>
                <button
                  type="button"
                  disabled={safePage >= totalPages - 1}
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  className="inline-flex size-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"
                >
                  <ChevronRight className="size-3.5" />
                </button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* ─── Modals ─── */}
      {bidTarget && (
        <TransferBidDialog
          bidTarget={bidTarget}
          teams={gameState.teams}
          currentDate={gameState.clock.current_date}
          bidAmount={bidAmount}
          onBidAmountChange={setBidAmount}
          destination={bidDestination}
          onDestinationChange={setBidDestination}
          academyTeam={academyTeam}
          myTeam={myTeam ?? null}
          bidFee={bidFee}
          bidProjection={bidProjection}
          bidFeedback={bidFeedback}
          activeBidOffer={activeBidOffer}
          hasExistingOffer={activeBidOffer !== null}
          userPlayers={userPlayersForBid}
          selectedPlayerIds={bidSelectedPlayerIds}
          onSelectedPlayersChange={setBidSelectedPlayerIds}
          bidResult={bidResult}
          bidLoading={bidLoading}
          bidSubmitDisabled={bidSubmitDisabled}
          onSubmit={handleMakeBid}
          onClose={() => {
            setBidTarget(null);
            setBidFeedback(null);
            setBidResult(null);
            setBidProjection(null);
            setBidSelectedPlayerIds([]);
            setBidError(null);
          }}
          isFreeAgent={!bidTarget.team_id}
          bidError={bidError}
        />
      )}
      {counterTarget && (
        <TransferCounterOfferDialog
          counterTarget={counterTarget}
          teams={gameState.teams}
          currentDate={gameState.clock.current_date}
          counterAmount={counterAmount}
          onCounterAmountChange={setCounterAmount}
          counterFeedback={counterFeedback}
          activeCounterOffer={activeCounterOffer}
          counterResult={counterResult}
          counterError={counterError}
          counterLoading={counterLoading}
          userPlayers={userPlayersForCounter}
          selectedPlayerIds={selectedPlayerIds}
          onSelectedPlayersChange={setSelectedPlayerIds}
          onSubmit={handleCounterOffer}
          onClose={() => {
            setCounterTarget(null);
            setCounterAmount("");
            setCounterError(null);
            setCounterResult(null);
            setCounterFeedback(null);
            setSelectedPlayerIds([]);
          }}
        />
      )}
      {wageTarget && (
        <WageNegotiationDialog
          target={wageTarget}
          teams={gameState.teams}
          wageAmount={wageAmount}
          onWageAmountChange={setWageAmount}
          contractYears={contractYears}
          onContractYearsChange={setContractYears}
          feedback={wageFeedback}
          activeOffer={activeWageOffer}
          result={wageResult}
          error={wageError}
          loading={wageLoading}
          onSubmit={handleWageNegotiation}
          onClose={() => {
            setWageTarget(null);
            setWageAmount("");
            setWageResult(null);
            setWageFeedback(null);
            setWageError(null);
          }}
          annualWageBudget={myTeam ? myTeam.wage_budget : 0}
        />
      )}
    </div>
  );
}
