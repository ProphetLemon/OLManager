import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, ScanSearch, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { countryName } from "@/lib/common/countries";
import { calcAge, formatVal, getTeamName } from "@/lib/common/helpers";
import type { PlayerData, TeamData } from "@/store/gameStore";
import { Card, CardBody, CardHeader, CountryFlag } from "@/ui-v2/_legacy/components/ui";
import { getLolRoleForPlayer } from "@/ui-v2/_legacy/components/squad/SquadTab.helpers";
import { resolvePlayerPhoto } from "@/lib/players/playerPhotos";
import { ROLE_ICON_PATHS } from "@/lib/players/roleIcons";

const POSITION_FILTERS = ["All", "TOP", "JUNGLE", "MID", "ADC", "SUPPORT"];

const LOL_ROLE_ICON_URLS: Record<string, string> = {
  TOP: ROLE_ICON_PATHS.TOP,
  JUNGLE: ROLE_ICON_PATHS.JUNGLE,
  MID: ROLE_ICON_PATHS.MID,
  ADC: ROLE_ICON_PATHS.ADC,
  SUPPORT: ROLE_ICON_PATHS.SUPPORT,
};

interface ScoutingPlayerSearchCardProps {
  players: PlayerData[];
  teams: TeamData[];
  currentDate: string;
  posFilter: string;
  searchQuery: string;
  alreadyScoutingIds: Set<string>;
  availableScoutCount: number;
  sendingPlayerId: string | null;
  safePage: number;
  totalPages: number;
  totalPlayers: number;
  pageSize: number;
  onPositionFilterChange: (position: string) => void;
  onSearchQueryChange: (query: string) => void;
  onSelectPlayer?: (id: string) => void;
  onSendScout: (playerId: string) => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
}

