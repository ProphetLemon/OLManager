import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { getContractRiskLevel } from "@/lib/common/helpers";
import { buildPlayerAttributeGroups } from "@/lib/playerProfile/attributes";
import {
  buildChampionPerformanceMap,
  buildTopChampionMasteries,
  type LolRole,
} from "@/lib/playerProfile/champions";
import { getPlayerAge, getPlayerTeamName } from "@/lib/playerProfile/helpers";
import { canRenameFounder } from "@/lib/customTeam/founders";
import { getScoutAvailability, type PlayerProfileScoutStatus } from "@/lib/playerProfile/scouting";
import { calculateLolOvr } from "@/lib/players/lolPlayerStats";
import { resolvePlayerLolRole } from "@/lib/players/lolIdentity";
import { tierFromLp, type SoloQTier } from "@/lib/players/soloq";
import { resolveSeasonContext } from "@/lib/season/seasonContext";
import { demoteMainPlayerToAcademy, promoteAcademyPlayer } from "@/services/academyService";
import { startPotentialResearch } from "@/services/playerService";
import { findAcademyTeamForParent } from "@/store/academySelectors";
import type {
  GameStateData,
  PlayerData,
  PlayerMatchHistoryEntryData,
  PlayerSelectionOptions,
  ScoutReportData,
} from "@/store/gameStore";
import WageNegotiationDialog from "@/ui-v2/dashboard/tabs/transfers/WageNegotiationDialog";
import PlayerProfileAttributesCardV2 from "@/ui-v2/pages/playerProfile/PlayerProfileAttributesCardV2";
import PlayerProfileCareerCardV2 from "@/ui-v2/pages/playerProfile/PlayerProfileCareerCardV2";
import PlayerProfileChampionsCardV2 from "@/ui-v2/pages/playerProfile/PlayerProfileChampionsCardV2";
import PlayerProfileContractCardV2 from "@/ui-v2/pages/playerProfile/PlayerProfileContractCardV2";
import PlayerProfileHeroCardV2 from "@/ui-v2/pages/playerProfile/PlayerProfileHeroCardV2";
import PlayerProfileMatchHistoryCardV2 from "@/ui-v2/pages/playerProfile/PlayerProfileMatchHistoryCardV2";
import PlayerProfileReleaseModalV2 from "@/ui-v2/pages/playerProfile/PlayerProfileReleaseModalV2";
import PlayerProfileRenameModalV2 from "@/ui-v2/pages/playerProfile/PlayerProfileRenameModalV2";
import PlayerProfileRenewalModalV2 from "@/ui-v2/pages/playerProfile/PlayerProfileRenewalModalV2";
import PlayerProfileStatsCardV2 from "@/ui-v2/pages/playerProfile/PlayerProfileStatsCardV2";
import PlayerProfileTraitsCardV2 from "@/ui-v2/pages/playerProfile/PlayerProfileTraitsCardV2";
import PlayerProfileTransferOfferModalV2 from "@/ui-v2/pages/playerProfile/PlayerProfileTransferOfferModalV2";
import { usePlayerRenewal } from "@/ui-v2/pages/playerProfile/usePlayerRenewal";
import { usePlayerTransfer } from "@/ui-v2/pages/playerProfile/usePlayerTransfer";

interface PlayerProfileV2Props {
  gameState: GameStateData;
  playerId: string;
  startWithRenewalModal?: boolean;
  onClose: () => void;
  onGameUpdate?: (state: GameStateData) => void;
  onSelectPlayer?: (id: string, options?: PlayerSelectionOptions) => void;
  onSelectTeam?: (id: string) => void;
  onViewChampion?: (championKey: string) => void;
}

function getLatestScoutReportForPlayer(
  gameState: GameStateData,
  playerId: string,
): ScoutReportData | null {
  return (
    gameState.messages
      .filter((message) => message.context?.scout_report?.player_id === playerId)
      .sort((left, right) => right.date.localeCompare(left.date))[0]?.context.scout_report ?? null
  );
}

function collectManagedTeamIds(gameState: GameStateData): Set<string> {
  const managerTeamId = gameState.manager.team_id;
  const managed = new Set<string>();
  if (!managerTeamId) return managed;

  managed.add(managerTeamId);
  const parentAcademyId = gameState.teams.find((team) => team.id === managerTeamId)?.academy_team_id;
  gameState.teams.forEach((team) => {
    if (team.team_kind !== "Academy") return;
    if (team.parent_team_id === managerTeamId || (parentAcademyId && team.id === parentAcademyId)) {
      managed.add(team.id);
    }
  });
  return managed;
}

