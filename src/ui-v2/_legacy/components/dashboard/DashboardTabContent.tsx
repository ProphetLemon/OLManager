import SquadTab from "@/ui-v2/_legacy/components/squad/SquadTab";
import TacticsTab from "@/ui-v2/_legacy/components/tactics/TacticsTab";
import TrainingTab from "@/ui-v2/_legacy/components/training/TrainingTab";
import ScheduleTab from "@/ui-v2/_legacy/components/schedule/ScheduleTab";
import FinancesTab from "@/ui-v2/_legacy/components/finances/FinancesTab";
import TransfersTab from "@/ui-v2/_legacy/components/transfers/TransfersTab";
import PlayersListTab from "@/ui-v2/_legacy/components/players/PlayersListTab";

import ScoutingTab from "@/ui-v2/_legacy/components/scouting/ScoutingTab";
import YouthAcademyTab from "@/ui-v2/_legacy/components/youthAcademy/YouthAcademyTab";
import StaffTab from "@/ui-v2/_legacy/components/staff/StaffTab";
import InboxTab from "@/ui-v2/_legacy/components/inbox/InboxTab";
import ManagerTab from "@/ui-v2/_legacy/components/manager/ManagerTab";
import NewsTab from "@/ui-v2/_legacy/components/news/NewsTab";
import SocialTab from "@/ui-v2/_legacy/components/social/SocialTab";
import ChampionsTab from "@/ui-v2/_legacy/components/champions/ChampionsTab";
import ChampionsWorldTab from "@/ui-v2/_legacy/components/world/ChampionsWorldTab";
import ScrimsTab from "@/ui-v2/_legacy/components/scrims/ScrimsTab";
import MarketTab from "@/ui-v2/_legacy/components/market/MarketTab";
import EndOfSeasonScreen from "@/ui-v2/_legacy/components/EndOfSeasonScreen";
import type { DashboardTabContentModel } from "@/ui-v2/_legacy/components/dashboard/dashboardTabContentModel";

interface DashboardTabContentProps {
  viewModel: DashboardTabContentModel;
}

export default function DashboardTabContent({
  viewModel,
}: DashboardTabContentProps) {
  const {
    activeTab,
    gameState,
    initialMessageId,
    managerId,
    seasonComplete,
    handlers: {
      onGameUpdate,
      onNavigate,
      onSelectPlayer,
      onSelectTeam,
      onViewChampion,
    },
  } = viewModel;

  return (
    <div key={activeTab} className="animate-fade-in-up">
      {/* End-of-season screen when all fixtures are complete */}
      {seasonComplete && activeTab === "Home" && (
        <EndOfSeasonScreen gameState={gameState} onGameUpdate={onGameUpdate} />
      )}

      {activeTab === "Squad" && (
        <SquadTab
          gameState={gameState}
          managerId={managerId}
          onSelectPlayer={onSelectPlayer}
          onGameUpdate={onGameUpdate}
        />
      )}

      {activeTab === "Tactics" && (
        <TacticsTab
          gameState={gameState}
          onSelectPlayer={onSelectPlayer}
          onGameUpdate={onGameUpdate}
        />
      )}

      {activeTab === "Training" && (
        <TrainingTab gameState={gameState} onGameUpdate={onGameUpdate} />
      )}

      {activeTab === "Scrims" && (
        <ScrimsTab gameState={gameState} onGameUpdate={onGameUpdate} />
      )}

      {activeTab === "Meta" && (
        <ChampionsTab gameState={gameState} onGameUpdate={onGameUpdate} onViewChampion={onViewChampion} />
      )}

      {activeTab === "Schedule" && (
        <ScheduleTab gameState={gameState} onSelectTeam={onSelectTeam} />
      )}

      {activeTab === "Finances" && (
        <FinancesTab
          gameState={gameState}
          onGameUpdate={onGameUpdate}
          onSelectPlayer={onSelectPlayer}
        />
      )}

      {activeTab === "Transfers" && (
        <TransfersTab
          gameState={gameState}
          onSelectPlayer={onSelectPlayer}
          onSelectTeam={onSelectTeam}
          onGameUpdate={onGameUpdate}
        />
      )}

      {activeTab === "Players" && (
        <PlayersListTab
          gameState={gameState}
          onSelectPlayer={onSelectPlayer}
          onSelectTeam={onSelectTeam}
        />
      )}

      {activeTab === "WorldStaff" && (
        <StaffTab gameState={gameState} mode="world" />
      )}

      
      {activeTab === "ChampionsWorld" && (
        <ChampionsWorldTab champions={gameState.champions} onViewChampion={onViewChampion} />
      )}

      {activeTab === "Market" && (
        <MarketTab gameState={gameState} />
      )}

      {activeTab === "Staff" && (
        <StaffTab gameState={gameState} onGameUpdate={onGameUpdate} />
      )}

      {activeTab === "Scouting" && (
        <ScoutingTab
          gameState={gameState}
          onGameUpdate={onGameUpdate}
          onSelectPlayer={onSelectPlayer}
          onNavigate={onNavigate}
        />
      )}

      {(activeTab === "Youth" || activeTab === "YouthAcademy") && (
        <YouthAcademyTab
          gameState={gameState}
          onSelectPlayer={onSelectPlayer}
          onGameUpdate={onGameUpdate}
        />
      )}

      {activeTab === "Inbox" && (
        <InboxTab
          gameState={gameState}
          onGameUpdate={onGameUpdate}
          initialMessageId={initialMessageId}
          onNavigate={onNavigate}
        />
      )}

      {activeTab === "Manager" && <ManagerTab gameState={gameState} />}

      {activeTab === "News" && (
        <NewsTab gameState={gameState} onSelectTeam={onSelectTeam} />
      )}

      {activeTab === "Social" && (
        <SocialTab gameState={gameState} onGameUpdate={onGameUpdate} />
      )}

      {![
        "Home",
        "Squad",
        "Tactics",
        "Training",
        "Scrims",
        "Meta",
        "Schedule",
        "Finances",
        "Transfers",
        "Players",
        "Teams",
        "WorldStaff",
        "Tournaments",
        "ChampionsWorld",
        "Competitions",
        "Market",
        "Staff",
        "Scouting",
        "Youth",
        "YouthAcademy",
        "Inbox",
        "Manager",
        "News",
        "Social",
      ].includes(activeTab) && <></>}
    </div>
  );
}
