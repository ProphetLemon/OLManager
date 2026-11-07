import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getContractRiskLevel, formatVal } from "@/lib/common/helpers";
import { parseUtcDate } from "@/lib/formatting/dateFormatting";
import { calculateLolOvr } from "@/lib/players/lolPlayerStats";
import { PlayerData, GameStateData, PlayerMatchHistoryEntryData, ScoutReportData, ChampionMasteryEntryData } from "@/store/gameStore";

import { useTranslation } from "react-i18next";
import { resolveBackendText } from "@/lib/i18n/backendI18n";
import { resolveSeasonContext } from "@/lib/season/seasonContext";
import DashboardModalFrame from "@/ui-v2/_legacy/components/dashboard/DashboardModalFrame";
import { Button } from "@/ui-v2/_legacy/components/ui";
import {
  getPlayerAge,
  getPlayerTeamName,
} from "@/ui-v2/_legacy/components/playerProfile/PlayerProfile.helpers";
import { buildPlayerAttributeGroups } from "@/ui-v2/_legacy/components/playerProfile/PlayerProfile.attributes";
import PlayerProfileAttributesCardV2 from "@/ui-v2/pages/PlayerProfileAttributesCardV2";
import PlayerProfileContractCard from "@/ui-v2/_legacy/components/playerProfile/PlayerProfileContractCard";
import PlayerProfileHeroCardV2 from "@/ui-v2/pages/PlayerProfileHeroCardV2";
import PlayerProfileRenewalModal from "@/ui-v2/_legacy/components/playerProfile/PlayerProfileRenewalModal";
import {
  type DelegatedRenewalCaseData,
  type DelegatedRenewalResponseData,
  type NegotiationFeedbackData,
  getRenewalStatusClassName,
  getRenewalStatusMessage,
  type RenewalProjectionData,
  type RenewalResponseData,
  type RenewalStatus,
  shouldDisableRenewalSubmit,
} from "@/ui-v2/_legacy/components/playerProfile/PlayerProfile.renewal";
import {
  getScoutAvailability,
  type PlayerProfileScoutStatus,
} from "@/ui-v2/_legacy/components/playerProfile/PlayerProfile.scouting";
import PlayerProfileChampionsCard from "@/ui-v2/_legacy/components/playerProfile/PlayerProfileChampionsCard";
import PlayerProfileStatsCard from "@/ui-v2/_legacy/components/playerProfile/PlayerProfileStatsCard";
import PlayerProfileCareerCard from "@/ui-v2/_legacy/components/playerProfile/PlayerProfileCareerCard";
import PlayerProfileMatchHistoryCard from "@/ui-v2/_legacy/components/playerProfile/PlayerProfileMatchHistoryCard";
import championsSeed from "../../../../../assets/simulation/champions.json";
import NegotiationFeedbackPanel from "@/ui-v2/_legacy/components/NegotiationFeedbackPanel";
import TransferNegotiationHistory from "@/ui-v2/_legacy/components/transfers/TransferNegotiationHistory";
import WageNegotiationModal from "@/ui-v2/_legacy/components/transfers/WageNegotiationModal";
import { startPotentialResearch } from "@/services/playerService";
import { demoteMainPlayerToAcademy, promoteAcademyPlayer } from "@/services/academyService";
import { findAcademyTeamForParent } from "@/store/academySelectors";
import { fallbackChampionForRole, resolvePlayerLolRole } from "@/lib/players/lolIdentity";
import { tierFromLp, type SoloQTier } from "@/lib/players/soloq";
import {
  makeTransferBid,
  releasePlayerContract,
  previewTransferBidFinancialImpact,
  negotiatePlayerWage,
  type TransferDestinationData,
  type TransferNegotiationFeedbackData,
  type TransferBidProjectionData,
  type WageNegotiationResponseData,
} from "@/services/transfersService";

type LolRole = "TOP" | "JUNGLE" | "MID" | "ADC" | "SUPPORT";

interface TransferOfferFeedbackState {
  decision: "accepted" | "rejected" | "counter_offer";
  feedback: TransferNegotiationFeedbackData;
}

function getLatestScoutReportForPlayer(
  gameState: GameStateData,
  playerId: string,
): ScoutReportData | null {
  return gameState.messages
    .filter((message) => message.context?.scout_report?.player_id === playerId)
    .sort((left, right) => right.date.localeCompare(left.date))[0]
    ?.context.scout_report ?? null;
}

interface PlayerSeed {
  ign: string;
  role: string;
  champions: Array<Array<string | number>>;
}

const PLAYER_SEEDS: PlayerSeed[] = [];

const CHAMPION_ALIASES = (
  championsSeed as { data?: { display_aliases?: Record<string, string>; roles?: Record<string, unknown> } }
).data?.display_aliases ?? {};

const CHAMPION_ROLE_KEYS = Object.keys(
  (
    championsSeed as { data?: { roles?: Record<string, unknown> } }
  ).data?.roles ?? {},
);

