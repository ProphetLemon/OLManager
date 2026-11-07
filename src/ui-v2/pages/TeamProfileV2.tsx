import { ChevronLeft } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { buildTeamProfileViewModel } from "@/lib/teamProfile/viewModel";
import type { GameStateData, TeamData } from "@/store/gameStore";
import TeamProfileHeroCardV2 from "@/ui-v2/pages/teamProfile/TeamProfileHeroCardV2";
import {
  TeamProfileClubDetailsCardV2,
  TeamProfileLeagueStandingCardV2,
  TeamProfileSummaryCardV2,
} from "@/ui-v2/pages/teamProfile/TeamProfileInfoCardsV2";
import {
  TeamProfileHistoryCardV2,
  TeamProfileRecentMatchesCardV2,
} from "@/ui-v2/pages/teamProfile/TeamProfileRecordCardsV2";
import TeamProfileRosterCardV2 from "@/ui-v2/pages/teamProfile/TeamProfileRosterCardV2";
import { useTeamProfileStats } from "@/ui-v2/pages/teamProfile/useTeamProfileStats";

interface TeamProfileV2Props {
  gameState: GameStateData;
  teamId: string;
  onClose: () => void;
  onSelectPlayer?: (id: string) => void;
}

function TeamProfileContent({
  team,
  gameState,
  onClose,
  onSelectPlayer,
}: {
  team: TeamData;
  gameState: GameStateData;
  onClose: () => void;
  onSelectPlayer?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const viewModel = useMemo(() => buildTeamProfileViewModel(team, gameState), [team, gameState]);
  const { recentMatches } = useTeamProfileStats(team.id);
  const isOwnTeam = team.id === gameState.manager.team_id;

  return (
    <div className="flex h-full flex-col overflow-y-auto scrollbar-v2 p-6">
      <div className="mx-auto w-full max-w-[2000px]">
        <button
          type="button"
          onClick={onClose}
          className="mb-4 inline-flex w-fit items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 font-heading text-xs font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          {t("common.back")}
        </button>

        <TeamProfileHeroCardV2 team={team} viewModel={viewModel} />

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <TeamProfileClubDetailsCardV2 team={team} rosterSize={viewModel.roster.length} />
          <TeamProfileSummaryCardV2 team={team} isOwnTeam={isOwnTeam} viewModel={viewModel} />
          <TeamProfileLeagueStandingCardV2 standings={viewModel.standings} />
          <TeamProfileRecentMatchesCardV2 matches={recentMatches} />
          <TeamProfileRosterCardV2
            roster={viewModel.roster}
            currentDate={gameState.clock.current_date}
            isOwnTeam={isOwnTeam}
            onSelectPlayer={onSelectPlayer}
          />
          <TeamProfileHistoryCardV2 history={team.history} />
        </div>
      </div>
    </div>
  );
}

export default function TeamProfileV2({
  gameState,
  teamId,
  onClose,
  onSelectPlayer,
}: TeamProfileV2Props) {
  const team = gameState.teams.find((t) => t.id === teamId);
  if (!team) return null;

  return (
    <TeamProfileContent
      team={team}
      gameState={gameState}
      onClose={onClose}
      onSelectPlayer={onSelectPlayer}
    />
  );
}
