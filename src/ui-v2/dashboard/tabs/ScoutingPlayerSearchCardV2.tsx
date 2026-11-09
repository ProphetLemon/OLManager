import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, ScanSearch, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { PlayerData, TeamData } from "@/store/gameStore";
import { countryName } from "@/lib/common/countries";
import { calcAge, formatVal, getTeamName } from "@/lib/common/helpers";
import { resolvePlayerPhoto } from "@/lib/players/playerPhotos";
import { ROLE_ICON_PATHS } from "@/lib/players/roleIcons";
import { getLolRoleForPlayer, type LolRole } from "@/lib/squad/helpers";
import { Card, CardContent, CardHeader } from "@/ui-v2/components/ui/card";
import { Badge } from "@/ui-v2/components/ui/badge";
import { cn } from "@/ui-v2/lib/utils";

interface ScoutingPlayerSearchCardV2Props {
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

const POSITION_FILTERS = ["All", "TOP", "JUNGLE", "MID", "ADC", "SUPPORT"];

type SortKey = "name" | "position" | "age" | "team" | "value";

export default function ScoutingPlayerSearchCardV2({
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
}: ScoutingPlayerSearchCardV2Props) {
  const { t, i18n } = useTranslation();
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortAsc, setSortAsc] = useState(false);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      if (sortAsc) { setSortKey(null); setSortAsc(false); }
      else { setSortAsc(true); }
    } else { setSortKey(key); setSortAsc(false); }
  };

  const sortedPlayers = useMemo(() => {
    if (!sortKey) return players;
    const factor = sortAsc ? 1 : -1;
    return [...players].sort((a, b) => {
      switch (sortKey) {
        case "name": return a.match_name.localeCompare(b.match_name) * factor;
        case "position": {
          const order: Record<string, number> = { TOP: 1, JUNGLE: 2, MID: 3, ADC: 4, SUPPORT: 5 };
          return ((order[getLolRoleForPlayer(a)] ?? 0) - (order[getLolRoleForPlayer(b)] ?? 0)) * factor;
        }
        case "age": return (calcAge(a.date_of_birth, currentDate) - calcAge(b.date_of_birth, currentDate)) * factor;
        case "team": return getTeamName(teams, a.team_id).localeCompare(getTeamName(teams, b.team_id)) * factor;
        case "value": return (a.market_value - b.market_value) * factor;
        default: return 0;
      }
    });
  }, [players, sortKey, sortAsc, teams]);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <span className="font-heading text-sm uppercase tracking-widest text-muted-foreground">
          {t("scouting.findPlayers")}
        </span>
        <div className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/30 p-1">
          {POSITION_FILTERS.map((position) => (
            <button
              key={position}
              type="button"
              onClick={() => onPositionFilterChange(position)}
              className={cn(
                "rounded-md px-2 py-1 text-2xs font-heading font-bold uppercase tracking-wider transition-colors",
                posFilter === position
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {position === "All" ? t("common.all") : position}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {/* Search */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder={t("scouting.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            className="w-full rounded-lg border border-border bg-muted/30 py-2 pl-9 pr-4 text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50"
          />
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border text-2xs uppercase tracking-widest text-muted-foreground">
                <th className="w-12 px-2 py-2.5 font-heading font-bold" />
                <th className="cursor-pointer px-2 py-2.5 font-heading font-bold hover:text-foreground" onClick={() => toggleSort("name")}>
                  <span className="flex items-center gap-1">{t("scouting.player")}<SortIcon sortKey={sortKey} asc={sortAsc} thisKey="name" /></span>
                </th>
                <th className="w-10 cursor-pointer px-1 py-2.5 text-center font-heading font-bold hover:text-foreground" onClick={() => toggleSort("position")}>
                  {t("scouting.pos")}<SortIcon sortKey={sortKey} asc={sortAsc} thisKey="position" />
                </th>
                <th className="w-12 cursor-pointer px-1 py-2.5 text-center font-heading font-bold hover:text-foreground" onClick={() => toggleSort("age")}>
                  {t("scouting.age")}<SortIcon sortKey={sortKey} asc={sortAsc} thisKey="age" />
                </th>
                <th className="cursor-pointer px-1 py-2.5 font-heading font-bold hover:text-foreground" onClick={() => toggleSort("team")}>
                  {t("scouting.team")}<SortIcon sortKey={sortKey} asc={sortAsc} thisKey="team" />
                </th>
                <th className="w-16 cursor-pointer px-1 py-2.5 text-center font-heading font-bold hover:text-foreground" onClick={() => toggleSort("value")}>
                  {t("scouting.value")}<SortIcon sortKey={sortKey} asc={sortAsc} thisKey="value" />
                </th>
                <th className="w-24 px-2 py-2.5 text-right font-heading font-bold">{t("scouting.action")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {sortedPlayers.map((player) => {
                const isScouting = alreadyScoutingIds.has(player.id);
                const team = player.team_id ? getTeamName(teams, player.team_id) : t("common.freeAgent");
                const lolRole = getLolRoleForPlayer(player) as LolRole;
                const photoUrl = resolvePlayerPhoto(player.id, player.match_name, player.profile_image_url);

                return (
                  <tr key={player.id} className="transition-colors hover:bg-muted/20">
                    <td className="px-2 py-2.5">
                      {photoUrl ? (
                        <img src={photoUrl} alt={player.match_name} className="size-8 rounded-full object-cover" />
                      ) : (
                        <div className="flex size-8 items-center justify-center rounded-full bg-muted font-heading text-xs font-bold text-muted-foreground">
                          {player.match_name?.charAt(0)?.toUpperCase() ?? "?"}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2.5">
                      <button
                        type="button"
                        onClick={() => onSelectPlayer?.(player.id)}
                        className="text-left font-heading text-sm font-bold text-foreground hover:text-club-text transition-colors"
                      >
                        {player.match_name}
                      </button>
                      <p className="text-2xs text-muted-foreground">{player.full_name}</p>
                      <p className="mt-0.5 text-2xs text-muted-foreground/60">
                        {countryName(player.nationality, i18n.language)}
                      </p>
                    </td>
                    <td className="px-1 py-2.5 text-center">
                      <img
                        src={ROLE_ICON_PATHS[lolRole] ?? ROLE_ICON_PATHS.MID}
                        alt={lolRole}
                        className="mx-auto size-5 object-contain"
                        title={lolRole}
                      />
                    </td>
                    <td className="px-1 py-2.5 text-center font-heading text-xs tabular-nums text-muted-foreground">
                      {calcAge(player.date_of_birth, currentDate)}
                    </td>
                    <td className="max-w-[120px] truncate px-1 py-2.5 text-xs text-muted-foreground">
                      {team}
                    </td>
                    <td className="px-1 py-2.5 text-center font-heading text-xs tabular-nums text-muted-foreground">
                      {formatVal(player.market_value)}
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      {isScouting ? (
                        <Badge variant="outline" className="text-2xs text-club-text">{t("scouting.scoutingBadge")}</Badge>
                      ) : availableScoutCount === 0 ? (
                        <span className="text-2xs text-muted-foreground/60">{t("scouting.noScoutsFree")}</span>
                      ) : (
                        <button
                          type="button"
                          disabled={sendingPlayerId === player.id}
                          onClick={() => onSendScout(player.id)}
                          className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 text-2xs font-heading font-bold uppercase tracking-wider text-club-text transition-colors hover:bg-primary/20 disabled:opacity-50"
                        >
                          <ScanSearch className="size-3" />
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
            <p className="py-8 text-center text-sm text-muted-foreground">{t("scouting.noPlayersFound")}</p>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
            <span className="text-2xs text-muted-foreground">
              {t("scouting.showingRange", { from: safePage * pageSize + 1, to: Math.min((safePage + 1) * pageSize, totalPlayers), total: totalPlayers })}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label={t("common.previousPage")}
                disabled={safePage === 0}
                onClick={onPreviousPage}
                className="inline-flex size-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"
              >
                <ChevronLeft className="size-3.5" />
              </button>
              <span className="font-heading text-xs tabular-nums text-muted-foreground">
                {safePage + 1}/{totalPages}
              </span>
              <button
                type="button"
                aria-label={t("common.nextPage")}
                disabled={safePage >= totalPages - 1}
                onClick={onNextPage}
                className="inline-flex size-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"
              >
                <ChevronRight className="size-3.5" />
              </button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SortIcon({ sortKey, asc, thisKey }: { sortKey: SortKey | null; asc: boolean; thisKey: SortKey }) {
  if (sortKey !== thisKey) return <ArrowUpDown className="ml-0.5 inline size-3 text-muted-foreground/40" />;
  return asc
    ? <ArrowUp className="ml-0.5 inline size-3 text-club-text" />
    : <ArrowDown className="ml-0.5 inline size-3 text-club-text" />;
}
