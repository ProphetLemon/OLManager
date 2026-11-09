import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Calendar as CalendarIcon, CalendarDays, ChevronRight } from "lucide-react";

import type { GameStateData, FixtureData } from "@/store/gameStore";
import { getTeamName, formatMatchDate } from "@/lib/common/helpers";
import {
  buildBestOfContext,
  getTeamLogoPath,
  inferBestOf,
  normalizeLolScore,
  readStoredFixtureDraftResult,
  type StoredFixtureDraftResult,
} from "@/lib/schedule/helpers";
import ScheduleCalendarView from "@/ui-v2/_legacy/components/schedule/ScheduleCalendarView";
import DraftResultScreenV2 from "@/ui-v2/components/DraftResultScreenV2";
import PlayoffBracketBoard from "@/ui-v2/_legacy/components/playoffs/PlayoffBracketBoard";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui-v2/components/ui/card";
import { Badge } from "@/ui-v2/components/ui/badge";
import { cn } from "@/ui-v2/lib/utils";
import { resolveTeamLogo } from "@/lib/teams/teamLogos";

interface Props {
  gameState: GameStateData;
  onSelectTeam: (id: string) => void;
}

export function ScheduleTabV2({ gameState, onSelectTeam }: Props) {
  const { t } = useTranslation();
  const [view, setView] = useState<"fixtures" | "calendar">("fixtures");
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
    return window.matchMedia("(min-width: 768px)").matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia("(min-width: 768px)");
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);
  useEffect(() => { if (!isDesktop && view === "calendar") setView("fixtures"); }, [isDesktop, view]);

  const [visible, setVisible] = useState(false);
  useEffect(() => { setVisible(true); }, []);

  const [fixtureResultView, setFixtureResultView] = useState<StoredFixtureDraftResult | null>(null);
  const [selectedDayStr, setSelectedDayStr] = useState<string | null>(null);
  const league = gameState.user_competition_id
    ? gameState.leagues.find((l) => l.competition_id === gameState.user_competition_id)
    : gameState.leagues[0];
  const userTeamId = gameState.manager.team_id;

  const getFixtureGroupKey = (f: FixtureData): string => {
    if (f.match_type === "League") return `league-${f.matchday}`;
    if (f.match_type === "Playoffs") return `playoffs-${f.matchday}`;
    return `${f.match_type}-${f.date}`;
  };

  const getFixtureGroupLabel = (f: FixtureData): string => {
    if (f.match_type === "League") return `${t("schedule.matchday", { number: f.matchday })} — ${formatMatchDate(f.date)}`;
    if (f.match_type === "Playoffs") {
      const playoffStart = league?.fixtures?.filter((c) => c.match_type === "Playoffs").map((c) => c.matchday).reduce((min, v) => Math.min(min, v), Infinity);
      const round = Number.isFinite(playoffStart) ? f.matchday - (playoffStart ?? 0) + 1 : f.matchday;
      return `${t("schedule.playoffs")} · ${t("schedule.round", { number: round })} — ${formatMatchDate(f.date)}`;
    }
    if (f.match_type === "PreseasonTournament") return `${t("season.preseasonTournament")} — ${formatMatchDate(f.date)}`;
    return `${t("season.friendly")} — ${formatMatchDate(f.date)}`;
  };

  if (!league) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">{t("schedule.noLeague")}</p>
      </div>
    );
  }

  if (fixtureResultView) {
    return (
      <DraftResultScreenV2
        snapshot={fixtureResultView.snapshot}
        controlledSide={fixtureResultView.controlledSide}
        result={fixtureResultView.result}
        seriesGames={fixtureResultView.seriesGames}
        seriesLength={fixtureResultView.seriesLength}
        seriesGameIndex={fixtureResultView.seriesGameIndex}
        userSeriesWins={fixtureResultView.userSeriesWins}
        opponentSeriesWins={fixtureResultView.opponentSeriesWins}
        onContinue={() => setFixtureResultView(null)}
        teams={gameState.teams}
      />
    );
  }

  const fixturesForDisplay = league.fixtures;
  const allFixtures = gameState.leagues.flatMap((l) => l.fixtures ?? []);
  const playoffFixtures = fixturesForDisplay.filter((f) => f.match_type === "Playoffs");
  const bestOfContext = buildBestOfContext(fixturesForDisplay);

  const competitionLabelMap = new Map<string, string>();
  gameState.leagues.forEach((l) => l.fixtures.forEach((f) => competitionLabelMap.set(f.id, l.name)));

  const matchdays = new Map<string, FixtureData[]>();
  fixturesForDisplay.forEach((f) => {
    const key = getFixtureGroupKey(f);
    const list = matchdays.get(key) || [];
    list.push(f);
    matchdays.set(key, list);
  });
  const sortedMatchdays = Array.from(matchdays.entries()).sort((a, b) => {
    const lf = a[1][0], rf = b[1][0];
    return lf.date.localeCompare(rf.date) || lf.matchday - rf.matchday;
  });

  return (
    <div className="flex h-full flex-col gap-5 p-6">
      {/* Tab switcher — segmented control */}
      <div className={cn("inline-flex gap-1.5 rounded-lg border border-border bg-muted/30 p-1", visible && "animate-fade-in-up")}>
        {(["fixtures", "calendar"] as const).map((v) => (
          <button key={v} type="button" onClick={() => setView(v)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-4 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors",
              view === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              v === "calendar" && !isDesktop && "hidden md:inline-flex",
            )}>
            {v === "fixtures" ? <CalendarIcon className="size-3.5" /> : <CalendarDays className="size-3.5" />}
            {v === "fixtures" ? t("schedule.matches") : t("schedule.calendar")}
          </button>
        ))}
      </div>

      {/* Calendar view */}
      {view === "calendar" && (
        <div className="schedule-calendar-container">
        <ScheduleCalendarView
          gameState={gameState}
          fixtures={allFixtures}
          competitionLabelMap={competitionLabelMap}
          onOpenFixtureResult={(stored) => setFixtureResultView(stored)}
        />
        </div>
      )}

      {/* Fixtures view */}
      {view === "fixtures" && (
        <div className="flex flex-col gap-4">
          {/* Weekly calendar card */}
          <div className={cn("opacity-0 animate-fade-in-up")} style={{ animationDelay: "0ms", animationFillMode: "forwards" }}>
            <WeekScheduleCard gameState={gameState} onDayClick={(dayStr) => {
              setSelectedDayStr(selectedDayStr === dayStr ? null : dayStr);
            }} />
          </div>

          {/* Matches of selected day */}
          {selectedDayStr && (
            (() => {
              const dayFixtures = fixturesForDisplay.filter((f) => f.date.slice(0, 10) === selectedDayStr);
              return (
                <Card className="overflow-hidden animate-fade-in-up" data-fixture-date={selectedDayStr}>
                  <div className="border-b border-border bg-muted/30 px-5 py-3">
                    <h4 className="font-heading text-sm font-bold uppercase tracking-wider text-foreground">
                      {dayFixtures.length > 0 ? getFixtureGroupLabel(dayFixtures[0]) : t("schedule.matchesForDate", { date: formatMatchDate(selectedDayStr) })}
                    </h4>
                  </div>
                  {dayFixtures.length === 0 ? (
                    <div className="px-5 py-8 text-center text-sm text-muted-foreground">{t("schedule.noMatchesOnDay")}</div>
                  ) : (
                    <div className="divide-y divide-border/40">
                      {dayFixtures.map((f) => {
                        const isUserMatch = f.home_team_id === userTeamId || f.away_team_id === userTeamId;
                        const homeName = getTeamName(gameState.teams, f.home_team_id);
                        const awayName = getTeamName(gameState.teams, f.away_team_id);
                        const homeLogo = getTeamLogoPath(gameState.teams, f.home_team_id);
                        const awayLogo = getTeamLogoPath(gameState.teams, f.away_team_id);
                        return (
                          <div key={f.id}
                            className={cn(
                              "group flex items-center gap-2 px-5 py-3 transition-all duration-200 md:gap-3",
                              isUserMatch && "bg-primary/5",
                            )}>
                            <Badge variant="outline" className="hidden w-10 shrink-0 text-center text-2xs md:block">
                              BO{inferBestOf(f, bestOfContext)}
                            </Badge>
                            <button onClick={() => onSelectTeam(f.home_team_id)}
                              className={cn(
                                "flex min-w-0 flex-1 items-center justify-end gap-1.5 text-sm font-semibold transition-colors hover:underline md:gap-2",
                                f.home_team_id === userTeamId ? "text-primary" : "text-foreground",
                              )}>
                              {homeLogo && <img src={homeLogo} alt="" className="size-5 shrink-0 object-contain" />}
                              <span className="truncate">{homeName}</span>
                            </button>
                            <div className="flex w-16 shrink-0 items-center justify-center md:w-20">
                              <div className="flex flex-col items-center">
                                <span className="font-heading text-xs font-bold uppercase tracking-widest text-muted-foreground/30">VS</span>
                                <span className="text-2xs text-muted-foreground/30 tabular-nums">{formatMatchDate(f.date)}</span>
                              </div>
                            </div>
                            <button onClick={() => onSelectTeam(f.away_team_id)}
                              className={cn(
                                "flex min-w-0 flex-1 items-center gap-1.5 text-sm font-semibold transition-colors hover:underline md:gap-2",
                                f.away_team_id === userTeamId ? "text-primary" : "text-foreground",
                              )}>
                              <span className="truncate">{awayName}</span>
                              {awayLogo && <img src={awayLogo} alt="" className="size-5 shrink-0 object-contain" />}
                            </button>
                            <div className="flex w-6 shrink-0 justify-end md:w-7" />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>
              );
            })()
          )}

          {/* Playoff bracket */}
          {playoffFixtures.length > 0 && (
            <div className={cn(visible && "animate-fade-in-up")}>
            <PlayoffBracketBoard
              league={league}
              teams={gameState.teams}
              onSelectTeam={onSelectTeam}
              title={`${t("schedule.playoffs")} · Bracket`}
            />
            </div>
          )}

          {/* Matchdays */}
          {sortedMatchdays.map(([groupKey, fixtures], idx) => (
            <Card key={groupKey} data-fixture-date={fixtures[0].date} className={cn("overflow-hidden", visible && "animate-fade-in-up")}
              style={{ animationDelay: `${idx * 60}ms` }}>
              <div className="border-b border-border bg-muted/30 px-5 py-3">
                <h4 className="font-heading text-sm font-bold uppercase tracking-wider text-foreground">
                  {getFixtureGroupLabel(fixtures[0])}
                </h4>
              </div>
              <div className="divide-y divide-border/40">
                {fixtures.map((f) => {
                  const storedDraftResult = readStoredFixtureDraftResult(f.id);
                  const isUserMatch = f.home_team_id === userTeamId || f.away_team_id === userTeamId;
                  const completed = f.status === "Completed";
                  const bo = inferBestOf(f, bestOfContext);
                  const score = userTeamId ? normalizeLolScore(f, storedDraftResult, userTeamId, bo) : null;
                  const homeLogo = getTeamLogoPath(gameState.teams, f.home_team_id);
                  const awayLogo = getTeamLogoPath(gameState.teams, f.away_team_id);
                  const hasStoredResult = !!storedDraftResult;

                  const userWon = (() => {
                    if (!isUserMatch || !completed || !score) return null;
                    return f.home_team_id === userTeamId ? score.home > score.away : score.away > score.home;
                  })();

                  return (
                    <div key={f.id}
                      className={cn(
                        "group flex items-center gap-2 px-5 py-3 transition-all duration-200 md:gap-3",
                        userWon === true && "bg-positive/5",
                        userWon === false && "bg-negative/5",
                        userWon === null && isUserMatch && "bg-primary/5",
                        !isUserMatch && "hover:bg-muted/20",
                      )}>
                      {/* BO badge */}
                      <Badge variant="outline" className="hidden w-10 shrink-0 text-center text-2xs md:block">
                        BO{bo}
                      </Badge>

                      {/* Home team */}
                      <button onClick={() => onSelectTeam(f.home_team_id)}
                        className={cn(
                          "flex min-w-0 flex-1 items-center justify-end gap-1.5 text-sm font-semibold transition-colors hover:underline md:gap-2",
                          f.home_team_id === userTeamId ? "text-primary" : "text-foreground",
                        )}>
                        {homeLogo && <img src={homeLogo} alt="" className="size-5 shrink-0 object-contain" />}
                        <span className="truncate">{getTeamName(gameState.teams, f.home_team_id)}</span>
                      </button>

                      {/* Score / VS */}
                      <div className="flex w-16 shrink-0 items-center justify-center md:w-20">
                        {score ? (
                          <span className={cn(
                            "font-heading text-xl font-black tabular-nums md:text-2xl",
                            userWon === true ? "text-positive" : userWon === false ? "text-negative" : "text-foreground",
                          )}>
                            {score.home} - {score.away}
                          </span>
                        ) : (
                          <div className="flex flex-col items-center">
                            <span className="font-heading text-xs font-bold uppercase tracking-widest text-muted-foreground/30">VS</span>
                            <span className="text-2xs text-muted-foreground/30 tabular-nums">{formatMatchDate(f.date)}</span>
                          </div>
                        )}
                      </div>

                      {/* Away team */}
                      <button onClick={() => onSelectTeam(f.away_team_id)}
                        className={cn(
                          "flex min-w-0 flex-1 items-center gap-1.5 text-sm font-semibold transition-colors hover:underline md:gap-2",
                          f.away_team_id === userTeamId ? "text-primary" : "text-foreground",
                        )}>
                        <span className="truncate">{getTeamName(gameState.teams, f.away_team_id)}</span>
                        {awayLogo && <img src={awayLogo} alt="" className="size-5 shrink-0 object-contain" />}
                      </button>

                      {/* Results arrow */}
                      <div className="flex w-6 shrink-0 justify-end md:w-7">
                        {completed && (
                          <button type="button" onClick={() => { const s = readStoredFixtureDraftResult(f.id); if (s) setFixtureResultView(s); }}
                            disabled={!hasStoredResult}
                            className="flex size-7 items-center justify-center rounded-md text-muted-foreground/30 transition-all hover:text-primary group-hover:translate-x-0.5 disabled:pointer-events-none disabled:opacity-20">
                            <ChevronRight className="size-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}

          {sortedMatchdays.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16">
              <CalendarDays className="size-10 text-muted-foreground/20" />
              <p className="mt-2 text-sm text-muted-foreground">{t("schedule.noFixtures")}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function getActiveLeague(gameState: GameStateData) {
  if (!gameState.leagues?.length) return null;
  if (gameState.user_competition_id) {
    return gameState.leagues.find((l) => l.competition_id === gameState.user_competition_id) ?? gameState.leagues[0];
  }
  return gameState.leagues[0];
}

function WeekScheduleCard({
  gameState,
  onDayClick,
}: {
  gameState: GameStateData;
  onDayClick?: (date: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const league = getActiveLeague(gameState);
  const teamId = gameState.manager.team_id;

  const todayKey = String(gameState.clock.current_date).slice(0, 10);
  const todayParts = todayKey.split("-").map(Number);
  const today = new Date(todayParts[0], (todayParts[1] || 1) - 1, todayParts[2] || 1);
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);

  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const fixture =
      league && teamId
        ? league.fixtures.find(
            (f) =>
              (f.home_team_id === teamId || f.away_team_id === teamId) &&
              String(f.date).slice(0, 10) === dKey,
          ) ?? null
        : null;
    const label = new Intl.DateTimeFormat(i18n.language, { weekday: "short" })
      .format(d)
      .replace(".", "")
      .toUpperCase();
    return { date: d, label, isToday: dKey === todayKey, fixture };
  });

  return (
    <Card className="h-full">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="font-heading text-sm uppercase tracking-widest text-muted-foreground">
          {t("schedule.thisWeek")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 gap-1.5">
          {week.map((d) => {
            const isMatch = !!d.fixture;
            const opponentId =
              d.fixture &&
              (d.fixture.home_team_id === teamId
                ? d.fixture.away_team_id
                : d.fixture.home_team_id);
            const opp = opponentId
              ? gameState.teams.find((t) => t.id === opponentId)
              : null;
            const oppLogo = opp
              ? resolveTeamLogo(opp.short_name ?? opp.name, opp.logo_url) ??
                resolveTeamLogo(opp.name, opp.logo_url)
              : null;
            return (
              <div
                key={d.date.toISOString()}
                title={isMatch && opp ? `vs ${opp.name}` : d.date.toDateString()}
                onClick={() => {
                  const y = d.date.getFullYear();
                  const m = String(d.date.getMonth() + 1).padStart(2, "0");
                  const day = String(d.date.getDate()).padStart(2, "0");
                  const key = `${y}-${m}-${day}`;
                  setSelectedDay(selectedDay === key ? null : key);
                  onDayClick?.(key);
                }}
                className={cn(
                  "rounded-md border p-2 text-center transition-colors cursor-pointer",
                  selectedDay === `${d.date.getFullYear()}-${String(d.date.getMonth() + 1).padStart(2, "0")}-${String(d.date.getDate()).padStart(2, "0")}`
                    ? "border-primary bg-primary/20 ring-1 ring-primary"
                    : d.isToday
                      ? "border-primary/60 bg-primary/10"
                      : isMatch
                        ? "border-primary/30 bg-card/60"
                        : "border-border bg-card/60",
                )}
              >
                <div className="font-heading text-2xs font-bold uppercase tracking-wider text-muted-foreground">
                  {d.label}
                </div>
                <div
                  className={cn(
                    "mt-1 font-heading text-base font-bold tabular-nums",
                    d.isToday && "text-primary",
                  )}
                >
                  {d.date.getDate()}
                </div>
                <div className="mt-2 flex h-7 items-center justify-center">
                  {isMatch ? (
                    oppLogo ? (
                      <img src={oppLogo} alt="" className="size-7 object-contain" />
                    ) : (
                      <span className="font-heading text-2xs font-bold text-primary">
                        {t("schedule.match")}
                      </span>
                    )
                  ) : (
                    <span className="text-2xs uppercase tracking-wider text-muted-foreground/60">
                      ·
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
