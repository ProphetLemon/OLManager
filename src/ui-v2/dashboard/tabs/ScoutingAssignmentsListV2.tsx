import { Clock } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { PlayerData, ScoutingAssignment, StaffData, TeamData } from "@/store/gameStore";
import { getTeamName } from "@/lib/common/helpers";
import { getLolRoleForPlayer } from "@/lib/squad/helpers";
import { resolvePlayerPhoto } from "@/lib/players/playerPhotos";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui-v2/components/ui/card";

interface ScoutingAssignmentsListV2Props {
  assignments: ScoutingAssignment[];
  scouts: StaffData[];
  players: PlayerData[];
  teams: TeamData[];
  onSelectPlayer?: (id: string) => void;
}

export default function ScoutingAssignmentsListV2({
  assignments,
  scouts,
  players,
  teams,
  onSelectPlayer,
}: ScoutingAssignmentsListV2Props) {
  const { t } = useTranslation();

  if (assignments.length === 0) return null;

  return (
    <Card>
      <CardHeader className="space-y-0">
        <CardTitle className="font-heading text-sm uppercase tracking-widest text-muted-foreground">
          {t("scouting.activeScoutingAssignments")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2">
          {assignments.map((assignment) => {
            const scout = scouts.find((s) => s.id === assignment.scout_id);
            const player = players.find((p) => p.id === assignment.player_id);
            if (!scout || !player) return null;

            const team = player.team_id ? getTeamName(teams, player.team_id) : t("common.freeAgent");
            const photo = resolvePlayerPhoto(player.id, player.match_name, player.profile_image_url);

            return (
              <div
                key={assignment.id}
                className="flex items-center gap-4 rounded-lg border border-border bg-muted/20 p-3"
              >
                {photo ? (
                  <img
                    src={photo}
                    alt={player.match_name}
                    className="size-9 shrink-0 rounded-full border border-border object-cover"
                    loading="lazy"
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => onSelectPlayer?.(player.id)}
                    className="block truncate text-left font-heading text-sm font-bold text-foreground transition-colors hover:text-club-text"
                  >
                    {player.match_name}
                  </button>
                  <p className="text-xs text-muted-foreground">
                    {getLolRoleForPlayer(player)} · {team}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs text-muted-foreground">
                    {scout.first_name} {scout.last_name}
                  </p>
                  <div className="mt-0.5 flex items-center justify-end gap-1.5">
                    <Clock className="size-3 text-club-text" />
                    <span className="font-heading text-xs font-bold tabular-nums text-club-text">
                      {assignment.days_remaining}d
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
