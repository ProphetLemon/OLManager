import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Building2, Calendar, ChevronLeft, ChevronRight, Globe, ListOrdered, Search, Users } from "lucide-react";

import type { GameStateData, LeagueData } from "@/store/gameStore";
import { compareStandingsByLolScore, getStandingKillDiff } from "@/store/gameStore";
import { getTeamLogoPath } from "@/lib/schedule/helpers";
import { resolvePlayerPhoto } from "@/lib/players/playerPhotos";
import { calculateLolOvr } from "@/lib/players/lolPlayerStats";
import { listCompetitionLeagues } from "@/lib/world/leagueGroups";
import { cn } from "@/ui-v2/lib/utils";
import ScheduleCalendarView from "@/ui-v2/_legacy/components/schedule/ScheduleCalendarView";
import type { StoredFixtureDraftResult } from "@/lib/schedule/helpers";

interface Props { gameState: GameStateData; onSelectTeam?: (id: string) => void }
type View = "standings" | "calendar" | "teams" | "players";

const REGION_GRADIENT: Record<string, string> = {
  lec: "from-blue-600 to-blue-900", lcs: "from-red-600 to-red-900",
  lck: "from-green-600 to-green-900", lpl: "from-amber-600 to-amber-900",
  lcp: "from-purple-600 to-purple-900", cblol: "from-emerald-600 to-emerald-900",
};

const TEAM_PAGE_SIZE = 24;
const PLAYER_PAGE_SIZE = 50;