export default function ScoutingPlayerSearchCard({
  players,
  teams,
  currentDate,
  posFilter,
  searchQuery,
  alreadyScoutingIds,
  availableScoutCount,
  sendingPlayerId,
  safePage,
  totalPages,
  totalPlayers,
  pageSize,
  onPositionFilterChange,
  onSearchQueryChange,
  onSelectPlayer,
  onSendScout,
  onPreviousPage,
  onNextPage,
}: ScoutingPlayerSearchCardProps) {
  const { t, i18n } = useTranslation();

  type SortKey = "name" | "position" | "age" | "team" | "value";
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortAsc, setSortAsc] = useState(false);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      if (sortAsc) {
        setSortKey(null);
        setSortAsc(false);
      } else {
        setSortAsc(true);
      }
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const renderSortIcon = (key: SortKey) => {
    if (sortKey !== key) {
      return <ArrowUpDown className="w-3 h-3 text-gray-300 dark:text-navy-600" />;
    }
    return sortAsc
      ? <ArrowUp className="w-3 h-3 text-primary-500" />
      : <ArrowDown className="w-3 h-3 text-primary-500" />;
  };

  const sortedPlayers = useMemo(() => {
    if (!sortKey) return players;
    const factor = sortAsc ? 1 : -1;
    return [...players].sort((a, b) => {
      switch (sortKey) {
        case "name":
          return a.match_name.localeCompare(b.match_name) * factor;
        case "position": {
          const roleA = getLolRoleForPlayer(a);
          const roleB = getLolRoleForPlayer(b);
          const order: Record<string, number> = { TOP: 1, JUNGLE: 2, MID: 3, ADC: 4, SUPPORT: 5 };
          return ((order[roleA] ?? 0) - (order[roleB] ?? 0)) * factor;
        }
        case "age":
          return (calcAge(a.date_of_birth, currentDate) - calcAge(b.date_of_birth, currentDate)) * factor;
        case "team": {
          const teamA = getTeamName(teams, a.team_id);
          const teamB = getTeamName(teams, b.team_id);
          return teamA.localeCompare(teamB) * factor;
        }
        case "value":
          return (a.market_value - b.market_value) * factor;
        default:
          return 0;
      }
    });
  }, [players, sortKey, sortAsc, teams]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3 w-full">
          <span>{t("scouting.findPlayers")}</span>
          <div className="ml-auto flex items-center gap-2">
            {POSITION_FILTERS.map((position) => (
              <button
                key={position}
                onClick={() => onPositionFilterChange(position)}
                className={`px-2.5 py-1 rounded-lg text-xs font-heading font-bold uppercase tracking-wider transition-colors ${posFilter === position
                    ? "bg-primary-500 text-white"
                    : "bg-gray-100 dark:bg-navy-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-navy-600"
                  }`}
              >
                {position === "All"
                  ? t("common.all")
                  : position}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardBody>
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder={t("scouting.searchPlaceholder")}
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm bg-gray-50 dark:bg-navy-700 border border-gray-200 dark:border-navy-600 rounded-lg text-gray-800 dark:text-gray-100 placeholder:text-gray-400"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 dark:text-gray-400 font-heading uppercase tracking-wider border-b border-gray-100 dark:border-navy-700">
                <th className="text-left py-2 px-2 w-14"></th>
                <th className="text-left py-2 px-2 cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 transition-colors select-none" onClick={() => toggleSort("name")}>
                  <span className="flex items-center gap-1">{t("scouting.player")}{renderSortIcon("name")}</span>
                </th>
                <th className="text-left py-2 px-1 cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 transition-colors select-none" onClick={() => toggleSort("position")}>
                  <span className="flex items-center gap-1">{t("scouting.pos")}{renderSortIcon("position")}</span>
                </th>
                <th className="text-center py-2 px-1 cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 transition-colors select-none" onClick={() => toggleSort("age")}>
                  <span className="flex items-center gap-1">{t("scouting.age")}{renderSortIcon("age")}</span>
                </th>
                <th className="text-left py-2 px-1 cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 transition-colors select-none" onClick={() => toggleSort("team")}>
                  <span className="flex items-center gap-1">{t("scouting.team")}{renderSortIcon("team")}</span>
                </th>
                <th className="text-center py-2 px-1 cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 transition-colors select-none" onClick={() => toggleSort("value")}>
                  <span className="flex items-center gap-1">{t("scouting.value")}{renderSortIcon("value")}</span>
                </th>
                <th className="text-right py-2 px-2">{t("scouting.action")}</th>
              </tr>
            </thead>
            <tbody>
              {sortedPlayers.map((player) => {
                const isScouting = alreadyScoutingIds.has(player.id);
                const team = player.team_id
                  ? getTeamName(teams, player.team_id)
                  : t("common.freeAgent");
                const lolRole = getLolRoleForPlayer(player);
                const photoUrl = resolvePlayerPhoto(player.id, player.match_name, player.profile_image_url);

                return (
                  <tr
                    key={player.id}
                    className="border-b border-gray-50 dark:border-navy-700/50 hover:bg-gray-50 dark:hover:bg-navy-700/30 transition-colors"
                  >
                    <td className="py-2 px-2">
                      {photoUrl ? (
                        <img
                          src={photoUrl}
                          alt={player.match_name}
                          className="w-8 h-8 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-navy-600 flex items-center justify-center text-xs font-heading font-bold text-gray-500 dark:text-gray-400">
                          {player.match_name?.charAt(0)?.toUpperCase() ?? "?"}
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-2">
                      <button
                        onClick={() => onSelectPlayer?.(player.id)}
                        className="font-heading font-bold text-gray-800 dark:text-gray-100 hover:text-primary-500 transition-colors text-left"
                      >
                        {player.match_name}
                      </button>
                      <div className="text-2xs text-gray-500 dark:text-gray-500 mt-0.5 truncate">
                        {player.full_name}
                      </div>
                      <div className="text-2xs text-gray-400 mt-0.5 flex items-center gap-1">
                        <CountryFlag
                          code={player.nationality}
                          locale={i18n.language}
                          className="text-xs leading-none"
                        />
                        <span>{countryName(player.nationality, i18n.language)}</span>
                      </div>
                    </td>
                    <td className="py-2 px-1">
                      <img
                        src={LOL_ROLE_ICON_URLS[lolRole]}
                        alt={lolRole}
                        className="w-5 h-5 object-contain"
                        title={lolRole}
                      />
                    </td>
                    <td className="text-center py-2 px-1 text-gray-600 dark:text-gray-400">
                      {calcAge(player.date_of_birth, currentDate)}
                    </td>
                    <td className="py-2 px-1 text-gray-600 dark:text-gray-400 text-xs truncate max-w-[120px]">
                      {team}
                    </td>
                    <td className="text-center py-2 px-1 text-gray-600 dark:text-gray-400 text-xs">
                      {formatVal(player.market_value)}
                    </td>
                    <td className="text-right py-2 px-2">
                      {isScouting ? (
                        <span className="text-xs text-primary-400 font-heading font-bold">
                          {t("scouting.scoutingInProgress")}
                        </span>
                      ) : availableScoutCount === 0 ? (
                        <span className="text-xs text-gray-400">
                          {t("scouting.noScoutsFree")}
                        </span>
                      ) : (
                        <button
                          disabled={sendingPlayerId === player.id}
                          onClick={() => onSendScout(player.id)}
                          className="flex items-center gap-1 ml-auto px-2.5 py-1 rounded-lg bg-primary-500/10 text-primary-500 hover:bg-primary-500/20 transition-colors text-xs font-heading font-bold uppercase tracking-wider disabled:opacity-50"
                        >
                          <ScanSearch className="w-3 h-3" />
                          {sendingPlayerId === player.id ? "..." : t("scouting.scoutBtn")}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {players.length === 0 && (
            <p className="text-center text-sm text-gray-400 py-4">
              {t("scouting.noPlayersFound")}
            </p>
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-navy-700 mt-3">
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {t("scouting.showingRange", {
                from: safePage * pageSize + 1,
                to: Math.min((safePage + 1) * pageSize, totalPlayers),
                total: totalPlayers,
              })}
            </span>
            <div className="flex items-center gap-2">
              <button
                aria-label="Previous page"
                disabled={safePage === 0}
                onClick={onPreviousPage}
                className="p-1.5 rounded-lg bg-gray-100 dark:bg-navy-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-navy-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs font-heading font-bold text-gray-500 dark:text-gray-400 tabular-nums">
                {safePage + 1} / {totalPages}
              </span>
              <button
                aria-label="Next page"
                disabled={safePage >= totalPages - 1}
                onClick={onNextPage}
                className="p-1.5 rounded-lg bg-gray-100 dark:bg-navy-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-navy-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