const CHAMPION_ID_BY_NORMALIZED_NAME = new Map<string, string>([
  ...Object.entries(CHAMPION_ALIASES).map(([alias, id]) => [normalizeKey(alias), id] as const),
  ...CHAMPION_ROLE_KEYS.map((id) => [normalizeKey(id), id] as const),
]);

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function championIdFromName(name: string): string | null {
  const normalized = normalizeKey(name);
  if (!normalized) return null;

  const fromCatalog = CHAMPION_ID_BY_NORMALIZED_NAME.get(normalized);
  if (fromCatalog) return fromCatalog;

  const overrides: Record<string, string> = {
    aurelionsol: "AurelionSol",
    belveth: "Belveth",
    chogath: "Chogath",
    drmundo: "DrMundo",
    jarvaniv: "JarvanIV",
    ksante: "KSante",
    kaisa: "Kaisa",
    khazix: "Khazix",
    kogmaw: "KogMaw",
    leblanc: "Leblanc",
    leesin: "LeeSin",
    monkeyking: "MonkeyKing",
    nunuandwillump: "Nunu",
    reksai: "RekSai",
    tahmkench: "TahmKench",
    twistedfate: "TwistedFate",
    velkoz: "Velkoz",
  };

  if (overrides[normalized]) return overrides[normalized];
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function buildChampionPerformanceMap(
  history: PlayerMatchHistoryEntryData[],
): Map<string, { wr: number; games: number }> {
  const bucket = new Map<string, { wins: number; games: number }>();

  history.forEach((entry) => {
    const championId = entry.championId;
    if (!championId) return;

    const current = bucket.get(championId) ?? { wins: 0, games: 0 };
    current.games += 1;
    if (entry.result === "Win") current.wins += 1;
    bucket.set(championId, current);
  });

  return new Map(
    [...bucket.entries()].map(([championId, value]) => [
      championId,
      {
        games: value.games,
        wr: value.games > 0 ? Number(((value.wins / value.games) * 100).toFixed(1)) : 0,
      },
    ]),
  );
}

export function buildTopChampionMasteries(
  playerId: string,
  matchName: string,
  role: "TOP" | "JUNGLE" | "MID" | "ADC" | "SUPPORT",
  championPerformance: Map<string, { wr: number; games: number }>,
  persistedMasteries: ChampionMasteryEntryData[],
  visibleChampionCount = 4,
) {
  const seed = PLAYER_SEEDS.find((entry) => normalizeKey(entry.ign) === normalizeKey(matchName));
  const championByKey = new Map<string, { championId: string; championName: string; mastery: number; persisted: boolean }>();

  for (const entry of seed?.champions ?? []) {
    const championName = String(entry[0] ?? "");
    const championId = championIdFromName(championName);
    if (!championId) continue;

    championByKey.set(normalizeKey(championId), {
      championId,
      championName,
      mastery: Number(entry[1] ?? 0),
      persisted: false,
    });
  }

  for (const entry of persistedMasteries) {
    if (entry.player_id !== playerId || !entry.champion_id) continue;
    const championId = entry.champion_id;
    championByKey.set(normalizeKey(championId), {
      championId,
      championName: championId,
      mastery: entry.mastery,
      persisted: true,
    });
  }

  const hasHistory = [...championByKey.values()].some(
    (entry) => (championPerformance.get(entry.championId)?.games ?? 0) > 0,
  );
  const gamesOf = (championId: string) => championPerformance.get(championId)?.games ?? 0;
  const champions = [...championByKey.values()].sort((a, b) =>
    hasHistory
      ? gamesOf(b.championId) - gamesOf(a.championId) || b.mastery - a.mastery
      : b.mastery - a.mastery,
  );

  if (champions.length === 0) {
    const fallbackChampion = fallbackChampionForRole(playerId, role);
    if (!fallbackChampion) return [];
    return [
      {
        championId: fallbackChampion,
        championName: fallbackChampion,
        mastery: 100,
        rank: "insignia" as const,
        wr: championPerformance.get(fallbackChampion)?.wr ?? 0,
        games: championPerformance.get(fallbackChampion)?.games ?? 0,
      },
    ];
  }

  const insignia = champions[0];
  const rest = champions.slice(1, Math.max(1, visibleChampionCount));

  return [
    {
      championId: insignia.championId,
      championName: insignia.championName,
      mastery: insignia.persisted ? insignia.mastery : Math.max(100, insignia.mastery),
      rank: "insignia" as const,
      wr: championPerformance.get(insignia.championId)?.wr ?? 0,
      games: championPerformance.get(insignia.championId)?.games ?? 0,
    },
    ...rest
      .map((entry, idx) => {
        return {
          championId: entry.championId,
          championName: entry.championName,
          mastery: entry.mastery,
          rank: (idx + 1) as 1 | 2 | 3,
          wr: championPerformance.get(entry.championId)?.wr ?? 0,
          games: championPerformance.get(entry.championId)?.games ?? 0,
        };
      })
      .filter(
        (entry): entry is {
          championId: string;
          championName: string;
          mastery: number;
          rank: 1 | 2 | 3;
          wr: number;
          games: number;
        } => entry !== null,
      ),
  ];
}

interface PlayerProfileProps {
  player: PlayerData;
  gameState: GameStateData;
  isOwnClub: boolean;
  startWithRenewalModal?: boolean;
  onClose: () => void;
  onSelectTeam?: (id: string) => void;
  onGameUpdate?: (g: GameStateData) => void;
  onViewChampion?: (championKey: string) => void;
}

export default function PlayerProfile({
  player,
  gameState,
  startWithRenewalModal = false,
  onClose,
  onSelectTeam,
  onGameUpdate,
  onViewChampion,
}: PlayerProfileProps) {
  const { t, i18n } = useTranslation();
  const annualSuffix = t("finances.perYearSuffix", "/yr");

  if (!player) {
    return null;
  }

  const primaryRole = resolvePlayerLolRole(player);

  const [scoutStatus, setScoutStatus] = useState<PlayerProfileScoutStatus>(
    "idle",
  );
  const [academyActionSubmitting, setAcademyActionSubmitting] = useState(false);
  const [playerHistory, setPlayerHistory] = useState<PlayerMatchHistoryEntryData[]>([]);
  const [rerollingRole, setRerollingRole] = useState(false);
  const [potentialResearchSubmitting, setPotentialResearchSubmitting] = useState(false);
  const [scoutError, setScoutError] = useState<string | null>(null);
  const [showRenewalModal, setShowRenewalModal] = useState(false);
  const [showReleaseContractModal, setShowReleaseContractModal] = useState(false);
  const [releaseContractError, setReleaseContractError] = useState<string | null>(null);
  const [showTransferOfferModal, setShowTransferOfferModal] = useState(false);
  const [transferActionSubmitting, setTransferActionSubmitting] = useState(false);
  const [transferOfferAmount, setTransferOfferAmount] = useState("");
  const [transferOfferDestination, setTransferOfferDestination] =
    useState<TransferDestinationData>("main");
  const [transferOfferError, setTransferOfferError] = useState<string | null>(null);
  const [transferOfferFeedback, setTransferOfferFeedback] =
    useState<TransferOfferFeedbackState | null>(null);
  const [transferOfferIncludedPlayerIds, setTransferOfferIncludedPlayerIds] =
    useState<string[]>([]);
  const [transferOfferProjection, setTransferOfferProjection] =
    useState<TransferBidProjectionData["projection"] | null>(null);
  const [transferOfferFee, setTransferOfferFee] = useState<number | null>(null);

  const [showWageModal, setShowWageModal] = useState(false);
  const [wageNegotiationTarget, setWageNegotiationTarget] = useState<{
    player: PlayerData;
    offerId: string;
    fromTeamId: string | null;
    fee: number;
    destinationTeamId: string;
  } | null>(null);
  const [wageNegotiationAmount, setWageNegotiationAmount] = useState("");
  const [wageNegotiationYears, setWageNegotiationYears] = useState(3);
  const [wageNegotiationLoading, setWageNegotiationLoading] = useState(false);
  const [wageNegotiationResult, setWageNegotiationResult] = useState<
    WageNegotiationResponseData["decision"] | "error" | null
  >(null);
  const [wageNegotiationFeedback, setWageNegotiationFeedback] =
    useState<TransferNegotiationFeedbackData | null>(null);
  const [wageNegotiationError, setWageNegotiationError] = useState<string | null>(null);

  const [renewalWage, setRenewalWage] = useState("");
  const [renewalLength, setRenewalLength] = useState("2");
  const [renewalSubmitting, setRenewalSubmitting] = useState(false);
  const [renewalStatus, setRenewalStatus] = useState<RenewalStatus>("idle");
  const [renewalError, setRenewalError] = useState<string | null>(null);
  const [renewalSuggestedWage, setRenewalSuggestedWage] = useState<
    number | null
  >(null);
  const [renewalSuggestedYears, setRenewalSuggestedYears] = useState<
    number | null
  >(null);
  const [renewalSessionStatus, setRenewalSessionStatus] =
    useState<RenewalResponseData["session_status"]>("idle");
  const [renewalIsTerminal, setRenewalIsTerminal] = useState(false);
  const [renewalCooledOff, setRenewalCooledOff] = useState(false);
  const [renewalFeedback, setRenewalFeedback] =
    useState<NegotiationFeedbackData | null>(null);
  const [renewalProjection, setRenewalProjection] =
    useState<RenewalProjectionData["projection"] | null>(null);
  const [hasConsumedInitialRenewalIntent, setHasConsumedInitialRenewalIntent] =
    useState(false);
  const ovr = calculateLolOvr(player);
  const age = getPlayerAge(player.date_of_birth, gameState.clock.current_date);
  const playerTeam = gameState.teams.find((t) => t.id === player.team_id);
  const teamLogoUrl = playerTeam?.logo_url ?? null;
  const teamName = getPlayerTeamName(
    gameState.teams,
    player.team_id,
    {
      freeAgent: t("common.freeAgent"),
      unknown: t("common.unknown"),
    },
  );
  const soloqTier: SoloQTier = tierFromLp(player.soloq_lp);
  const managerTeamId = gameState.manager.team_id;
  const managerTeam = gameState.teams.find((t) => t.id === managerTeamId) ?? null;
  const managerAcademyTeam = findAcademyTeamForParent(gameState.teams, managerTeamId);
  const managedTeamIds = new Set<string>();
  if (managerTeamId) {
    managedTeamIds.add(managerTeamId);
    const parentAcademyId = gameState.teams.find((team) => team.id === managerTeamId)?.academy_team_id;
    gameState.teams.forEach((team) => {
      if (team.team_kind !== "Academy") return;
      if (team.parent_team_id === managerTeamId || (parentAcademyId && team.id === parentAcademyId)) {
        managedTeamIds.add(team.id);
      }
    });
  }

  const isOwnMainPlayer = managerTeamId !== null && player.team_id === managerTeamId;
  const isOwnAcademyPlayer = player.team_id !== null && managedTeamIds.has(player.team_id) && !isOwnMainPlayer;
  const actualIsOwnClub = isOwnMainPlayer || isOwnAcademyPlayer;
  const seasonContext = resolveSeasonContext(gameState);
  const isTransferWindowOpen =
    seasonContext.transfer_window.status === "Open" ||
    seasonContext.transfer_window.status === "DeadlineDay";
  const releasePenaltyPreview = (() => {
    if (!player.contract_end) {
      return 0;
    }

    const currentDate = parseUtcDate(gameState.clock.current_date);
    const contractEndDate = parseUtcDate(player.contract_end);
    if (!currentDate || !contractEndDate) {
      return 0;
    }

    const msPerDay = 24 * 60 * 60 * 1000;
    const daysRemaining = Math.max(
      0,
      Math.ceil((contractEndDate.getTime() - currentDate.getTime()) / msPerDay),
    );
    const remainingSalary = Math.round((player.wage * daysRemaining) / 365);
    return Math.round(remainingSalary * 0.4);
  })();
  const contractRiskLevel = getContractRiskLevel(
    player.contract_end,
    gameState.clock.current_date,
  );
  const contractRiskLabel =
    contractRiskLevel === "critical"
      ? t("finances.contractRiskCritical")
      : contractRiskLevel === "warning"
        ? t("finances.contractRiskWarning")
        : t("finances.contractRiskStable");
  const renewalOfferedWage = Number(renewalWage);
  const renewalOfferedYears = Number(renewalLength);
  const isRenewalWageValid =
    Number.isFinite(renewalOfferedWage) && renewalOfferedWage > 0;
  const isRenewalLengthValid =
    Number.isInteger(renewalOfferedYears) && renewalOfferedYears > 0;
  const renewalViolatesSoftCap =
    isRenewalWageValid &&
    renewalProjection !== null &&
    !renewalProjection.policy_allows;
  const renewalSubmitDisabled = shouldDisableRenewalSubmit({
    renewalSubmitting,
    renewalIsTerminal,
    isRenewalWageValid,
    isRenewalLengthValid,
    renewalViolatesSoftCap,
  });
  const renewalStatusMessage = getRenewalStatusMessage(
    {
      renewalSessionStatus,
      renewalStatus,
      renewalSuggestedWage,
      renewalSuggestedYears,
      renewalError,
    },
    t,
  );
  const renewalStatusClassName = getRenewalStatusClassName(renewalStatus);
  const scoutAvailability = getScoutAvailability({
    staff: gameState.staff,
    scoutingAssignments: gameState.scouting_assignments || [],
    managerTeamId: gameState.manager.team_id,
    playerId: player.id,
    scoutStatus,
  });
  const latestScoutReport = getLatestScoutReportForPlayer(gameState, player.id) ?? undefined;
  const attrGroups = buildPlayerAttributeGroups(player, t, latestScoutReport);
  const canViewAttributes = true;
  const championPerformance = buildChampionPerformanceMap(playerHistory);
  const visibleChampionMasteryCount = actualIsOwnClub ? 4 : latestScoutReport ? 2 : 1;
  const topChampions = buildTopChampionMasteries(
    player.id,
    player.match_name,
    primaryRole,
    championPerformance,
    gameState.champion_masteries ?? [],
    visibleChampionMasteryCount,
  );
  const activePotentialResearchPlayer = gameState.players.find(
    (candidate) => (candidate.potential_research_eta_days ?? 0) > 0,
  );
  const isPotentialResearchActiveForPlayer = activePotentialResearchPlayer?.id === player.id;
  const isPotentialResearchBlockedByOther =
    Boolean(activePotentialResearchPlayer) && !isPotentialResearchActiveForPlayer;

  useEffect(() => {
    let cancelled = false;

    const loadHistory = async (): Promise<void> => {
      try {
        const history = await invoke<PlayerMatchHistoryEntryData[]>("get_player_match_history", {
          playerId: player.id,
          limit: 500,
        });
        if (!cancelled) setPlayerHistory(Array.isArray(history) ? history : []);
      } catch {
        if (!cancelled) setPlayerHistory([]);
      }
    };

    void loadHistory();

    return () => {
      cancelled = true;
    };
  }, [player.id]);

  async function handleRerollRole(role: LolRole): Promise<void> {
    if (!actualIsOwnClub || !onGameUpdate || rerollingRole) {
      return;
    }

    setRerollingRole(true);
    try {
      const updated = await invoke<GameStateData>("reroll_player_lol_role", {
        playerId: player.id,
        role,
      });
      onGameUpdate(updated);
    } catch {
      return;
    } finally {
      setRerollingRole(false);
    }
  }

  function handleRequestReleaseContract(): void {
    if (!isTransferWindowOpen || !actualIsOwnClub || transferActionSubmitting) {
      return;
    }

    setShowReleaseContractModal(true);
  }

  async function handleConfirmReleaseContract(): Promise<void> {
    if (!onGameUpdate || !actualIsOwnClub || transferActionSubmitting) {
      return;
    }

    setTransferActionSubmitting(true);
    setReleaseContractError(null);
    try {
      const updated = await releasePlayerContract(player.id);
      onGameUpdate(updated);
      setShowReleaseContractModal(false);
      onClose();
    } catch (error) {
      const msg = typeof error === "string"
        ? error
        : error instanceof Error ? error.message : String(error);
      setReleaseContractError(msg);
    } finally {
      setTransferActionSubmitting(false);
    }
  }

  function handleOpenTransferOfferModal(): void {
    if (!onGameUpdate || actualIsOwnClub || transferActionSubmitting || !isTransferWindowOpen) {
      return;
    }

    const initialFee = Math.max(1, Math.round(player.market_value));
    setTransferOfferAmount(String(initialFee));
    setTransferOfferDestination("main");
    setTransferOfferError(null);
    setTransferOfferFeedback(null);
    setTransferOfferIncludedPlayerIds([]);
    setTransferOfferProjection(null);
    setTransferOfferFee(null);
    setShowTransferOfferModal(true);
    void previewTransferBidFinancialImpact(player.id, initialFee, "main")
      .then((res) => {
        setTransferOfferProjection(res.projection);
        setTransferOfferFee(initialFee);
      })
      .catch(() => {});
  }

  async function handleSubmitTransferOffer(): Promise<void> {
    if (!onGameUpdate || actualIsOwnClub || transferActionSubmitting) {
      return;
    }

    const fee = Math.round(Number.parseFloat(transferOfferAmount));
    if (!Number.isFinite(fee) || fee <= 0) {
      setTransferOfferError(
        t("playerProfile.transferOfferInvalid", {
          defaultValue: "Ingresá un monto de oferta valido.",
        }),
      );
      return;
    }

    setTransferOfferError(null);
    setTransferOfferFeedback(null);
    setTransferActionSubmitting(true);
    try {
      const result = await makeTransferBid(player.id, fee, transferOfferDestination, transferOfferIncludedPlayerIds);
      onGameUpdate(result.game);
      setTransferOfferFeedback({
        decision: result.decision,
        feedback: result.feedback,
      });

      if (result.suggested_fee !== null) {
        setTransferOfferAmount(String(Math.round(result.suggested_fee)));
      }

      if (result.decision === "accepted" && !result.is_terminal) {
        const updatedPlayer = result.game.players.find((p: PlayerData) => p.id === player.id);
        const acceptedOffer = updatedPlayer
          ?.transfer_offers.find((o) => o.status === "Accepted" && o.destination_team_id);
        if (updatedPlayer && acceptedOffer && acceptedOffer.destination_team_id) {
          setWageNegotiationTarget({
            player: updatedPlayer,
            offerId: acceptedOffer.id,
            fromTeamId: updatedPlayer.team_id ?? null,
            fee,
            destinationTeamId: acceptedOffer.destination_team_id,
          });
          setWageNegotiationAmount(String(Math.round(updatedPlayer.wage * 1.5)));
          setWageNegotiationYears(acceptedOffer.suggested_counter_years ?? 3);
          setWageNegotiationResult(null);
          setWageNegotiationFeedback(null);
          setWageNegotiationError(null);
          setShowWageModal(true);
        }
        setShowTransferOfferModal(false);
        setTransferOfferIncludedPlayerIds([]);
      } else if (result.decision === "accepted") {
        setShowTransferOfferModal(false);
        setTransferOfferIncludedPlayerIds([]);
      }
    } catch (error) {
      console.error("Failed to make transfer offer:", error);
      const rawError =
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : String(error);

      if (rawError.includes("Transfer budget too low")) {
        setTransferOfferError(
          t("playerProfile.transferOfferBudgetError", {
            defaultValue: "Tu presupuesto de fichajes no alcanza para este monto.",
          }),
        );
      } else if (rawError.includes("Insufficient funds")) {
        setTransferOfferError(
          t("playerProfile.transferOfferFundsError", {
            defaultValue: "No tenes fondos suficientes para esta oferta.",
          }),
        );
      } else if (rawError.includes("Transfer window is closed")) {
        setTransferOfferError(
          t("playerProfile.transferOfferWindowClosed", {
            defaultValue: "El mercado esta cerrado.",
          }),
        );
      } else {
        setTransferOfferError(
          t("playerProfile.transferOfferFailed", {
            defaultValue: "No se pudo enviar la oferta. Probá de nuevo.",
          }),
        );
      }
    } finally {
      setTransferActionSubmitting(false);
    }
  }

  async function handleWageNegotiation(): Promise<void> {
    if (!wageNegotiationTarget || !wageNegotiationAmount) return;

    setWageNegotiationLoading(true);
    setWageNegotiationError(null);
    setWageNegotiationResult(null);
    setWageNegotiationFeedback(null);

    try {
      const annualWage = Math.round(parseFloat(wageNegotiationAmount));
      const result = await negotiatePlayerWage(
        wageNegotiationTarget.player.id,
        wageNegotiationTarget.offerId,
        annualWage,
        wageNegotiationYears,
      );
      onGameUpdate?.(result.game);
      setWageNegotiationResult(result.decision);
      setWageNegotiationFeedback(result.feedback);
      if (result.suggested_wage !== null) {
        setWageNegotiationAmount(String(Math.round(result.suggested_wage)));
      }
      if (result.is_terminal && result.decision === "accepted") {
        setTimeout(() => {
          setShowWageModal(false);
          setWageNegotiationTarget(null);
          setWageNegotiationAmount("");
          setWageNegotiationResult(null);
          setWageNegotiationFeedback(null);
          setWageNegotiationError(null);
        }, 2000);
      }
    } catch (error) {
      console.error("Failed to negotiate wage:", error);
      setWageNegotiationError(
        typeof error === "string" ? error : error instanceof Error ? error.message : String(error),
      );
    } finally {
      setWageNegotiationLoading(false);
    }
  }

  function openRenewalModal(): void {
    setRenewalWage(String(player.wage));
    setRenewalLength("2");
    setRenewalSubmitting(false);
    setRenewalStatus("idle");
    setRenewalError(null);
    setRenewalSuggestedWage(null);
    setRenewalSuggestedYears(null);
    setRenewalSessionStatus("idle");
    setRenewalIsTerminal(false);
    setRenewalCooledOff(false);
    setRenewalFeedback(null);
    setRenewalProjection(null);
    setShowRenewalModal(true);
  }

  function closeRenewalModal(): void {
    if (renewalSubmitting) {
      return;
    }

    setShowRenewalModal(false);
  }

  useEffect(() => {
    setHasConsumedInitialRenewalIntent(false);
  }, [player.id, startWithRenewalModal]);

  useEffect(() => {
    if (
      !actualIsOwnClub ||
      !startWithRenewalModal ||
      showRenewalModal ||
      hasConsumedInitialRenewalIntent
    ) {
      return;
    }

    setHasConsumedInitialRenewalIntent(true);
    openRenewalModal();
  }, [
    hasConsumedInitialRenewalIntent,
    actualIsOwnClub,
    showRenewalModal,
    startWithRenewalModal,
  ]);

  useEffect(() => {
    if (!showRenewalModal || !isRenewalWageValid) {
      setRenewalProjection(null);
      return;
    }

    let cancelled = false;

    const loadProjection = async (): Promise<void> => {
      try {
        const result = await invoke<RenewalProjectionData>(
          "preview_renewal_financial_impact",
          {
            playerId: player.id,
            annualWage: renewalOfferedWage,
          },
        );

        if (!cancelled) {
          setRenewalProjection(result.projection ?? null);
        }
      } catch {
        if (!cancelled) {
          setRenewalProjection(null);
        }
      }
    };

    loadProjection();

    return () => {
      cancelled = true;
    };
  }, [isRenewalWageValid, player.id, renewalOfferedWage, showRenewalModal]);

  async function handleRenewalSubmit(): Promise<void> {
    if (renewalSubmitDisabled) {
      return;
    }

    setRenewalSubmitting(true);
    setRenewalStatus("idle");
    setRenewalError(null);
    setRenewalCooledOff(false);

    try {
      const result = await invoke<RenewalResponseData>("propose_renewal", {
        playerId: player.id,
        annualWage: renewalOfferedWage,
        contractYears: renewalOfferedYears,
      });

      onGameUpdate?.(result.game);
      setRenewalStatus(result.outcome);
      setRenewalSuggestedWage(result.suggested_wage);
      setRenewalSuggestedYears(result.suggested_years);
      setRenewalSessionStatus(result.session_status);
      setRenewalIsTerminal(result.is_terminal);
      setRenewalCooledOff(result.cooled_off ?? false);
      setRenewalFeedback(result.feedback ?? null);

      if (result.session_status === "blocked") {
        setRenewalStatus("blocked");
      }

      if (result.outcome === "counter_offer") {
        if (result.suggested_wage !== null) {
          setRenewalWage(String(result.suggested_wage));
        }

        if (result.suggested_years !== null) {
          setRenewalLength(String(result.suggested_years));
        }
      }
    } catch (error) {
      setRenewalStatus("error");
      setRenewalError(String(error));
      setRenewalCooledOff(false);
    } finally {
      setRenewalSubmitting(false);
    }
  }

  async function handleDelegateRenewal(): Promise<void> {
    if (renewalSubmitting) {
      return;
    }

    setRenewalSubmitting(true);
    setRenewalError(null);
    setRenewalCooledOff(false);

    try {
      const result = await invoke<DelegatedRenewalResponseData>(
        "delegate_renewals",
        {
          playerIds: [player.id],
          maxWageIncreasePct: 35,
          maxContractYears: 3,
        },
      );

      onGameUpdate?.(result.game);
      const delegatedCase: DelegatedRenewalCaseData | undefined =
        result.report.cases.find(
          (renewalCase) => renewalCase.player_id === player.id,
        );

      if (!delegatedCase) {
        setRenewalStatus("error");
        setRenewalError(t("playerProfile.renewalDelegateMissingReport"));
        return;
      }

      if (delegatedCase.status === "successful") {
        setRenewalStatus("accepted");
        setRenewalSessionStatus("agreed");
        setRenewalIsTerminal(true);
        setRenewalSuggestedWage(null);
        setRenewalSuggestedYears(null);
        setRenewalCooledOff(false);
        setRenewalFeedback(null);
        return;
      }

      if (delegatedCase.status === "stalled") {
        setRenewalStatus("rejected");
        setRenewalSessionStatus("stalled");
        setRenewalIsTerminal(false);
        setRenewalCooledOff(false);
        setRenewalFeedback(null);
        setRenewalError(
          resolveBackendText(
            delegatedCase.note_key,
            delegatedCase.note,
            delegatedCase.note_params,
          ),
        );
        return;
      }

      setRenewalStatus("blocked");
      setRenewalSessionStatus("blocked");
      setRenewalIsTerminal(true);
      setRenewalCooledOff(false);
      setRenewalFeedback(null);
      setRenewalError(
        resolveBackendText(
          delegatedCase.note_key,
          delegatedCase.note,
          delegatedCase.note_params,
        ),
      );
    } catch (error) {
      setRenewalStatus("error");
      setRenewalError(String(error));
      setRenewalCooledOff(false);
    } finally {
      setRenewalSubmitting(false);
    }
  }

  return (
    <div className="w-[92%] max-w-[2000px] mx-auto">
      <PlayerProfileHeroCardV2
        player={player}
        ovr={ovr}
        primaryRole={primaryRole}
        age={age}
        teamName={teamName}
        teamLogoUrl={teamLogoUrl}
        annualSuffix={annualSuffix}
        language={i18n.language}
        isOwnClub={actualIsOwnClub || !onGameUpdate}
        soloqTier={soloqTier}
        scoutAvailability={scoutAvailability}
        scoutStatus={scoutStatus}
        scoutError={scoutError}
        onScout={() => {
          const availableScout = scoutAvailability.availableScout;
          if (!availableScout || !onGameUpdate) {
            return;
          }

          void (async () => {
            setScoutStatus("sending");
            setScoutError(null);

            try {
              const updated = await invoke<GameStateData>("send_scout", {
                scoutId: availableScout.id,
                playerId: player.id,
              });
              onGameUpdate(updated);
              setScoutStatus("sent");
            } catch (err) {
              setScoutError(String(err));
              setScoutStatus("error");
            }
          })();
        }}
        onRerollRole={(role) => {
          void handleRerollRole(role);
        }}
        rerollingRole={rerollingRole}
        insigniaChampionId={topChampions[0]?.championId ?? null}
        onSelectTeam={onSelectTeam}
        academyActionLabel={
          isOwnAcademyPlayer
            ? t("playerProfile.promoteToMain")
            : isOwnMainPlayer && managerAcademyTeam
              ? t("playerProfile.demoteToAcademy")
              : null
        }
        academyActionLoading={academyActionSubmitting}
        onAcademyAction={
          isOwnAcademyPlayer || (isOwnMainPlayer && managerAcademyTeam)
            ? () => {
                if (!onGameUpdate || academyActionSubmitting) {
                  return;
                }

                void (async () => {
                  setAcademyActionSubmitting(true);
                  try {
                    const updated = isOwnAcademyPlayer
                      ? await promoteAcademyPlayer(player.id)
                      : await demoteMainPlayerToAcademy(player.id);
                    onGameUpdate(updated);
                  } catch {
                    return;
                  } finally {
                    setAcademyActionSubmitting(false);
                  }
                })();
              }
            : null
        }
        onStartPotentialResearch={
          onGameUpdate
            ? () => {
                if (potentialResearchSubmitting) {
                  return;
                }

                void (async () => {
                  setPotentialResearchSubmitting(true);
                  try {
                    const updated = await startPotentialResearch(player.id);
                    onGameUpdate(updated);
                  } catch {
                    return;
                  } finally {
                    setPotentialResearchSubmitting(false);
                  }
                })();
              }
            : undefined
        }
        potentialResearchSubmitting={potentialResearchSubmitting}
        isPotentialResearchBlockedByOther={isPotentialResearchBlockedByOther}
        onToggleTransferList={
          onGameUpdate && actualIsOwnClub
            ? () => {
                void (async () => {
                  try {
                    const updated = await invoke<GameStateData>("toggle_transfer_list", { playerId: player.id });
                    onGameUpdate(updated);
                  } catch { /* silent */ }
                })();
              }
            : undefined
        }
        onToggleLoanList={
          onGameUpdate && actualIsOwnClub
            ? () => {
                void (async () => {
                  try {
                    const updated = await invoke<GameStateData>("toggle_loan_list", { playerId: player.id });
                    onGameUpdate(updated);
                  } catch { /* silent */ }
                })();
              }
            : undefined
        }
        t={t}
      />

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <PlayerProfileContractCard
          dateOfBirth={player.date_of_birth}
          contractEnd={player.contract_end}
          currentDate={gameState.clock.current_date}
          condition={player.condition}
          fitness={player.fitness ?? 75}
          morale={player.morale}
          marketValue={player.market_value}
          wage={player.wage}
          annualSuffix={annualSuffix}
          language={i18n.language}
          contractRiskLevel={contractRiskLevel}
          contractRiskLabel={contractRiskLabel}
          isOwnClub={actualIsOwnClub}
          isTransferWindowOpen={isTransferWindowOpen}
          transferActionSubmitting={transferActionSubmitting}
          onOpenRenewal={openRenewalModal}
          onReleaseContract={handleRequestReleaseContract}
          onOpenTransferBid={handleOpenTransferOfferModal}
          t={t}
        />

        <div className="lg:col-span-2 flex flex-col gap-5">
          <PlayerProfileAttributesCardV2
            attrGroups={attrGroups}
            canViewAttributes={canViewAttributes}
            title={t("playerProfile.attributes")}
            averageLabel={t("common.average")}
            hiddenTitle={t("playerProfile.attributesHidden")}
            hiddenBody={t("playerProfile.scoutToView")}
          />

          {topChampions.length > 0 ? (
            <PlayerProfileChampionsCard champions={topChampions} onViewChampion={onViewChampion} />
          ) : null}
        </div>

      </div>

      {/* ── Extra info cards ─────────────────────────────── */}
      <div className="mt-5 space-y-5">
        {/* Traits */}
        {player.traits && player.traits.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-5">
            <h4 className="mb-3 font-heading text-sm font-bold uppercase tracking-wider text-muted-foreground">
              {t("playerProfile.traits", { defaultValue: "Rasgos" })}
            </h4>
            <div className="flex flex-wrap gap-2">
              {player.traits.map((trait) => (
                <span
                  key={trait}
                  className="rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-foreground/80"
                >
                  {trait}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Season stats */}
        {player.stats && (
          <PlayerProfileStatsCard stats={player.stats} t={t} />
        )}

        {/* Career history */}
        {player.career && player.career.length > 0 && (
          <PlayerProfileCareerCard career={player.career} gameState={gameState} t={t} />
        )}

        {/* Match history */}
        {playerHistory.length > 0 && (
          <PlayerProfileMatchHistoryCard
            history={playerHistory}
            gameState={gameState}
            t={t}
            language={i18n.language}
          />
        )}
      </div>

      <PlayerProfileRenewalModal
        show={showRenewalModal}
        playerName={player.full_name}
        t={t}
        annualSuffix={annualSuffix}
        renewalWage={renewalWage}
        renewalLength={renewalLength}
        renewalIsTerminal={renewalIsTerminal}
        isRenewalWageValid={isRenewalWageValid}
        renewalViolatesSoftCap={renewalViolatesSoftCap}
        renewalProjection={renewalProjection}
        renewalStatusMessage={renewalStatusMessage}
        renewalStatusClassName={renewalStatusClassName}
        renewalCooledOff={renewalCooledOff}
        renewalFeedback={renewalFeedback}
        renewalSubmitting={renewalSubmitting}
        renewalSubmitDisabled={renewalSubmitDisabled}
        onWageChange={setRenewalWage}
        onLengthChange={setRenewalLength}
        onClose={closeRenewalModal}
        onDelegate={() => void handleDelegateRenewal()}
        onSubmit={() => void handleRenewalSubmit()}
      />

      {showReleaseContractModal ? (
        <DashboardModalFrame maxWidthClassName="max-w-md">
          <div className="space-y-4">
            <h3 className="text-lg font-heading font-bold uppercase tracking-wider text-foreground">
              {t("playerProfile.releaseContract")}
            </h3>
            <p className="text-sm text-foreground/70">
              {t("playerProfile.releaseContractConfirm")}
            </p>
            {releaseContractError ? (
              <p className="rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                {releaseContractError}
              </p>
            ) : null}
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <p className="text-xs font-heading font-bold uppercase tracking-wider text-muted-foreground">
                {t("playerProfile.releasePenalty", { defaultValue: "Termination cost" })}
              </p>
              <p className="text-sm font-semibold text-red-500 mt-1">
                {formatVal(releasePenaltyPreview)}
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="ghost"
                onClick={() => { setShowReleaseContractModal(false); setReleaseContractError(null); }}
                disabled={transferActionSubmitting}
              >
                {t("common.cancel")}
              </Button>
              <Button
                variant="primary"
                className="bg-red-600 hover:bg-red-700 active:bg-red-800"
                onClick={() => void handleConfirmReleaseContract()}
                disabled={transferActionSubmitting}
              >
                {t("playerProfile.releaseContract")}
              </Button>
            </div>
          </div>
        </DashboardModalFrame>
      ) : null}

      {showTransferOfferModal ? (
        <DashboardModalFrame maxWidthClassName="max-w-md">
          <div className="space-y-4">
            <h3 className="text-sm font-heading font-bold uppercase tracking-wider text-muted-foreground">
              {t("playerProfile.makeTransferOffer", { defaultValue: "Make Transfer Offer" })}
            </h3>
            <p className="text-sm text-muted-foreground">{player.full_name}</p>
            <div>
              <label
                htmlFor="transfer-offer-destination"
                className="text-xs font-heading font-bold uppercase tracking-wider text-muted-foreground block mb-1"
              >
                {t("playerProfile.transferOfferDestination", {
                  defaultValue: "Destination",
                })}
              </label>
              <select
                id="transfer-offer-destination"
                value={transferOfferDestination}
                onChange={(event) =>
                  setTransferOfferDestination(
                    event.target.value as TransferDestinationData,
                  )
                }
                className="w-full px-3 py-2 rounded-lg bg-muted border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="main">
                  {gameState.teams.find((team) => team.id === managerTeamId)?.name ??
                    t("playerProfile.transferOfferMainTeam", {
                      defaultValue: "Main team",
                    })}
                </option>
                {managerAcademyTeam ? (
                  <option value="academy">{managerAcademyTeam.name}</option>
                ) : null}
              </select>
            </div>
            {!player.team_id ? (
              <p className="text-xs text-muted-foreground">
                {t("transfers.freeAgentSigningHint", { defaultValue: "This player is a free agent and can be signed without a transfer fee." })}
              </p>
            ) : (
              <>
              <div>
              <label
                htmlFor="transfer-offer-amount"
                className="text-xs font-heading font-bold uppercase tracking-wider text-muted-foreground block mb-1"
              >
                {t("playerProfile.transferOfferAmount", {
                  defaultValue: "Offer amount",
                })}
              </label>
              <input
                id="transfer-offer-amount"
                type="number"
                min="1"
                step="1000"
                value={transferOfferAmount}
                onChange={(event) => {
                  setTransferOfferAmount(event.target.value);
                  const fee = Math.round(Number.parseFloat(event.target.value));
                  if (Number.isFinite(fee) && fee > 0) {
                    void previewTransferBidFinancialImpact(player.id, fee, transferOfferDestination)
                      .then((res) => {
                        setTransferOfferProjection(res.projection);
                        setTransferOfferFee(fee);
                      })
                      .catch(() => {});
                  }
                }}
                className="w-full px-3 py-2 rounded-lg bg-muted border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            {transferOfferError ? (
              <p className="rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                {transferOfferError}
              </p>
            ) : null}
            {transferOfferFee !== null && transferOfferProjection ? (
              <div className="rounded-lg border border-border bg-white/70 bg-card/60 p-3 space-y-2">
                <p className="text-[11px] font-heading font-bold uppercase tracking-wider text-muted-foreground">
                  {t("transfers.bidImpactTitle", { defaultValue: "Projected impact" })}
                </p>
                <p className="text-xs text-foreground/70">
                  {t("transfers.bidImpactTransferBudget", {
                    before: formatVal(transferOfferProjection.transfer_budget_before),
                    after: formatVal(transferOfferProjection.transfer_budget_after),
                    defaultValue: "Transfer budget {{before}} -> {{after}}",
                  })}
                </p>
                <p className="text-xs text-foreground/70">
                  {t("transfers.bidImpactBalance", {
                    before: formatVal(transferOfferProjection.finance_before),
                    after: formatVal(transferOfferProjection.finance_after),
                    defaultValue: "Club balance {{before}} -> {{after}}",
                  })}
                </p>
                <p className="text-xs text-foreground/70">
                  {t("transfers.bidImpactWagePressure", {
                    percent: transferOfferProjection.projected_wage_budget_usage_pct,
                    defaultValue: "Projected wage budget usage {{percent}}%",
                  })}
                </p>
                {transferOfferProjection.exceeds_transfer_budget && (
                  <p className="text-xs text-red-500">
                    {t("transfers.bidImpactOverTransferBudget", { defaultValue: "This bid exceeds your transfer budget" })}
                  </p>
                )}
                {transferOfferProjection.exceeds_finance && (
                  <p className="text-xs text-red-500">
                    {t("transfers.bidImpactOverBalance", { defaultValue: "This bid would push the club into debt" })}
                  </p>
                )}
              </div>
            ) : null}
              </>
            )}
            {transferOfferFeedback ? (
              <NegotiationFeedbackPanel
                feedback={transferOfferFeedback.feedback}
                titleKey="transfers.negotiationPulse"
                roundKey="transfers.negotiationRound"
                patienceKey="transfers.negotiationPatience"
                tensionKey="transfers.negotiationTension"
              />
            ) : null}
            <TransferNegotiationHistory offer={null} mode="outgoing" />
            {transferOfferError ? (
              <div className="text-xs font-heading font-bold uppercase tracking-wider text-red-500">
                {transferOfferError}
              </div>
            ) : null}
            {transferOfferFeedback ? (
              <div
                className={`text-xs font-heading font-bold uppercase tracking-wider ${
                  transferOfferFeedback.decision === "accepted"
                    ? "text-green-500"
                    : transferOfferFeedback.decision === "rejected"
                      ? "text-red-500"
                      : "text-amber-500"
                }`}
              >
                {transferOfferFeedback.decision === "accepted"
                  ? t("transfers.bidAccepted", { defaultValue: "Bid accepted!" })
                  : transferOfferFeedback.decision === "rejected"
                    ? t("transfers.bidRejected", { defaultValue: "Bid rejected." })
                    : t("transfers.bidCountered", { defaultValue: "They came back with revised terms." })}
              </div>
            ) : null}
            <div className="flex gap-2">
              <Button
                onClick={() => void handleSubmitTransferOffer()}
                disabled={transferActionSubmitting}
                className="flex-1 py-2 bg-primary-500 hover:bg-primary-600 text-white rounded-lg font-heading font-bold text-sm uppercase tracking-wider transition-colors disabled:opacity-50"
              >
                {transferActionSubmitting
                  ? t("transfers.submitting", { defaultValue: "Submitting..." })
                  : t("playerProfile.transferOfferSubmit", { defaultValue: "Send offer" })}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setShowTransferOfferModal(false)}
                disabled={transferActionSubmitting}
                className="px-4 py-2 bg-muted text-foreground/70 rounded-lg font-heading font-bold text-sm uppercase tracking-wider hover:bg-muted transition-colors"
              >
                {t("common.cancel", { defaultValue: "Cancel" })}
              </Button>
            </div>
          </div>
        </DashboardModalFrame>
      ) : null}
      {showWageModal && wageNegotiationTarget && (
        <WageNegotiationModal
          target={wageNegotiationTarget}
          teams={gameState.teams}
          wageAmount={wageNegotiationAmount}
          onWageAmountChange={setWageNegotiationAmount}
          contractYears={wageNegotiationYears}
          onContractYearsChange={setWageNegotiationYears}
          feedback={wageNegotiationFeedback}
          activeOffer={null}
          result={wageNegotiationResult}
          error={wageNegotiationError}
          loading={wageNegotiationLoading}
          onSubmit={handleWageNegotiation}
          onClose={() => {
            setShowWageModal(false);
            setWageNegotiationTarget(null);
            setWageNegotiationAmount("");
            setWageNegotiationResult(null);
            setWageNegotiationFeedback(null);
            setWageNegotiationError(null);
          }}
          annualWageBudget={managerTeam ? managerTeam.wage_budget : 0}
        />
      )}
    </div>
  );
}