export function CompetitionsTabV2({ gameState, onSelectTeam }: Props) {
  const { t } = useTranslation();
  const [selectedCid, setSelectedCid] = useState<string | null>(null);
  const [view, setView] = useState<View>("standings");
  const [teamPage, setTeamPage] = useState(0);
  const [playerPage, setPlayerPage] = useState(0);
  const [playerSearch, setPlayerSearch] = useState("");
  const [teamSearch, setTeamSearch] = useState("");
  const [visible, setVisible] = useState(false);
  useEffect(() => setVisible(true), []);

  const leagues = useMemo(() => listCompetitionLeagues(gameState.leagues ?? []), [gameState.leagues]);
  const selectedLeague = selectedCid ? leagues.find((l) => (l.competition_id ?? l.id) === selectedCid) ?? null : null;
  const selectedTeamIds = selectedCid ? gameState.teams.filter((t) => t.competition_id === selectedCid).map((t) => t.id) : [];
  const selectedPlayers = selectedTeamIds.length > 0 ? gameState.players.filter((p) => p.team_id != null && selectedTeamIds.includes(p.team_id)) : [];
  const sortedStandings = selectedLeague ? [...selectedLeague.standings].sort(compareStandingsByLolScore) : [];
  const calendarFixtures = selectedLeague ? selectedLeague.fixtures ?? [] : leagues.flatMap((l) => l.fixtures ?? []);
  const compLabelMap = new Map<string, string>();
  leagues.forEach((l) => (l.fixtures ?? []).forEach((f) => compLabelMap.set(f.id, l.name)));

  const filteredTeams = useMemo(() => {
    const q = teamSearch.toLowerCase().trim();
    return q ? selectedTeamIds.filter((id) => gameState.teams.find((t) => t.id === id)?.name.toLowerCase().includes(q)) : selectedTeamIds;
  }, [selectedTeamIds, teamSearch, gameState.teams]);

  const filteredPlayers = useMemo(() => {
    const q = playerSearch.toLowerCase().trim();
    return q ? selectedPlayers.filter((p) => p.match_name.toLowerCase().includes(q) || p.full_name.toLowerCase().includes(q)) : selectedPlayers;
  }, [selectedPlayers, playerSearch]);

  const teamTotalPages = Math.max(1, Math.ceil(filteredTeams.length / TEAM_PAGE_SIZE));
  const playerTotalPages = Math.max(1, Math.ceil(filteredPlayers.length / PLAYER_PAGE_SIZE));

  const cid = selectedCid;
  const region = cid ? Object.keys(REGION_GRADIENT).find((k) => cid.includes(k) || k === cid) ?? null : null;

  return (
    <div className="competitions-v2 flex h-full flex-col overflow-hidden">
      {/* ─── League selector pills ─── */}
      <div className="sticky top-0 z-10 border-b border-border bg-background/80 px-6 py-3 backdrop-blur-sm">
        <div className="flex items-center gap-2 mb-3">
          <Globe className="size-5 text-primary" />
          <h2 className="font-heading text-lg font-bold uppercase tracking-wider text-foreground">{t("competitions.title", "Competiciones")}</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {leagues.map((league) => {
            const lcid = league.competition_id ?? league.id;
            const sel = selectedCid === lcid;
            const fixtures = league.fixtures ?? [];
            const played = fixtures.filter((f) => f.status === "Completed").length;
            return (
              <button key={league.id} type="button" onClick={() => { setSelectedCid(sel ? null : lcid); setView("standings"); }}
                className={cn(
                  "flex items-center gap-2.5 rounded-xl border px-4 py-2.5 text-left transition-all",
                  sel
                    ? "border-primary/50 bg-primary/10 shadow-sm shadow-primary/10"
                    : "border-border bg-card hover:border-primary/30",
                )}>
                <div className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                  <CompetitionLogo league={league} cid={lcid} />
                </div>
                <div>
                  <p className={cn("font-heading text-xs font-bold uppercase tracking-wide", sel ? "text-primary" : "text-foreground")}>{league.name}</p>
                  <p className="text-2xs text-muted-foreground/60">S{league.season} · {played}/{fixtures.length}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── Selected league hero ─── */}
      {selectedLeague && (
        <div className={cn(
          "relative overflow-hidden px-6 py-6",
          region ? `bg-gradient-to-br ${REGION_GRADIENT[region]}` : "bg-gradient-to-br from-muted to-muted/50",
          visible && "animate-fade-in-up",
        )}>
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,white,transparent_70%)] opacity-[0.07]" />
          <div className="relative z-10 flex flex-wrap items-end justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border-2 border-white/20 bg-black/30 shadow-xl backdrop-blur">
                <CompetitionLogo league={selectedLeague} cid={cid!} />
              </div>
              <div>
                <h3 className="font-heading text-2xl font-black uppercase tracking-wide text-white drop-shadow-lg">
                  {selectedLeague.name}
                </h3>
                <p className="flex items-center gap-3 text-sm text-white/70">
                  <span>{t("competitions.heroSeason", { season: selectedLeague.season })}</span>
                  <span>·</span>
                  <span>{t("competitions.heroTeams", { count: selectedTeamIds.length })}</span>
                  <span>·</span>
                  <span>{t("competitions.heroMatches", { count: (selectedLeague.fixtures ?? []).length })}</span>
                </p>
              </div>
            </div>
            {/* View tabs */}
            <div className="flex gap-1.5 rounded-xl border border-white/15 bg-black/30 p-1 backdrop-blur">
              {(["standings", "calendar", "teams", "players"] as const).map((v) => (
                <button key={v} type="button" onClick={() => setView(v)}
                  className={cn("flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                    view === v ? "bg-white/20 text-white shadow-sm" : "text-white/60 hover:text-white hover:bg-white/10")}>
                  {v === "standings" && <ListOrdered className="size-3.5" />}
                  {v === "calendar" && <Calendar className="size-3.5" />}
                  {v === "teams" && <Building2 className="size-3.5" />}
                  {v === "players" && <Users className="size-3.5" />}
                  {v === "standings" && t("competitions.viewStandings")}
                  {v === "calendar" && t("schedule.calendar")}
                  {v === "teams" && t("competitions.viewTeams", { count: selectedTeamIds.length })}
                  {v === "players" && t("competitions.viewPlayers", { count: selectedPlayers.length })}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ─── Content ─── */}
      <div className="flex-1 overflow-y-auto p-6">
        {selectedLeague ? (
          <>
            {/* STANDINGS */}
            {view === "standings" && (
              <div className="overflow-hidden rounded-xl border border-border">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-border bg-muted/30 text-2xs uppercase tracking-widest text-muted-foreground">
                      <th className="w-10 px-4 py-3 font-heading font-bold">{t("competitions.tableHeader.pos")}</th>
                      <th className="px-4 py-3 font-heading font-bold">{t("competitions.tableHeader.team")}</th>
                      <th className="px-3 py-3 text-center font-heading font-bold">{t("competitions.tableHeader.played")}</th>
                      <th className="px-3 py-3 text-center font-heading font-bold">{t("competitions.tableHeader.wins")}</th>
                      <th className="px-3 py-3 text-center font-heading font-bold">{t("competitions.tableHeader.losses")}</th>
                      <th className="hidden px-3 py-3 text-center font-heading font-bold md:table-cell">{t("competitions.tableHeader.mapsWon")}</th>
                      <th className="hidden px-3 py-3 text-center font-heading font-bold md:table-cell">{t("competitions.tableHeader.mapsLost")}</th>
                      <th className="px-3 py-3 text-center font-heading font-bold">{t("competitions.tableHeader.diff")}</th>
                      <th className="hidden w-24 px-3 py-3 text-center font-heading font-bold lg:table-cell">{t("competitions.tableHeader.wr")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {sortedStandings.map((entry, idx) => {
                      const team = gameState.teams.find((t) => t.id === entry.team_id);
                      const logo = team ? getTeamLogoPath(gameState.teams, team.id) : null;
                      const diff = getStandingKillDiff(entry);
                      const isUser = team?.id === gameState.manager.team_id;
                      const wr = entry.played > 0 ? Math.round((entry.won / entry.played) * 100) : 0;
                      const isTop3 = idx < 3;
                      return (
                        <tr key={entry.team_id} onClick={() => onSelectTeam?.(entry.team_id)}
                          className={cn("cursor-pointer transition-colors hover:bg-muted/20", isUser && "bg-primary/5")}>
                          <td className="px-4 py-3">
                            <span className={cn(
                              "flex size-6 items-center justify-center rounded-md font-heading text-xs font-bold tabular-nums",
                              isTop3 ? "text-foreground" : "text-muted-foreground",
                              idx === 0 ? "bg-amber-500/15 text-amber-400" : idx === 1 ? "bg-zinc-500/15 text-zinc-300" : idx === 2 ? "bg-orange-600/15 text-orange-400" : "",
                            )}>{idx + 1}</span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              {logo && <img src={logo} alt="" className="size-5 object-contain" />}
                              <span className={cn("text-sm", isUser ? "font-bold text-primary" : "font-medium text-foreground")}>
                                {team?.name ?? entry.team_id}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-center text-xs tabular-nums text-muted-foreground">{entry.played}</td>
                          <td className="px-3 py-3 text-center text-xs tabular-nums text-positive font-medium">{entry.won}</td>
                          <td className="px-3 py-3 text-center text-xs tabular-nums text-negative font-medium">{entry.lost}</td>
                          <td className="hidden px-3 py-3 text-center text-xs tabular-nums text-muted-foreground md:table-cell">{entry.maps_won ?? entry.kills_for ?? 0}</td>
                          <td className="hidden px-3 py-3 text-center text-xs tabular-nums text-muted-foreground md:table-cell">{entry.maps_lost ?? entry.kills_against ?? 0}</td>
                          <td className={cn("px-3 py-3 text-center text-xs tabular-nums font-medium", diff >= 0 ? "text-positive" : "text-negative")}>{diff >= 0 ? "+" : ""}{diff}</td>
                          <td className="hidden px-3 py-3 lg:table-cell">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-full max-w-16 overflow-hidden rounded-full bg-muted">
                                <div className="h-full rounded-full" style={{ width: `${wr}%`, backgroundColor: wr >= 50 ? "#34d399" : "#f87171" }} />
                              </div>
                              <span className="text-xs tabular-nums font-medium" style={{ color: wr >= 50 ? "#34d399" : "#f87171" }}>{wr}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {sortedStandings.length === 0 && (
                      <tr><td colSpan={9} className="py-12 text-center text-sm text-muted-foreground">{t("competitions.noStandings")}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* CALENDAR */}
            {view === "calendar" && (
              <div className="schedule-calendar-container">
                <ScheduleCalendarView
                  gameState={gameState} fixtures={calendarFixtures}
                  competitionLabelMap={compLabelMap}
                  onOpenFixtureResult={(_s: StoredFixtureDraftResult) => {}} />
              </div>
            )}

            {/* TEAMS */}
            {view === "teams" && (
              <div className="flex flex-col gap-4">
                {selectedTeamIds.length > 1 && (
                  <div className="relative max-w-xs">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
                    <input type="text" value={teamSearch} onChange={(e) => { setTeamSearch(e.target.value); setTeamPage(0); }}
                      placeholder={t("competitions.searchTeam")} className="h-8 w-full rounded-lg border border-border bg-muted/30 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground/40" />
                  </div>
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredTeams.slice(teamPage * TEAM_PAGE_SIZE, (teamPage + 1) * TEAM_PAGE_SIZE).map((id) => {
                    const team = gameState.teams.find((t) => t.id === id);
                    if (!team) return null;
                    const logo = getTeamLogoPath(gameState.teams, team.id);
                    return (
                      <button key={team.id} type="button" onClick={() => onSelectTeam?.(team.id)}
                        className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
                        {logo && <img src={logo} alt={team.name} className="size-10 shrink-0 rounded-lg border border-border bg-muted p-1 object-contain" />}
                        <div className="min-w-0">
                          <h4 className="truncate font-heading text-sm font-bold uppercase tracking-wide text-foreground">{team.name}</h4>
                          <p className="text-xs text-muted-foreground">{team.short_name}</p>
                        </div>
                      </button>
                    );
                  })}
                  {filteredTeams.length === 0 && (
                    <p className="col-span-full py-12 text-center text-sm text-muted-foreground">
                      {teamSearch ? t("competitions.noTeamsMatch") : t("competitions.noTeams")}
                    </p>
                  )}
                </div>
                {teamTotalPages > 1 && (
                  <div className="flex items-center justify-center gap-3">
                    <button disabled={teamPage === 0} onClick={() => setTeamPage(teamPage - 1)}
                      className="flex size-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30">
                      <ChevronLeft className="size-4" />
                    </button>
                    <span className="font-heading text-xs font-bold tabular-nums text-muted-foreground">{teamPage + 1} / {teamTotalPages}</span>
                    <button disabled={teamPage >= teamTotalPages - 1} onClick={() => setTeamPage(teamPage + 1)}
                      className="flex size-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30">
                      <ChevronRight className="size-4" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* PLAYERS */}
            {view === "players" && (
              <div className="flex flex-col gap-4">
                {selectedPlayers.length > 1 && (
                  <div className="relative max-w-xs">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
                    <input type="text" value={playerSearch} onChange={(e) => { setPlayerSearch(e.target.value); setPlayerPage(0); }}
                      placeholder={t("competitions.searchPlayer")} className="h-8 w-full rounded-lg border border-border bg-muted/30 pl-8 pr-3 text-xs text-foreground" />
                  </div>
                )}
                <div className="overflow-hidden rounded-xl border border-border">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-border bg-muted/30 text-2xs uppercase tracking-widest text-muted-foreground">
                        <th className="px-4 py-3 font-heading font-bold">{t("competitions.tableHeader.player")}</th>
                        <th className="px-4 py-3 font-heading font-bold">{t("competitions.tableHeader.role")}</th>
                        <th className="px-4 py-3 font-heading font-bold">{t("competitions.tableHeader.team")}</th>
                        <th className="px-4 py-3 text-center font-heading font-bold">{t("competitions.tableHeader.ovr")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {filteredPlayers.slice(playerPage * PLAYER_PAGE_SIZE, (playerPage + 1) * PLAYER_PAGE_SIZE).map((player) => {
                        const team = gameState.teams.find((t) => t.id === player.team_id);
                        const ovr = calculateLolOvr(player);
                        const photo = resolvePlayerPhoto(player.id, player.match_name, player.profile_image_url);
                        return (
                          <tr key={player.id} className="transition-colors hover:bg-muted/20">
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-2.5">
                                {photo && <img src={photo} alt={player.match_name} className="size-7 rounded-full object-cover" />}
                                <div>
                                  <p className="text-sm font-medium text-foreground">{player.match_name}</p>
                                  <p className="text-caption text-muted-foreground">{player.full_name}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-2.5">
                              <span className="inline-flex items-center rounded-md border border-border bg-card px-1.5 py-0.5 font-heading text-2xs font-bold uppercase tracking-wider text-muted-foreground">
                                {player.position}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-sm text-muted-foreground">{team?.name ?? "FA"}</td>
                            <td className="px-4 py-2.5 text-center font-heading text-sm font-bold tabular-nums"
                              style={{ color: ovr >= 75 ? "#fb923c" : ovr >= 60 ? "#fbbf24" : "#94a3b8" }}>{ovr}</td>
                          </tr>
                        );
                      })}
                      {filteredPlayers.length === 0 && (
                        <tr><td colSpan={4} className="py-12 text-center text-sm text-muted-foreground">
                          {playerSearch ? t("competitions.noPlayersMatch") : t("competitions.noPlayers")}
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {playerTotalPages > 1 && (
                  <div className="flex items-center justify-center gap-3">
                    <button disabled={playerPage === 0} onClick={() => setPlayerPage(playerPage - 1)}
                      className="flex size-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30">
                      <ChevronLeft className="size-4" />
                    </button>
                    <span className="font-heading text-xs font-bold tabular-nums text-muted-foreground">{playerPage + 1} / {playerTotalPages}</span>
                    <button disabled={playerPage >= playerTotalPages - 1} onClick={() => setPlayerPage(playerPage + 1)}
                      className="flex size-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30">
                      <ChevronRight className="size-4" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center py-20">
            <div className="text-center">
              <Globe className="mx-auto mb-3 size-12 text-muted-foreground/15" />
              <p className="font-heading text-sm uppercase tracking-wider text-muted-foreground/50">
                {t("competitions.selectPrompt")}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CompetitionLogo({ league, cid }: { league: LeagueData; cid: string }) {
  const src = league.logo ?? `/competitions-icons/${cid}.webp`;
  return <img src={src} alt={league.name} className="size-full object-contain p-1" onError={(e) => { e.currentTarget.style.display = "none"; }} />;
}
