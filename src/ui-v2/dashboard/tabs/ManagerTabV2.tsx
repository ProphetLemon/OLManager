import { resolveUserLeague } from "@/lib/userLeague";
import { useEffect, useState, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Building2, ChevronDown, Check, ImagePlus, Settings, Trophy, Users } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useGameStore, compareStandingsByLolScore, type GameStateData } from "@/store/gameStore";
import { formatDate, getTeamName } from "@/lib/common/helpers";
import { countryName, allNationalities } from "@/lib/common/countries";
import { CountryFlag } from "@/ui-v2/components/ui/country-flag";
import { resolveTeamLogo } from "@/lib/teams/teamLogos";
import { assetUrl } from "@/lib/assetUrl";
import { calculateLolOvr } from "@/lib/players/lolPlayerStats";
import { MANAGER_ICON_PATHS, DEFAULT_MANAGER_ICON_PATH } from "@/lib/common/managerAvatars";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui-v2/components/ui/card";
import { Badge } from "@/ui-v2/components/ui/badge";
import { cn } from "@/ui-v2/lib/utils";

interface ManagerTabV2Props {
  gameState: GameStateData;
}

export function ManagerTabV2({ gameState }: ManagerTabV2Props) {
  const setGameState = useGameStore((state) => state.setGameState);
  const { t, i18n } = useTranslation();
  const mgr = gameState.manager;
  const myTeam = gameState.teams.find((tm) => tm.id === mgr.team_id);
  const stats = mgr.career_stats;
  const fullName = `${mgr.first_name} ${mgr.last_name}`;
  const displayName = mgr.nickname?.trim() || fullName;

  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [isSavingAvatar, setIsSavingAvatar] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({ nickname: "", firstName: "", lastName: "", dob: "", nationality: "" });
  const [nationalityOpen, setNationalityOpen] = useState(false);
  const [nationalitySearch, setNationalitySearch] = useState("");
  const nationalityRef = useRef<HTMLDivElement>(null);
  const countriesList = allNationalities(i18n.language);
  const filteredNationalities = countriesList.filter((nat) => {
    const s = nationalitySearch.toLowerCase();
    return nat.name.toLowerCase().includes(s) || nat.code.toLowerCase().includes(s);
  });

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!nationalityOpen || !nationalityRef.current) return;
      if (!(e.target instanceof Node) || !nationalityRef.current.contains(e.target)) {
        setNationalityOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [nationalityOpen]);

  const league = resolveUserLeague(gameState);
  const teamPlayers = useMemo(
    () => gameState.players.filter((p) => p.team_id === myTeam?.id),
    [gameState.players, myTeam],
  );
  const teamStaff = useMemo(
    () => gameState.staff.filter((s) => s.team_id === myTeam?.id),
    [gameState.staff, myTeam],
  );
  const avgOvr = useMemo(() => {
    if (teamPlayers.length === 0) return 0;
    return Math.round(teamPlayers.reduce((s, p) => s + calculateLolOvr(p), 0) / teamPlayers.length);
  }, [teamPlayers]);

  const teamPosition = useMemo(() => {
    if (!myTeam || !league?.standings) return null;
    const sorted = [...league.standings].sort(compareStandingsByLolScore);
    const idx = sorted.findIndex((s) => s.team_id === myTeam.id);
    return idx >= 0 ? idx + 1 : null;
  }, [myTeam, league]);

  const recentResults = useMemo(() => {
    if (!myTeam || !league?.fixtures) return [];
    return league.fixtures
      .filter((f) => f.status === "Completed" && (f.home_team_id === myTeam.id || f.away_team_id === myTeam.id))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 5);
  }, [myTeam, league]);

  const totalSeasons = useMemo(
    () => mgr.career_history.length + (stats.matches_managed > 0 ? 1 : 0),
    [mgr.career_history, stats.matches_managed],
  );

  const handleSelectAvatar = async (avatarPath: string) => {
    setIsSavingAvatar(true);
    try {
      await invoke("update_manager_profile", { nickname: null, firstName: null, lastName: null, dob: null, nationality: null, avatarPath });
      setGameState({ ...gameState, manager: { ...mgr, avatar_path: avatarPath } });
      setShowAvatarPicker(false);
    } catch (e) { console.error("Failed to update avatar:", e); }
    finally { setIsSavingAvatar(false); }
  };

  const handleOpenSettings = () => {
    setFormData({ nickname: mgr.nickname || "", firstName: mgr.first_name, lastName: mgr.last_name, dob: mgr.date_of_birth, nationality: mgr.nationality });
    setShowSettings(true);
  };

  const handleSaveSettings = async () => {
    setIsSaving(true);
    try {
      await invoke("update_manager_profile", { nickname: formData.nickname || null, firstName: formData.firstName || null, lastName: formData.lastName || null, dob: formData.dob || null, nationality: formData.nationality || null, avatarPath: null });
      setGameState({ ...gameState, manager: { ...mgr, nickname: formData.nickname || null, first_name: formData.firstName, last_name: formData.lastName, date_of_birth: formData.dob, nationality: formData.nationality } });
      setShowSettings(false);
    } catch (e) {
      console.error("Failed to update profile:", e);
      alert(t("manager.saveError", "Error al guardar: ") + String(e));
    } finally { setIsSaving(false); }
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-6 scrollbar-v2">
      {/* ── Hero ── */}
      <Card>
        <CardContent className="flex flex-col gap-5 p-5 md:flex-row">
          <div className="flex shrink-0 flex-col items-center gap-3 md:w-48">
            <button
              type="button"
              onClick={() => setShowAvatarPicker(true)}
              className="group relative size-24 overflow-hidden rounded-2xl border-2 border-primary/30 bg-muted transition-all hover:border-primary"
              title={t("manager.changeAvatar")}
            >
              <img
                src={assetUrl(mgr.avatar_path ?? DEFAULT_MANAGER_ICON_PATH) ?? ""}
                alt={displayName}
                className="size-full object-cover"
                loading="lazy"
              />
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                <ImagePlus className="size-6 text-white" />
              </div>
            </button>
            <div className="text-center">
              <div className="flex items-center justify-center gap-1">
                <span className="font-heading text-3xl font-bold tabular-nums text-club-text">{mgr.reputation}</span>
              </div>
              <div className="relative mx-auto mt-1 h-1.5 w-20 overflow-hidden rounded-full">
                  <div className="absolute inset-0 rounded-full" style={{ background: 'linear-gradient(to right, #14b8a6, #2dd4bf 25%, #5eead4 50%)' }} />
                  <div
                    className="absolute inset-y-0 right-0 bg-muted transition-all duration-500"
                    style={{ width: `${100 - Math.min(100, (mgr.reputation / 1000) * 100)}%` }}
                  />
                </div>
              <p className="mt-0.5 font-heading text-2xs uppercase tracking-wide text-muted-foreground">{t("manager.reputation")}</p>
            </div>
            <button
              type="button"
              onClick={handleOpenSettings}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-2xs font-heading font-bold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-muted"
            >
              <Settings className="size-3" />
              {t("manager.editProfile")}
            </button>
          </div>

          <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
            <div>
              <h1 className="truncate font-heading text-3xl font-bold uppercase tracking-wide text-foreground">
                {displayName}
              </h1>
              {mgr.nickname?.trim() && (
                <p className="text-sm text-muted-foreground">{fullName}</p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <CountryFlag code={mgr.nationality} locale={i18n.language} className="text-base leading-none" />
                {countryName(mgr.nationality, i18n.language)}
              </span>
              <span>{t("manager.born")} {formatDate(mgr.date_of_birth, i18n.language)}</span>
              {myTeam && (
                <span className="font-medium text-club-text">{t("manager.managerOf", { team: myTeam.name })}</span>
              )}
            </div>
          </div>

          {/* Quick stats row */}
          <div className="grid grid-cols-3 gap-2 md:w-64">
            {[
              { label: t("manager.matches"), value: stats.matches_managed },
              { label: t("manager.wins"), value: stats.wins },
              { label: t("common.played"), value: stats.losses },
              { label: t("manager.trophies"), value: stats.trophies, icon: Trophy },
              { label: t("manager.winPercent"), value: stats.matches_managed > 0 ? `${((stats.wins / stats.matches_managed) * 100).toFixed(0)}%` : "—" },
              { label: t("manager.board"), value: `${mgr.satisfaction}%` },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border border-border bg-muted/20 px-2 py-2 text-center">
                <p className="font-heading text-lg font-bold tabular-nums text-foreground">{s.value}</p>
                <p className="font-heading text-2xs uppercase tracking-wide text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Board & Fan approval ── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="space-y-0">
            <CardTitle className="font-heading text-sm uppercase tracking-wide text-muted-foreground">
              {t("manager.boardStatus")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-heading text-xs uppercase tracking-wide text-muted-foreground">{t("manager.board")}</span>
                  <span className="font-heading text-sm font-bold tabular-nums text-foreground">{mgr.satisfaction}%</span>
                </div>
                <div className="relative h-2 overflow-hidden rounded-full">
                  <div className="absolute inset-0 rounded-full" style={{ background: 'linear-gradient(to right, #3b82f6, #38bdf8)' }} />
                  <div
                    className="absolute inset-y-0 right-0 bg-muted transition-all duration-500"
                    style={{ width: `${100 - mgr.satisfaction}%` }}
                  />
                </div>
                <Badge
                  className={cn(
                    "mt-1.5",
                    mgr.satisfaction >= 80 ? "border-positive/30 bg-positive/10 text-positive" :
                    mgr.satisfaction >= 50 ? "border-primary/30 bg-primary/10 text-club-text" :
                    mgr.satisfaction >= 30 ? "border-warning/30 bg-warning/10 text-warning" :
                    "border-negative/30 bg-negative/10 text-negative",
                  )}
                >
                  {mgr.satisfaction >= 80 ? t("manager.boardVeryPleased") :
                   mgr.satisfaction >= 50 ? t("manager.boardSatisfied") :
                   mgr.satisfaction >= 30 ? t("manager.boardConcerns") :
                   t("manager.boardThreat")}
                </Badge>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-heading text-xs uppercase tracking-wide text-muted-foreground">{t("manager.fans")}</span>
                  <span className="font-heading text-sm font-bold tabular-nums text-foreground">{mgr.fan_approval ?? 50}%</span>
                </div>
                <div className="relative h-2 overflow-hidden rounded-full">
                    <div className="absolute inset-0 rounded-full" style={{ background: 'linear-gradient(to right, #3b82f6, #38bdf8)' }} />
                    <div
                      className="absolute inset-y-0 right-0 bg-muted transition-all duration-500"
                      style={{ width: `${100 - (mgr.fan_approval ?? 50)}%` }}
                    />
                  </div>
                  <Badge
                  className={cn(
                    "mt-1.5",
                    (mgr.fan_approval ?? 50) >= 80 ? "border-positive/30 bg-positive/10 text-positive" :
                    (mgr.fan_approval ?? 50) >= 60 ? "border-primary/30 bg-primary/10 text-club-text" :
                    (mgr.fan_approval ?? 50) >= 40 ? "border-warning/30 bg-warning/10 text-warning" :
                    "border-negative/30 bg-negative/10 text-negative",
                  )}
                >
                  {(mgr.fan_approval ?? 50) >= 80 ? t("manager.fanAdore") :
                   (mgr.fan_approval ?? 50) >= 60 ? t("manager.fanBehind") :
                   (mgr.fan_approval ?? 50) >= 40 ? t("manager.fanMixed") :
                   (mgr.fan_approval ?? 50) >= 20 ? t("manager.fanRestless") :
                   t("manager.fanUnrest")}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Career history */}
        <Card>
          <CardHeader className="space-y-0">
            <CardTitle className="font-heading text-sm uppercase tracking-wide text-muted-foreground">
              {t("manager.careerHistory")}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {mgr.career_history.length > 0 ? (
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-border font-heading text-2xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 font-heading font-bold">{t("manager.club")}</th>
                    <th className="px-4 py-3 font-heading font-bold">{t("manager.period")}</th>
                    <th className="px-3 py-3 text-center font-heading font-bold">{t("common.played")}</th>
                    <th className="px-3 py-3 text-center font-heading font-bold">{t("manager.wins")}</th>
                    <th className="px-3 py-3 text-center font-heading font-bold">{t("manager.losses")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {mgr.career_history.map((entry, i) => (
                    <tr key={i} className="transition-colors hover:bg-muted/20">
                      <td className="px-4 py-3 font-medium text-sm text-foreground">{entry.team_name}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {entry.start_date.substring(0, 4)}–{entry.end_date?.substring(0, 4) || t("common.present")}
                      </td>
                      <td className="px-3 py-3 text-center text-xs tabular-nums text-muted-foreground">{entry.matches}</td>
                      <td className="px-3 py-3 text-center text-xs tabular-nums text-positive">{entry.wins}</td>
                      <td className="px-3 py-3 text-center text-xs tabular-nums text-negative">{entry.losses}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t("manager.noHistory")}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Current team & Career highlights ── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Current team */}
        <Card>
          <CardHeader className="space-y-0">
            <CardTitle className="font-heading text-sm uppercase tracking-wide text-muted-foreground">
              <Building2 className="mr-1.5 inline size-4" />
              {t("manager.currentTeam", "Equipo actual")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {myTeam ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted">
                    {(() => {
                      const logo = resolveTeamLogo(myTeam.short_name ?? myTeam.name, myTeam.logo_url) ?? resolveTeamLogo(myTeam.name, myTeam.logo_url);
                      return logo ? <img src={logo} alt={myTeam.name} className="size-8 object-contain" /> : <Building2 className="size-5 text-muted-foreground" />;
                    })()}
                  </div>
                  <div>
                    <p className="font-heading text-base font-bold uppercase tracking-wide text-foreground">{myTeam.name}</p>
                    {teamPosition && (
                      <p className="text-xs text-muted-foreground">
                        {t("manager.leaguePosition", "Posición")}: <span className="font-semibold text-club-text">#{teamPosition}</span>
                        {league?.standings && <span> · {league.standings.length} {t("manager.teams", "equipos")}</span>}
                      </p>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg border border-border bg-muted/20 p-2.5 text-center">
                    <Users className="mx-auto mb-1 size-4 text-club-text" />
                    <p className="font-heading text-lg font-bold tabular-nums text-foreground">{teamPlayers.length}</p>
                    <p className="font-heading text-2xs uppercase tracking-wide text-muted-foreground">{t("manager.players", "Jugadores")}</p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/20 p-2.5 text-center">
                    <Building2 className="mx-auto mb-1 size-4 text-amber-400" />
                    <p className="font-heading text-lg font-bold tabular-nums text-foreground">{teamStaff.length}</p>
                    <p className="font-heading text-2xs uppercase tracking-wide text-muted-foreground">{t("manager.staff", "Staff")}</p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/20 p-2.5 text-center">
                    <Trophy className="mx-auto mb-1 size-4 text-emerald-400" />
                    <p className="font-heading text-lg font-bold tabular-nums text-foreground">{avgOvr}</p>
                    <p className="font-heading text-2xs uppercase tracking-wide text-muted-foreground">{t("common.ovr")}</p>
                  </div>
                </div>

                {/* Recent results */}
                {recentResults.length > 0 && (
                  <div>
                    <p className="mb-2 font-heading text-2xs font-bold uppercase tracking-wide text-muted-foreground">
                      {t("manager.recentResults", "Últimos resultados")}
                    </p>
                    <div className="flex gap-1.5">
                      {recentResults.map((f) => {
                        const userIsHome = f.home_team_id === myTeam.id;
                        const won = userIsHome
                          ? (f.result?.home_wins ?? 0) > (f.result?.away_wins ?? 0)
                          : (f.result?.away_wins ?? 0) > (f.result?.home_wins ?? 0);
                        return (
                          <div
                            key={f.id}
                            className={cn(
                              "flex size-8 items-center justify-center rounded-md text-xs font-heading font-bold tabular-nums",
                              won ? "bg-positive/15 text-positive" : "bg-negative/15 text-negative",
                            )}
                            title={`${getTeamName(gameState.teams, f.home_team_id)} ${f.result?.home_wins ?? 0}-${f.result?.away_wins ?? 0} ${getTeamName(gameState.teams, f.away_team_id)}`}
                          >
                            {won ? "W" : "L"}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="py-4 text-center text-sm text-muted-foreground">{t("manager.noTeam", "Sin equipo")}</p>
            )}
          </CardContent>
        </Card>

        {/* Career highlights */}
        <Card>
          <CardHeader className="space-y-0">
            <CardTitle className="font-heading text-sm uppercase tracking-wide text-muted-foreground">
              <Trophy className="mr-1.5 inline size-4" />
              {t("manager.careerHighlights", "Trayectoria")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-border bg-muted/20 p-2.5 text-center">
                  <p className="font-heading text-lg font-bold tabular-nums text-foreground">{totalSeasons}</p>
                  <p className="font-heading text-2xs uppercase tracking-wide text-muted-foreground">{t("manager.seasons", "Temp.")}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/20 p-2.5 text-center">
                  <p className="font-heading text-lg font-bold tabular-nums text-foreground">{stats.trophies}</p>
                  <p className="font-heading text-2xs uppercase tracking-wide text-muted-foreground">{t("manager.trophies")}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/20 p-2.5 text-center">
                  <p className="font-heading text-lg font-bold tabular-nums text-foreground">
                    {stats.best_finish != null ? `#${stats.best_finish}` : "—"}
                  </p>
                  <p className="font-heading text-2xs uppercase tracking-wide text-muted-foreground">{t("manager.bestFinish", "Mejor puesto")}</p>
                </div>
              </div>

              {/* W/L ratio bar */}
              {stats.matches_managed > 0 && (
                <div>
                  <p className="mb-1.5 font-heading text-2xs font-bold uppercase tracking-wide text-muted-foreground">
                    {t("manager.winRate", "Efectividad")}
                  </p>
                  <div className="flex h-3 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-positive transition-all" style={{ width: `${(stats.wins / stats.matches_managed) * 100}%` }} />
                    <div className="h-full bg-negative transition-all" style={{ width: `${(stats.losses / stats.matches_managed) * 100}%` }} />
                  </div>
                  <div className="mt-1 flex justify-between text-2xs text-muted-foreground">
                    <span>{Math.round((stats.wins / stats.matches_managed) * 100)}% {t("manager.wins")}</span>
                    <span>{Math.round((stats.losses / stats.matches_managed) * 100)}% {t("manager.losses")}</span>
                  </div>
                </div>
              )}

              {/* Season records from career history */}
              {mgr.career_history.length > 0 && (
                <div>
                  <p className="mb-1.5 font-heading text-2xs font-bold uppercase tracking-wide text-muted-foreground">
                    {t("manager.bestSeason", "Mejor temporada")}
                  </p>
                  {(() => {
                    const best = [...mgr.career_history].sort((a, b) => (b.wins / Math.max(1, b.matches)) - (a.wins / Math.max(1, a.matches)))[0];
                    return (
                      <div className="rounded-lg border border-border bg-muted/20 p-2.5">
                        <p className="text-xs font-medium text-foreground">{best.team_name}</p>
                        <p className="mt-0.5 text-2xs text-muted-foreground">
                          {best.wins}W/{best.losses}L · {Math.round((best.wins / Math.max(1, best.matches)) * 100)}% WR
                          {best.best_league_position != null && ` · #${best.best_league_position}`}
                        </p>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Avatar Picker Modal ── */}
      {showAvatarPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowAvatarPicker(false)}>
          <div className="w-full max-w-xl rounded-xl border border-border bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-heading text-lg font-bold uppercase tracking-wide text-foreground">{t("manager.changeAvatar")}</h3>
              <button type="button" onClick={() => setShowAvatarPicker(false)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>
            {isSavingAvatar ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{t("common.saving")}</p>
            ) : (
              <div className="grid max-h-80 grid-cols-6 gap-3 overflow-y-auto p-1">
                {MANAGER_ICON_PATHS.map((path) => (
                  <button
                    key={path}
                    type="button"
                    onClick={() => handleSelectAvatar(path)}
                    className={cn(
                      "aspect-square overflow-hidden rounded-xl border-2 transition-all hover:scale-105",
                      mgr.avatar_path === path ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/50",
                    )}
                  >
                    <img src={path} alt="" className="size-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Settings Modal ── */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowSettings(false)}>
          <div className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-heading text-lg font-bold uppercase tracking-wide text-foreground">{t("manager.editProfile")}</h3>
              <button type="button" onClick={() => setShowSettings(false)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block font-heading text-2xs font-bold uppercase tracking-wide text-muted-foreground">{t("createManager.nickname")}</label>
                <input maxLength={20} value={formData.nickname} onChange={(e) => setFormData((p) => ({ ...p, nickname: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-sm text-foreground focus:border-primary/50" />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="mb-1 block font-heading text-2xs font-bold uppercase tracking-wide text-muted-foreground">{t("createManager.firstName")}</label>
                  <input maxLength={30} value={formData.firstName} onChange={(e) => setFormData((p) => ({ ...p, firstName: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-sm text-foreground focus:border-primary/50" />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block font-heading text-2xs font-bold uppercase tracking-wide text-muted-foreground">{t("createManager.lastName")}</label>
                  <input maxLength={30} value={formData.lastName} onChange={(e) => setFormData((p) => ({ ...p, lastName: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-sm text-foreground focus:border-primary/50" />
                </div>
              </div>
              <div>
                <label className="mb-1 block font-heading text-2xs font-bold uppercase tracking-wide text-muted-foreground">{t("createManager.dob")}</label>
                <input type="date" value={formData.dob} onChange={(e) => setFormData((p) => ({ ...p, dob: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-sm text-foreground focus:border-primary/50" />
              </div>
              <div ref={nationalityRef}>
                <label className="mb-1 block font-heading text-2xs font-bold uppercase tracking-wide text-muted-foreground">{t("createManager.countryOfOrigin")}</label>
                <div className="relative">
                  <button type="button" onClick={() => setNationalityOpen(!nationalityOpen)}
                    className="flex w-full items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-sm text-left text-foreground transition-colors hover:border-primary/50">
                    <span className="flex items-center gap-2">
                      {formData.nationality ? (
                        <><CountryFlag code={formData.nationality} locale={i18n.language} className="text-lg leading-none" /><span>{countryName(formData.nationality, i18n.language) || formData.nationality}</span></>
                      ) : (
                        t("createManager.selectCountry")
                      )}
                    </span>
                    <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", nationalityOpen && "rotate-180")} />
                  </button>
                  {nationalityOpen && (
                    <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[200px] overflow-hidden overflow-y-auto rounded-lg border border-border bg-card shadow-xl">
                      <div className="border-b border-border p-2">
                        <input type="text" autoFocus placeholder={t("createManager.searchNationalities")} value={nationalitySearch}
                          onChange={(e) => setNationalitySearch(e.target.value)}
                          className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-foreground" />
                      </div>
                      {filteredNationalities.map((nat) => (
                        <button key={nat.code} type="button" onMouseDown={(e) => { e.preventDefault(); setFormData((p) => ({ ...p, nationality: nat.code })); setNationalityOpen(false); setNationalitySearch(""); }}
                          className={cn("flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors",
                            formData.nationality === nat.code ? "bg-primary/10 text-club-text" : "text-muted-foreground hover:bg-muted")}>
                          <span className="flex items-center gap-2"><CountryFlag code={nat.code} locale={i18n.language} className="text-base leading-none" /><span>{nat.name}</span></span>
                          {formData.nationality === nat.code && <Check className="size-3.5 text-club-text" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowSettings(false)} disabled={isSaving}
                  className="rounded-md border border-border px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50">
                  {t("common.cancel")}
                </button>
                <button type="button" onClick={handleSaveSettings} disabled={isSaving}
                  className="rounded-md border border-primary bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50">
                  {isSaving ? t("common.saving") : t("common.save")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
