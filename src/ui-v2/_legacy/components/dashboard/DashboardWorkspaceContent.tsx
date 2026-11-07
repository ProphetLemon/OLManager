import type { GameStateData } from "@/store/gameStore";
import PlayerProfile from "@/ui-v2/_legacy/components/playerProfile/PlayerProfile";
import TeamProfile from "@/ui-v2/_legacy/components/teamProfile";
import DashboardAlerts from "@/ui-v2/_legacy/components/dashboard/DashboardAlerts";
import type { DashboardAlert } from "@/ui-v2/_legacy/components/dashboard/dashboardHelpers";
import type { DashboardProfileNavigationState } from "@/ui-v2/_legacy/components/dashboard/dashboardProfileNavigation";
import DashboardTabContent from "@/ui-v2/_legacy/components/dashboard/DashboardTabContent";
import type { DashboardTabContentModel } from "@/ui-v2/_legacy/components/dashboard/dashboardTabContentModel";
import { ShieldX } from "lucide-react";
import { useTranslation } from "react-i18next";

interface DashboardWorkspaceContentProps {
  dashboardAlerts: DashboardAlert[];
  gameState: GameStateData;
  profileNavigation: DashboardProfileNavigationState;
  dashboardTabContentModel: DashboardTabContentModel;
  onBack: () => void;
  onNavigate: (tab: string) => void;
  onSelectPlayer: (id: string) => void;
  onSelectTeam: (id: string) => void;
  onGameUpdate: (state: GameStateData) => void;
  isUnemployed: boolean;
  onViewChampion?: (championKey: string) => void;
}

export default function DashboardWorkspaceContent({
  dashboardAlerts,
  gameState,
  profileNavigation,
  dashboardTabContentModel,
  onBack,
  onNavigate,
  onSelectPlayer,
  onSelectTeam,
  onGameUpdate,
  isUnemployed,
  onViewChampion = () => undefined,
}: DashboardWorkspaceContentProps) {
  const { t } = useTranslation();

  // When viewing a champion from a player/team profile, close the profile first
  const handleViewChampion = (championKey: string) => {
    onBack(); // Close player/team profile
    onViewChampion(championKey); // Open champion page
  };

  const selectedPlayer = profileNavigation.selectedPlayerId
    ? gameState.players.find(
      (player) => player.id === profileNavigation.selectedPlayerId,
    ) ?? null
    : null;
  const selectedTeam = profileNavigation.selectedTeamId
    ? gameState.teams.find((team) => team.id === profileNavigation.selectedTeamId) ??
      null
    : null;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-6 bg-gray-100 dark:bg-navy-900">
      {isUnemployed && (
        <div className="mx-6 mt-4 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-950/30">
          <ShieldX className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-500" />
          <p className="text-sm text-amber-800 dark:text-amber-300">
            {t("dashboard.unemployedBanner")}
          </p>
        </div>
      )}

      {selectedPlayer && !selectedTeam ? (
        <PlayerProfile
          player={selectedPlayer}
          gameState={gameState}
          isOwnClub={selectedPlayer.team_id === gameState.manager.team_id}
          startWithRenewalModal={
            profileNavigation.selectedPlayerOptions?.openRenewal === true
          }
          onClose={onBack}
          onSelectTeam={onSelectTeam}
          onGameUpdate={onGameUpdate}
          onViewChampion={handleViewChampion}
        />
      ) : selectedTeam ? (
        <TeamProfile
          team={selectedTeam}
          gameState={gameState}
          isOwnTeam={selectedTeam.id === gameState.manager.team_id}
          onClose={onBack}
          onSelectPlayer={onSelectPlayer}
        />
      ) : (
        <>
          <DashboardAlerts alerts={dashboardAlerts} onNavigate={onNavigate} />
          <div className="flex flex-col gap-4">
            <DashboardTabContent viewModel={dashboardTabContentModel} />
            {dashboardTabContentModel.activeTab &&
            ![
              "Home",
              "Squad",
              "Tactics",
              "Training",
              "Meta",
              "Scrims",
              "Schedule",
              "Finances",
              "Transfers",
              "Players",
              "Teams",
              "WorldStaff",
              "Tournaments",
              "Competitions",
              "ChampionsWorld",
              "Market",
              "Staff",
              "Scouting",
              "Youth",
              "YouthAcademy",
              "Inbox",
              "Manager",
              "News",
              "Social",
            ].includes(dashboardTabContentModel.activeTab) && <></>}
          </div>
        </>
      )}
    </div>
  );
}
