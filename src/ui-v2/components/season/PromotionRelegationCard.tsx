import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { resolveTeamLogoById } from "@/lib/teams/teamLogos";
import type {
  EndOfSeasonSummaryData,
  LadderMovementReportData,
  LadderTeamRefData,
  LeagueData,
  TeamData,
} from "@/store/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui-v2/components/ui/card";
import { cn } from "@/ui-v2/lib/utils";

type TeamLogoRef = Pick<TeamData, "id" | "name" | "logo_url">;

interface PromotionRelegationCardProps {
  summary: Pick<EndOfSeasonSummaryData, "ladder_movements" | "user_ladder">;
  teams: readonly TeamLogoRef[];
  leagues: readonly Pick<LeagueData, "competition_id" | "logo">[];
  userTeamId: string | null;
}

function TeamBadge({
  teams,
  team,
  size,
}: {
  teams: readonly TeamLogoRef[];
  team: LadderTeamRefData;
  size: "sm" | "lg";
}) {
  const src = resolveTeamLogoById(teams, team.id, () => null);
  const box = size === "lg" ? "size-16" : "size-6";
  if (!src) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          box,
          "flex shrink-0 items-center justify-center rounded-md bg-muted font-heading text-xs font-bold uppercase text-muted-foreground",
        )}
      >
        {team.name.slice(0, 2)}
      </span>
    );
  }
  return <img src={src} alt="" className={cn(box, "shrink-0 object-contain")} />;
}

function competitionName(
  movements: readonly LadderMovementReportData[],
  competitionId: string,
): string {
  for (const movement of movements) {
    if (movement.upper_competition_id === competitionId) return movement.upper_competition_name;
    if (movement.lower_competition_id === competitionId) return movement.lower_competition_name;
  }
  return competitionId;
}

function MovementTeams({
  teams,
  refs,
  direction,
  league,
  userTeamId,
}: {
  teams: readonly TeamLogoRef[];
  refs: readonly LadderTeamRef[];
  direction: "up" | "down";
  league: string;
  userTeamId: string | null;
}) {
  const { t } = useTranslation();
  if (refs.length === 0) return null;
  const Icon = direction === "up" ? ArrowUp : ArrowDown;
  return (
    <div>
      <p
        className={cn(
          "mb-1 flex items-center gap-1.5 text-xs font-semibold",
          direction === "up"
            ? "text-positive"
            : "text-negative",
        )}
      >
        <Icon aria-hidden="true" className="size-4" />
        {t(
          direction === "up" ? "endOfSeason.ladder.promotedTo" : "endOfSeason.ladder.relegatedTo",
          { league },
        )}
      </p>
      <ul className="space-y-1">
        {refs.map((team) => (
          <li
            key={team.id}
            className={cn(
              "flex items-center gap-2 text-sm",
              team.id === userTeamId && "font-bold text-club-text",
            )}
          >
            <TeamBadge teams={teams} team={team} size="sm" />
            <span>{team.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type LadderTeamRef = LadderTeamRefData;

/**
 * End-of-season card for promotion and relegation. It shows what the season
 * meant for the user's club and lists every league movement. Renders nothing
 * when the season produced no movement.
 */
export function PromotionRelegationCard({
  summary,
  teams,
  leagues,
  userTeamId,
}: PromotionRelegationCardProps) {
  const { t } = useTranslation();
  const movements = summary.ladder_movements ?? [];
  const userLadder = summary.user_ladder;
  if (movements.length === 0) return null;

  const userTeam = teams.find((team) => team.id === userTeamId);
  const userRef: LadderTeamRef = { id: userTeamId ?? "", name: userTeam?.name ?? "" };
  const moved = userLadder && userLadder.result !== "Stayed" ? userLadder : null;
  const destinationName = moved ? competitionName(movements, moved.to_competition_id) : "";
  const destinationLogo = moved
    ? leagues.find((league) => league.competition_id === moved.to_competition_id)?.logo
    : null;

  return (
    <Card
      role="region"
      aria-labelledby="ladder-card-title"
      className="mx-auto mb-8 w-full max-w-3xl text-left"
    >
      <CardHeader>
        <CardTitle>
          <h2
            id="ladder-card-title"
            className="font-heading text-lg font-bold uppercase tracking-wide"
          >
            {t("endOfSeason.ladder.title")}
          </h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {moved && (
          <div
            data-testid="ladder-user-result"
            className={cn(
              "flex items-center gap-4 rounded-lg border-l-4 bg-muted/40 p-4",
              moved.result === "Promoted" ? "border-positive" : "border-negative",
            )}
          >
            <TeamBadge teams={teams} team={userRef} size="lg" />
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "flex items-center gap-2 font-heading text-2xl font-bold uppercase tracking-wide",
                  moved.result === "Promoted"
                    ? "text-positive"
                    : "text-negative",
                )}
              >
                {moved.result === "Promoted" ? (
                  <ArrowUp aria-hidden="true" className="size-6" />
                ) : (
                  <ArrowDown aria-hidden="true" className="size-6" />
                )}
                {t(
                  moved.result === "Promoted"
                    ? "endOfSeason.ladder.promotedTitle"
                    : "endOfSeason.ladder.relegatedTitle",
                )}
              </p>
              <p className="mt-1 text-sm text-foreground">
                {t(
                  moved.result === "Promoted"
                    ? "endOfSeason.ladder.promotedBody"
                    : "endOfSeason.ladder.relegatedBody",
                  { team: userRef.name, league: destinationName },
                )}
              </p>
            </div>
            {destinationLogo && (
              <img src={destinationLogo} alt="" className="size-12 shrink-0 object-contain" />
            )}
          </div>
        )}
        {userLadder?.result === "Stayed" && (
          <p data-testid="ladder-user-result" className="text-sm text-muted-foreground">
            {t("endOfSeason.ladder.stayedBody", {
              team: userRef.name,
              league: competitionName(movements, userLadder.from_competition_id),
            })}
          </p>
        )}
        <section aria-labelledby="ladder-movements-title">
          <h3
            id="ladder-movements-title"
            className="mb-2 font-heading text-sm font-bold uppercase tracking-wider text-muted-foreground"
          >
            {t("endOfSeason.ladder.movementsTitle")}
          </h3>
          <ul className="space-y-4">
            {movements.map((movement) => (
              <li
                key={`${movement.lower_competition_id}>${movement.upper_competition_id}:${movement.season}`}
                className="rounded-lg p-3 ring-1 ring-foreground/10"
              >
                <p className="font-heading text-sm font-bold uppercase tracking-wide">
                  {t("endOfSeason.ladder.between", {
                    upper: movement.upper_competition_name,
                    lower: movement.lower_competition_name,
                  })}
                </p>
                {movement.status === "Applied" ? (
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    <MovementTeams
                      teams={teams}
                      refs={movement.promoted}
                      direction="up"
                      league={movement.upper_competition_name}
                      userTeamId={userTeamId}
                    />
                    <MovementTeams
                      teams={teams}
                      refs={movement.relegated}
                      direction="down"
                      league={movement.lower_competition_name}
                      userTeamId={userTeamId}
                    />
                  </div>
                ) : (
                  <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                    <Minus aria-hidden="true" className="size-4" />
                    {t(
                      movement.status === "SkippedLate"
                        ? "endOfSeason.ladder.skippedLate"
                        : "endOfSeason.ladder.noEligible",
                    )}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      </CardContent>
    </Card>
  );
}
