import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Building2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Filter, Search, SortAsc, Swords, Trophy } from "lucide-react";

import type { GameStateData } from "@/store/gameStore";
import { compareStandingsByLolScore } from "@/store/gameStore";
import { getMainTeams } from "@/store/academySelectors";
import { calculateLolOvr } from "@/lib/players/lolPlayerStats";
import { formatVal } from "@/lib/common/helpers";
import { resolveTeamLogo } from "@/lib/teams/teamLogos";
import { CardContent } from "@/ui-v2/components/ui/card";
import { Badge } from "@/ui-v2/components/ui/badge";
import { cn } from "@/ui-v2/lib/utils";

interface Props {
  gameState: GameStateData;
  onSelectTeam: (id: string) => void;
}

type SortKey = "position" | "name" | "ovr" | "value" | "rep" | "wr" | "players";
const PAGE_SIZE = 20;

export function TeamsTabV2({ gameState, onSelectTeam }: Props) {
  const { t } = useTranslation();
  const userTeamId = gameState.manager.team_id;
  const [filter, setFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("position");
  const [asc, setAsc] = useState(true);
  const [page, setPage] = useState(0);

  const allStandings = useMemo(
    () => [...(gameState.leagues?.[0]?.standings ?? [])].sort(compareStandingsByLolScore),
    [gameState.leagues],
  );
  const leagues = useMemo(() => gameState.leagues.map((l) => ({ id: l.competition_id ?? l.id, name: l.name })), [gameState.leagues]);

  const teamsData = useMemo(() => {
    const main = getMainTeams(gameState.teams);
    const byComp = filter ? main.filter((t) => t.competition_id === filter) : main;
    const q = search.toLowerCase().trim();
    const searched = q ? byComp.filter((t) => t.name.toLowerCase().includes(q)) : byComp;
    const mapped = searched.map((team) => {
      const roster = gameState.players.filter((p) => p.team_id === team.id);
      const avgOvr = roster.length > 0 ? Math.round(roster.reduce((s, p) => s + calculateLolOvr(p), 0) / roster.length) : 0;
      const totalValue = roster.reduce((s, p) => s + p.market_value, 0);
      const leaguePos = allStandings.findIndex((s) => s.team_id === team.id) + 1;
      const standing = allStandings.find((s) => s.team_id === team.id);
      const wr = standing && standing.played > 0 ? Math.round((standing.won / standing.played) * 100) : null;
      return { team, roster, avgOvr, totalValue, leaguePos, standing, wr };
    });
    mapped.sort((a, b) => {
      let c = 0;
      if (sort === "name") c = a.team.name.localeCompare(b.team.name);
      else if (sort === "ovr") c = a.avgOvr - b.avgOvr;
      else if (sort === "value") c = a.totalValue - b.totalValue;
      else if (sort === "rep") c = (a.team.reputation ?? 0) - (b.team.reputation ?? 0);
      else if (sort === "wr") c = (a.wr ?? -1) - (b.wr ?? -1);
      else if (sort === "players") c = a.roster.length - b.roster.length;
      else c = a.leaguePos - b.leaguePos;
      return asc ? c : -c;
    });
    return mapped;
  }, [gameState.teams, gameState.players, allStandings, filter, search, sort, asc]);

  const totalPages = Math.max(1, Math.ceil(teamsData.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageData = teamsData.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const toggleSort = (key: SortKey) => {
    if (sort === key) setAsc(!asc);
    else { setSort(key); setAsc(key === "position" || key === "name"); }
    setPage(0);
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-6 scrollbar-v2">
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Swords className="size-5 text-primary" />
          <h2 className="font-heading text-lg font-bold uppercase tracking-wider text-foreground">
            {t("dashboard.teams", "Equipos")}
          </h2>
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-40 max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
          <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder={t("teams.searchPlaceholder")}
            className="h-8 w-full rounded-lg border border-border bg-muted/30 pl-8 pr-3 text-xs text-foreground outline-none placeholder:text-muted-foreground/40 focus:border-primary/50" />
        </div>

        <select value={filter ?? ""} onChange={(e) => { setFilter(e.target.value || null); setPage(0); }}
          className="h-8 rounded-lg border border-border bg-muted/30 px-3 text-xs text-foreground outline-none">
          <option value="">{t("common.all")}</option>
          {leagues.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>

        <span className="text-xs tabular-nums text-muted-foreground/60">{t("teams.nTeams", { count: teamsData.length })}</span>
      </div>

      {/* Sort row */}
      <div className="flex items-center gap-4 border-b border-border pb-2">
        <SortAsc className="size-3.5 text-muted-foreground/50" />
        {[
          { key: "position" as SortKey, labelKey: "teams.colPos" },
          { key: "name" as SortKey, labelKey: "teams.colTeam" },
          { key: "ovr" as SortKey, labelKey: "teams.colOvr" },
          { key: "rep" as SortKey, labelKey: "teams.colRep" },
          { key: "value" as SortKey, labelKey: "teams.colValue" },
          { key: "wr" as SortKey, labelKey: "teams.colWr" },
          { key: "players" as SortKey, labelKey: "teams.colPlayers" },
        ].map(({ key, labelKey }) => {
          const active = sort === key;
          return (
            <button key={key} type="button" onClick={() => toggleSort(key)}
              className={cn(
                "flex items-center gap-1 text-caption font-heading font-bold uppercase tracking-wider transition-colors",
                active ? "text-primary" : "text-muted-foreground/50 hover:text-foreground",
              )}>
              {t(labelKey)}
              {active && (asc ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />)}
            </button>
          );
        })}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {pageData.map(({ team, roster, avgOvr, totalValue, leaguePos, standing, wr }) => {
          const isUser = team.id === userTeamId;
          const logo = resolveTeamLogo(team.name, team.logo_url);
          const hasColor = team.colors?.primary && team.colors.primary !== "#000000";

          return (
            <button key={team.id} type="button" onClick={() => onSelectTeam(team.id)}
              className={cn(
                "group overflow-hidden rounded-xl border-2 bg-card text-left transition-all duration-200",
                isUser
                  ? "border-primary/50 bg-primary/[0.02]"
                  : "border-border hover:border-primary/30 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/5",
              )}>
              {/* Header */}
              <div className={cn("flex items-center gap-4 px-5 py-4",
                hasColor ? "text-white" : "bg-gradient-to-br from-muted/90 to-muted/30 text-foreground",
              )}
                style={hasColor ? { backgroundImage: `linear-gradient(135deg, ${team.colors.primary}, ${team.colors.secondary}40)` } : undefined}>
                <div className={cn("flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl",
                  hasColor ? "border-2 border-white/30" : "border border-border bg-card")}>
                  {logo && <img src={logo} alt={team.name} className="size-10 object-contain" loading="lazy" />}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="flex items-center gap-2 truncate font-heading text-base font-bold uppercase tracking-wide">
                    {team.name}
                    {isUser && <Badge className="text-2xs">{t("teams.yourTeam")}</Badge>}
                  </h3>
                  <p className={cn("mt-0.5 flex items-center gap-1 text-xs", hasColor ? "text-white/70" : "text-muted-foreground")}>
                    <span>{t(`countries.${team.country}`, team.country)}</span>
                    {team.city && <><span>·</span><span>{team.city}</span></>}
                  </p>
                </div>
                {leaguePos > 0 && (
                  <div className={cn("rounded-lg px-3 py-1.5 text-center", hasColor ? "bg-black/20 backdrop-blur" : "bg-muted/50")}>
                    <p className={cn("font-heading text-2xs uppercase tracking-wider", hasColor ? "text-white/60" : "text-muted-foreground/60")}>#{t("common.position")}</p>
                    <p className={cn("font-heading text-xl font-bold", hasColor ? "text-white" : "text-foreground")}>{leaguePos}</p>
                  </div>
                )}
              </div>

              {/* Stats */}
              <div className="grid grid-cols-5 gap-px bg-border">
                <StatCell label={t("teams.statSquad")} value={String(roster.length)} />
                <StatCell label={t("teams.statOvr")} value={String(avgOvr)} />
                <StatCell label={t("teams.statRep")} value={String(team.reputation)} />
                <StatCell label={t("teams.statValue")} value={formatVal(totalValue)} />
                <StatCell label={`${t("common.won")}-${t("common.lost")}`} value={standing ? `${standing.won}-${standing.lost}` : "—"} />
              </div>

              {/* Bottom */}
              <CardContent className="flex items-center gap-4 py-3">
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Building2 className="size-3.5" />{t("teams.hq")} {team.city}
                </span>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Trophy className="size-3.5" />{t("teams.est")} {team.founded_year}
                </span>
                {standing && (
                  <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                    {standing.won}W {standing.lost}L{wr !== null ? ` · ${wr}%` : ""}
                  </span>
                )}
              </CardContent>
            </button>
          );
        })}
        {pageData.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center py-16">
            <Filter className="size-8 text-muted-foreground/20" />
            <p className="mt-2 text-sm text-muted-foreground">{search ? t("teams.noMatch") : t("teams.noTeams")}</p>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <button disabled={safePage === 0} onClick={() => setPage(safePage - 1)}
            className="flex size-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30">
            <ChevronLeft className="size-4" />
          </button>
          <span className="font-heading text-xs font-bold tabular-nums text-muted-foreground">
            {safePage + 1} / {totalPages}
          </span>
          <button disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)}
            className="flex size-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30">
            <ChevronRight className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card px-2 py-2.5 text-center transition-colors group-hover:bg-muted/30">
      <p className="font-heading text-2xs uppercase tracking-wider text-muted-foreground/70">{label}</p>
      <p className="mt-0.5 font-heading text-sm font-bold text-foreground tabular-nums">{value}</p>
    </div>
  );
}