export default function PlayerProfileV2({
  gameState,
  playerId,
  startWithRenewalModal = false,
  onClose,
  onGameUpdate,
  onSelectTeam,
  onViewChampion,
}: PlayerProfileV2Props) {
  const player = gameState.players.find((p) => p.id === playerId);
  if (!player) return null;

  return (
    <div className="player-profile-v2 flex h-full flex-col overflow-y-auto scrollbar-v2">
      <PlayerProfileContent
        gameState={gameState}
        player={player}
        startWithRenewalModal={startWithRenewalModal}
        onClose={onClose}
        onGameUpdate={onGameUpdate}
        onSelectTeam={onSelectTeam}
        onViewChampion={onViewChampion}
      />
    </div>
  );
}

interface PlayerProfileContentProps {
  gameState: GameStateData;
  player: PlayerData;
  startWithRenewalModal: boolean;
  onClose: () => void;
  onGameUpdate?: (state: GameStateData) => void;
  onSelectTeam?: (id: string) => void;
  onViewChampion?: (championKey: string) => void;
}

function PlayerProfileContent({
  gameState,
  player,
  startWithRenewalModal,
  onClose,
  onGameUpdate,
  onSelectTeam,
  onViewChampion,
}: PlayerProfileContentProps) {
  const { t, i18n } = useTranslation();
  const annualSuffix = t("finances.perYearSuffix", "/yr");
  const primaryRole = resolvePlayerLolRole(player);

  const [scoutStatus, setScoutStatus] = useState<PlayerProfileScoutStatus>("idle");
  const [scoutError, setScoutError] = useState<string | null>(null);
  const [academyActionSubmitting, setAcademyActionSubmitting] = useState(false);
  const [playerHistory, setPlayerHistory] = useState<PlayerMatchHistoryEntryData[]>([]);
  const [rerollingRole, setRerollingRole] = useState(false);
  const [potentialResearchSubmitting, setPotentialResearchSubmitting] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);

  const ovr = calculateLolOvr(player);
  const age = getPlayerAge(player.date_of_birth, gameState.clock.current_date);
  const playerTeam = gameState.teams.find((team) => team.id === player.team_id);
  const teamName = getPlayerTeamName(gameState.teams, player.team_id, {
    freeAgent: t("common.freeAgent"),
    unknown: t("common.unknown"),
  });
  const soloqTier: SoloQTier = tierFromLp(player.soloq_lp);
  const managerTeamId = gameState.manager.team_id;
  const managerTeam = gameState.teams.find((team) => team.id === managerTeamId) ?? null;
  const managerAcademyTeam = findAcademyTeamForParent(gameState.teams, managerTeamId);
  const managedTeamIds = collectManagedTeamIds(gameState);

  const isOwnMainPlayer = managerTeamId !== null && player.team_id === managerTeamId;
  const isOwnAcademyPlayer =
    player.team_id !== null && managedTeamIds.has(player.team_id) && !isOwnMainPlayer;
  const isOwnClub = isOwnMainPlayer || isOwnAcademyPlayer;
  const canRename = Boolean(onGameUpdate) && canRenameFounder(player, managerTeamId);
  const seasonContext = resolveSeasonContext(gameState);
  const isTransferWindowOpen =
    seasonContext.transfer_window.status === "Open" ||
    seasonContext.transfer_window.status === "DeadlineDay";
  const contractRiskLevel = getContractRiskLevel(player.contract_end, gameState.clock.current_date);
  const contractRiskLabel =
    contractRiskLevel === "critical"
      ? t("finances.contractRiskCritical")
      : contractRiskLevel === "warning"
        ? t("finances.contractRiskWarning")
        : t("finances.contractRiskStable");
  const scoutAvailability = getScoutAvailability({
    staff: gameState.staff,
    scoutingAssignments: gameState.scouting_assignments || [],
    managerTeamId: gameState.manager.team_id,
    playerId: player.id,
    scoutStatus,
  });
  const latestScoutReport = getLatestScoutReportForPlayer(gameState, player.id) ?? undefined;
  const attrGroups = buildPlayerAttributeGroups(player, t, latestScoutReport);
  const visibleChampionMasteryCount = isOwnClub ? 4 : latestScoutReport ? 2 : 1;
  const topChampions = buildTopChampionMasteries(
    player.id,
    primaryRole,
    buildChampionPerformanceMap(playerHistory),
    gameState.champion_masteries ?? [],
    visibleChampionMasteryCount,
  );
  const activePotentialResearchPlayer = gameState.players.find(
    (candidate) => (candidate.potential_research_eta_days ?? 0) > 0,
  );
  const isPotentialResearchBlockedByOther =
    Boolean(activePotentialResearchPlayer) && activePotentialResearchPlayer?.id !== player.id;

  const renewal = usePlayerRenewal({
    player,
    canRenew: isOwnClub,
    startWithRenewalModal,
    onGameUpdate,
    t,
  });
  const transfer = usePlayerTransfer({
    player,
    currentDate: gameState.clock.current_date,
    isOwnClub,
    isTransferWindowOpen,
    onGameUpdate,
    onClose,
    t,
  });

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
    if (!isOwnClub || !onGameUpdate || rerollingRole) return;

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

  async function handleScout(): Promise<void> {
    const availableScout = scoutAvailability.availableScout;
    if (!availableScout || !onGameUpdate) return;

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
  }

  async function handleAcademyAction(): Promise<void> {
    if (!onGameUpdate || academyActionSubmitting) return;

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
  }

  async function handleStartPotentialResearch(): Promise<void> {
    if (potentialResearchSubmitting) return;

    setPotentialResearchSubmitting(true);
    try {
      const updated = await startPotentialResearch(player.id);
      onGameUpdate?.(updated);
    } catch {
      return;
    } finally {
      setPotentialResearchSubmitting(false);
    }
  }

  async function handleToggleList(command: "toggle_transfer_list" | "toggle_loan_list"): Promise<void> {
    try {
      const updated = await invoke<GameStateData>(command, { playerId: player.id });
      onGameUpdate?.(updated);
    } catch {
      /* silent */
    }
  }

  const canManageAcademy = isOwnAcademyPlayer || (isOwnMainPlayer && managerAcademyTeam);

  return (
    <div className="mx-auto w-[92%] max-w-[2000px]">
      <PlayerProfileHeroCardV2
        player={player}
        ovr={ovr}
        primaryRole={primaryRole}
        age={age}
        teamName={teamName}
        teamLogoUrl={playerTeam?.logo_url ?? null}
        annualSuffix={annualSuffix}
        language={i18n.language}
        isOwnClub={isOwnClub || !onGameUpdate}
        soloqTier={soloqTier}
        scoutAvailability={scoutAvailability}
        scoutStatus={scoutStatus}
        scoutError={scoutError}
        onScout={() => void handleScout()}
        onRerollRole={(role) => void handleRerollRole(role)}
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
        onAcademyAction={canManageAcademy ? () => void handleAcademyAction() : null}
        onStartPotentialResearch={onGameUpdate ? () => void handleStartPotentialResearch() : undefined}
        potentialResearchSubmitting={potentialResearchSubmitting}
        isPotentialResearchBlockedByOther={isPotentialResearchBlockedByOther}
        onToggleTransferList={
          onGameUpdate && isOwnClub ? () => void handleToggleList("toggle_transfer_list") : undefined
        }
        onToggleLoanList={
          onGameUpdate && isOwnClub ? () => void handleToggleList("toggle_loan_list") : undefined
        }
        onRename={canRename ? () => setShowRenameModal(true) : undefined}
        t={t}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <PlayerProfileContractCardV2
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
          hasTeam={player.team_id != null}
          isOwnClub={isOwnClub}
          isTransferWindowOpen={isTransferWindowOpen}
          transferActionSubmitting={transfer.transferActionSubmitting}
          onOpenRenewal={renewal.openRenewalModal}
          onReleaseContract={transfer.handleRequestReleaseContract}
          onOpenTransferBid={transfer.handleOpenTransferOfferModal}
          t={t}
        />

        <div className="flex flex-col gap-5 lg:col-span-2">
          <PlayerProfileAttributesCardV2
            attrGroups={attrGroups}
            canViewAttributes
            title={t("playerProfile.attributes")}
            averageLabel={t("common.average")}
            hiddenTitle={t("playerProfile.attributesHidden")}
            hiddenBody={t("playerProfile.scoutToView")}
          />

          {topChampions.length > 0 ? (
            <PlayerProfileChampionsCardV2 champions={topChampions} onViewChampion={onViewChampion} />
          ) : null}
        </div>
      </div>

      <div className="mt-5 space-y-5 pb-6">
        {player.traits && player.traits.length > 0 ? (
          <PlayerProfileTraitsCardV2
            traits={player.traits}
            title={t("playerProfile.traits", { defaultValue: "Rasgos" })}
          />
        ) : null}
        {player.stats ? <PlayerProfileStatsCardV2 stats={player.stats} t={t} /> : null}
        {player.career && player.career.length > 0 ? (
          <PlayerProfileCareerCardV2 career={player.career} gameState={gameState} t={t} />
        ) : null}
        {playerHistory.length > 0 ? (
          <PlayerProfileMatchHistoryCardV2 history={playerHistory} t={t} language={i18n.language} />
        ) : null}
      </div>

      <PlayerProfileRenewalModalV2
        show={renewal.showRenewalModal}
        playerName={player.full_name}
        t={t}
        annualSuffix={annualSuffix}
        renewalWage={renewal.renewalWage}
        renewalLength={renewal.renewalLength}
        renewalIsTerminal={renewal.renewalIsTerminal}
        isRenewalWageValid={renewal.isRenewalWageValid}
        renewalViolatesSoftCap={renewal.renewalViolatesSoftCap}
        renewalProjection={renewal.renewalProjection}
        renewalStatusMessage={renewal.renewalStatusMessage}
        renewalStatusClassName={renewal.renewalStatusClassName}
        renewalCooledOff={renewal.renewalCooledOff}
        renewalFeedback={renewal.renewalFeedback}
        renewalSubmitting={renewal.renewalSubmitting}
        renewalSubmitDisabled={renewal.renewalSubmitDisabled}
        onWageChange={renewal.setRenewalWage}
        onLengthChange={renewal.setRenewalLength}
        onClose={renewal.closeRenewalModal}
        onDelegate={() => void renewal.handleDelegateRenewal()}
        onSubmit={() => void renewal.handleRenewalSubmit()}
      />

      {showRenameModal ? (
        <PlayerProfileRenameModalV2
          player={player}
          onClose={() => setShowRenameModal(false)}
          onRenamed={(updated) => {
            onGameUpdate?.(updated);
            setShowRenameModal(false);
          }}
        />
      ) : null}

      {transfer.showReleaseContractModal ? (
        <PlayerProfileReleaseModalV2
          t={t}
          penalty={transfer.releasePenaltyPreview}
          error={transfer.releaseContractError}
          submitting={transfer.transferActionSubmitting}
          onCancel={transfer.cancelReleaseContract}
          onConfirm={() => void transfer.handleConfirmReleaseContract()}
        />
      ) : null}

      {transfer.showTransferOfferModal ? (
        <PlayerProfileTransferOfferModalV2
          t={t}
          playerName={player.full_name}
          isFreeAgent={!player.team_id}
          managerTeam={managerTeam}
          academyTeam={managerAcademyTeam}
          destination={transfer.transferOfferDestination}
          amount={transfer.transferOfferAmount}
          error={transfer.transferOfferError}
          feedback={transfer.transferOfferFeedback}
          projection={transfer.transferOfferProjection}
          projectionFee={transfer.transferOfferFee}
          submitting={transfer.transferActionSubmitting}
          onDestinationChange={transfer.setTransferOfferDestination}
          onAmountChange={transfer.handleTransferOfferAmountChange}
          onSubmit={() => void transfer.handleSubmitTransferOffer()}
          onCancel={transfer.closeTransferOfferModal}
        />
      ) : null}

      {transfer.showWageModal && transfer.wageNegotiationTarget ? (
        <WageNegotiationDialog
          target={transfer.wageNegotiationTarget}
          teams={gameState.teams}
          wageAmount={transfer.wageNegotiationAmount}
          onWageAmountChange={transfer.setWageNegotiationAmount}
          contractYears={transfer.wageNegotiationYears}
          onContractYearsChange={transfer.setWageNegotiationYears}
          feedback={transfer.wageNegotiationFeedback}
          activeOffer={null}
          result={transfer.wageNegotiationResult}
          error={transfer.wageNegotiationError}
          loading={transfer.wageNegotiationLoading}
          onSubmit={transfer.handleWageNegotiation}
          onClose={transfer.resetWageNegotiation}
          annualWageBudget={managerTeam ? managerTeam.wage_budget : 0}
        />
      ) : null}
    </div>
  );
}
