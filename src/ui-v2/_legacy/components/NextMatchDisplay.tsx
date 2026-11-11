import { resolveUserLeague } from "@/lib/userLeague";
import { useTranslation } from "react-i18next";
import { Fragment } from "react";


import { GameStateData } from "@/store/gameStore";
import { Badge } from "@/ui-v2/_legacy/components/ui";
import { parseUtcDate } from "@/lib/formatting/dateFormatting";
import {
  findNextFixture,
  formatMatchDate,
  getTeamName,
  getTeamShort,
  isSeasonComplete,
} from "@/lib/common/helpers";
import { calculateLolOvr } from "@/lib/players/lolPlayerStats";
import { resolvePlayerPhoto } from "@/lib/players/playerPhotos";

type DraftRole = "TOP" | "JUNGLE" | "MID" | "ADC" | "SUPPORT";

export const ROLE_ORDER: DraftRole[] = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"];

export function playerPhotoUrl(
  playerId: string,
  matchName?: string,
  profileImageUrl?: string | null,
): string | null {
  return resolvePlayerPhoto(playerId, matchName, profileImageUrl);
}

export function daysUntil(dateIso: string): number {
  const now = new Date();
  const nowUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const target = parseUtcDate(dateIso);
  if (!target) return 0;
  const diffMs = target.getTime() - nowUtc.getTime();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

export function getLineupByRole(gameState: GameStateData, teamId: string) {
  const teamPlayers = gameState.players.filter((player) => player.team_id === teamId);

  const lineup = ROLE_ORDER.map((role) => {
    const candidates = teamPlayers
      .filter((player) => player.position === role || player.natural_position === role)
      .sort((a, b) => calculateLolOvr(b) - calculateLolOvr(a));

    return candidates[0] ?? null;
  });

  if (lineup.some((p) => p !== null)) return lineup;

  const sorted = [...teamPlayers].sort((a, b) => calculateLolOvr(b) - calculateLolOvr(a));
  const top5 = sorted.slice(0, 5);
  return ROLE_ORDER.map((_, i) => top5[i] ?? null);
}

export function teamLineupOvr(lineup: Array<GameStateData["players"][number] | null>): number {
  const values = lineup
    .map((player) => {
      if (!player) return null;
      return calculateLolOvr(player);
    })
    .filter((value): value is number => typeof value === "number");

  if (values.length === 0) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1));
}

export default function NextMatchDisplay({
  gameState,
}: {
  gameState: GameStateData;
}) {
  const { t } = useTranslation();
  const userTeamId = gameState.manager.team_id;
  const playerLeague = resolveUserLeague(gameState);

  if (!userTeamId || !playerLeague) {
    return (
      <p className="text-gray-500 dark:text-gray-400 text-sm text-center py-4">
        {t("home.noLeagueSchedule")}
      </p>
    );
  }

  const nextFixture = findNextFixture(playerLeague.fixtures, userTeamId);
  if (!nextFixture) {
    return (
      <p className="text-gray-500 dark:text-gray-400 text-sm text-center py-4">
        {t(
          isSeasonComplete(playerLeague)
            ? "home.seasonComplete"
            : "home.noUpcomingOpponent",
        )}
      </p>
    );
  }

  const isHome = nextFixture.home_team_id === userTeamId;
  const opponentId = isHome
    ? nextFixture.away_team_id
    : nextFixture.home_team_id;
  const fixtureLabel =
    nextFixture.match_type === "League"
      ? t("home.matchdayN", { n: nextFixture.matchday })
      : nextFixture.match_type === "PreseasonTournament"
        ? t("season.preseasonTournament")
        : t("season.friendly");

  const homeLineup = getLineupByRole(gameState, nextFixture.home_team_id);
  const awayLineup = getLineupByRole(gameState, nextFixture.away_team_id);
  const homeOvr = teamLineupOvr(homeLineup);
  const awayOvr = teamLineupOvr(awayLineup);
  const totalOvr = Math.max(1, homeOvr + awayOvr);
  const homePct = (homeOvr / totalOvr) * 100;
  const awayPct = 100 - homePct;
  const countdown = daysUntil(nextFixture.date);

  return (
    <div className="flex flex-col gap-3 py-3 px-2 bg-gray-50 dark:bg-navy-800 rounded-lg border border-gray-100 dark:border-navy-600 transition-colors">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <p className="font-heading font-bold text-gray-800 dark:text-gray-100 truncate">
            {getTeamShort(gameState.teams, nextFixture.home_team_id)}
            <span className="text-gray-400 dark:text-gray-500 mx-1">{t("common.vs")}</span>
            {getTeamShort(gameState.teams, nextFixture.away_team_id)}
          </p>
          <Badge variant="neutral" size="sm">{fixtureLabel}</Badge>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {formatMatchDate(nextFixture.date)}
          </span>
        </div>
        <Badge variant={isHome ? "success" : "accent"} size="sm">
          {isHome ? t("home.home") : t("home.away")}
        </Badge>
      </div>

      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2 text-xs">
        <span className="font-heading font-bold text-primary-500">{homeOvr.toFixed(1)}</span>
        <div className="h-1.5 rounded-full bg-navy-700 overflow-hidden flex">
          <div className="h-full bg-primary-500" style={{ width: `${homePct}%` }} />
          <div className="h-full bg-red-500/80" style={{ width: `${awayPct}%` }} />
        </div>
        <span className="font-heading font-bold text-red-400">{awayOvr.toFixed(1)}</span>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] gap-y-1.5 text-xs">
        {ROLE_ORDER.map((role, index) => {
          const homePlayer = homeLineup[index];
          const awayPlayer = awayLineup[index];
          const homePlayerOvr = homePlayer ? calculateLolOvr(homePlayer) : null;
          const awayPlayerOvr = awayPlayer ? calculateLolOvr(awayPlayer) : null;
          const leftPhoto = homePlayer ? playerPhotoUrl(homePlayer.id, homePlayer.match_name, homePlayer.profile_image_url) : null;
          const rightPhoto = awayPlayer ? playerPhotoUrl(awayPlayer.id, awayPlayer.match_name, awayPlayer.profile_image_url) : null;

          return (
            <Fragment key={`line-${role}`}>
              <div className="flex items-center gap-1.5 min-w-0">
                {leftPhoto ? (
                  <img
                    src={leftPhoto}
                    alt={homePlayer?.match_name ?? role}
                    className="w-5 h-5 rounded-full object-cover border border-white/15"
                    loading="lazy"
                  />
                ) : null}
                <span className="truncate text-gray-700 dark:text-gray-200 font-heading font-bold">
                  {homePlayer?.match_name ?? "—"}
                </span>
                {homePlayerOvr !== null && (
                  <span className="text-primary-500 font-heading font-bold">{homePlayerOvr}</span>
                )}
              </div>

              <div className="text-center text-gray-400 dark:text-gray-500 font-heading font-bold">
                {t(`tactics.lol.roles.${role}`, { defaultValue: role })}
              </div>

              <div className="flex items-center justify-end gap-1.5 min-w-0">
                {awayPlayerOvr !== null && (
                  <span className="text-red-400 font-heading font-bold">{awayPlayerOvr}</span>
                )}
                <span className="truncate text-right text-gray-700 dark:text-gray-200 font-heading font-bold">
                  {awayPlayer?.match_name ?? "—"}
                </span>
                {rightPhoto ? (
                  <img
                    src={rightPhoto}
                    alt={awayPlayer?.match_name ?? role}
                    className="w-5 h-5 rounded-full object-cover border border-white/15"
                    loading="lazy"
                  />
                ) : null}
              </div>
            </Fragment>
          );
        })}
      </div>

      <div className="flex items-center justify-end">
        <div className="px-2.5 py-1 rounded-md bg-navy-900/70 border border-navy-600 text-right">
          <p className="font-heading font-bold text-gray-100 text-base leading-none">{countdown}d</p>
          <p className="text-2xs text-gray-400 leading-none mt-1">
            {t("home.daysUntilMatch")}
          </p>
        </div>
      </div>

      <div className="sr-only">
        {getTeamName(gameState.teams, nextFixture.home_team_id)}
        {getTeamName(gameState.teams, opponentId)}
      </div>
    </div>
  );
}

