import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Flag, Trophy, X, Swords } from "lucide-react";
import { GameStateData, FixtureData } from "@/store/gameStore";
import { Card, CardBody, Badge } from "@/ui-v2/_legacy/components/ui";
import {
  StoredFixtureDraftResult,
  buildBestOfContext,
  getTeamLogoPath,
  inferBestOf,
  isoDateKey,
  normalizeLolScore,
  parseFixtureDate,
  readStoredFixtureDraftResult,
  type BestOfContext,
} from "@/ui-v2/_legacy/components/schedule/ScheduleTab.helpers";
import { formatMatchDate, getTeamName } from "@/lib/common/helpers";
import { deriveWeeklyScrimContext, type WeeklyScrimContext } from "@/lib/scrims/scrimContext";
import { useScrimContextWithFallback } from "@/hooks/useScrimContextWithFallback";

interface Props {
  gameState: GameStateData;
  fixtures: FixtureData[];
  competitionLabelMap: Map<string, string>;
  onOpenFixtureResult: (stored: StoredFixtureDraftResult) => void;
}

const WEEKDAY_REFERENCE_MONDAY = new Date(Date.UTC(2024, 0, 1));
const MAX_FIXTURES_PER_CELL = 3;

interface ScrimCalendarEvent {
  id: string;
  dateKey: string;
  slotIndex: number;
  opponentTeamId: string;
}

type CalendarDayEvent =
  | { type: "fixture"; fixture: FixtureData }
  | { type: "scrim"; scrim: ScrimCalendarEvent };

function buildMonthGrid(viewMonth: Date): Date[] {
  const firstOfMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  const dayOfWeekMondayBased = (firstOfMonth.getDay() + 6) % 7;
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(firstOfMonth.getDate() - dayOfWeekMondayBased);

  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const cell = new Date(gridStart);
    cell.setDate(gridStart.getDate() + i);
    cells.push(cell);
  }
  return cells;
}

function pickInitialMonth(currentDateStr: string, fixtures: FixtureData[]): Date {
  const parsed = parseFixtureDate(currentDateStr);
  if (parsed) return new Date(parsed.getFullYear(), parsed.getMonth(), 1);
  const firstFixture = fixtures
    .map((f) => parseFixtureDate(f.date))
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  if (firstFixture) return new Date(firstFixture.getFullYear(), firstFixture.getMonth(), 1);
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), 1);
}

function sortFixturesUserFirst(
  fixtures: FixtureData[],
  userTeamId: string,
): FixtureData[] {
  return [...fixtures].sort((a, b) => {
    const aIsUser = a.home_team_id === userTeamId || a.away_team_id === userTeamId;
    const bIsUser = b.home_team_id === userTeamId || b.away_team_id === userTeamId;
    if (aIsUser && !bIsUser) return -1;
    if (!aIsUser && bIsUser) return 1;
    return a.matchday - b.matchday;
  });
}

function getCurrentWeekStart(currentDateStr: string): Date | null {
  const currentDate = parseFixtureDate(currentDateStr);
  if (!currentDate) return null;
  const weekdayMondayBased = (currentDate.getDay() + 6) % 7;
  const weekStart = new Date(currentDate);
  weekStart.setDate(currentDate.getDate() - weekdayMondayBased);
  return weekStart;
}

function buildSelectedScrimEvents(gameState: GameStateData, remoteWeeklyContext?: WeeklyScrimContext | null): ScrimCalendarEvent[] {
  const userTeamId = gameState.manager.team_id;
  if (!userTeamId) return [];

  const userTeam = gameState.teams.find((team) => team.id === userTeamId);
  if (!userTeam) return [];

  const weeklyContext = remoteWeeklyContext ?? deriveWeeklyScrimContext(gameState, userTeam);
  const weekStart = getCurrentWeekStart(gameState.clock?.current_date ?? "");
  if (!weekStart) return [];

  const knownTeamIds = new Set(gameState.teams.map((team) => team.id));

  return weeklyContext.slots.flatMap((slot) => {
    const opponentTeamId = slot.plan.find(Boolean) ?? "";
    if (!opponentTeamId || opponentTeamId === userTeamId || !knownTeamIds.has(opponentTeamId)) {
      return [];
    }

    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + slot.weekday);
    const dateKey = isoDateKey(date);

    return [{
      id: `scrim-${dateKey}-${slot.slotIndex}-${opponentTeamId}`,
      dateKey,
      slotIndex: slot.slotIndex,
      opponentTeamId,
    }];
  });
}

interface FixtureChipProps {
  fixture: FixtureData;
  gameState: GameStateData;
  bestOfContext: BestOfContext;
  userTeamId: string;
  competitionLabel?: string;
  onOpenFixtureResult: (stored: StoredFixtureDraftResult) => void;
  size?: "compact" | "full";
}

function FixtureChip({
  fixture,
  gameState,
  bestOfContext,
  userTeamId,
  competitionLabel,
  onOpenFixtureResult,
  size = "compact",
}: FixtureChipProps) {
  const stored = readStoredFixtureDraftResult(fixture.id);
  const bo = inferBestOf(fixture, bestOfContext);
  const completed = fixture.status === "Completed";
  const score = normalizeLolScore(fixture, stored, userTeamId, bo);
  const homeLogo = getTeamLogoPath(gameState.teams, fixture.home_team_id);
  const awayLogo = getTeamLogoPath(gameState.teams, fixture.away_team_id);
  const isUserMatch =
    fixture.home_team_id === userTeamId || fixture.away_team_id === userTeamId;
  const userIsHome = fixture.home_team_id === userTeamId;
  const userResultTone = (() => {
    if (!isUserMatch || !completed || !score) return "";
    const userWins = userIsHome
      ? score.home > score.away
      : score.away > score.home;
    return userWins
      ? "bg-blue-500/15 dark:bg-blue-500/20 border-blue-500/30"
      : "bg-red-500/15 dark:bg-red-500/20 border-red-500/30";
  })();

  const clickable = completed && stored !== null;
  const isFull = size === "full";

  const homeName = getTeamName(gameState.teams, fixture.home_team_id);
  const awayName = getTeamName(gameState.teams, fixture.away_team_id);

  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={() => clickable && stored && onOpenFixtureResult(stored)}
      className={[
        "group flex items-center gap-1 rounded border text-left transition-colors",
        isFull ? "px-3 py-2 gap-2" : "px-1 py-0.5",
        userResultTone ||
          (isUserMatch
            ? "bg-primary-50/70 dark:bg-primary/10 border-primary-400/30"
            : "bg-muted/50 border-border/60"),
        clickable ? "hover:border-primary-400 cursor-pointer" : "cursor-default",
      ].join(" ")}
      title={`${homeName} ${score ? `${score.home}-${score.away}` : "vs"} ${awayName}`}
    >
      {homeLogo ? (
        <img
          src={homeLogo}
          alt=""
          className={`object-contain shrink-0 ${isFull ? "w-5 h-5" : "w-3.5 h-3.5"}`}
          loading="lazy"
        />
      ) : (
        <span className={`shrink-0 ${isFull ? "w-5 h-5" : "w-3.5 h-3.5"}`} />
      )}
      {isFull ? (
        <span className="text-xs font-semibold text-foreground/90 truncate">
          {homeName}
        </span>
      ) : null}
      <span
        className={`font-heading font-bold tabular-nums text-foreground/90 ${
          isFull ? "text-sm px-2" : "text-2xs px-0.5"
        }`}
      >
        {score ? `${score.home}-${score.away}` : "vs"}
      </span>
      {isFull ? (
        <span className="text-xs font-semibold text-foreground/90 truncate">
          {awayName}
        </span>
      ) : null}
      {awayLogo ? (
        <img
          src={awayLogo}
          alt=""
          className={`object-contain shrink-0 ${isFull ? "w-5 h-5" : "w-3.5 h-3.5"}`}
          loading="lazy"
        />
      ) : (
        <span className={`shrink-0 ${isFull ? "w-5 h-5" : "w-3.5 h-3.5"}`} />
      )}
      <Badge
        variant="neutral"
        size="sm"
        className={
          isFull
            ? "ml-auto"
            : "ml-auto !text-2xs !px-1 !py-0"
        }
      >
        BO{bo}
      </Badge>
      {competitionLabel && (
        <Badge
          variant="accent"
          size="sm"
          className={isFull ? "" : "!text-2xs !px-1 !py-0"}
        >
          {competitionLabel}
        </Badge>
      )}
    </button>
  );
}

interface ScrimChipProps {
  scrim: ScrimCalendarEvent;
  gameState: GameStateData;
  size?: "compact" | "full";
}

function ScrimChip({ scrim, gameState, size = "compact" }: ScrimChipProps) {
  const { t } = useTranslation();
  const opponentName = getTeamName(gameState.teams, scrim.opponentTeamId);
  const opponentLogo = getTeamLogoPath(gameState.teams, scrim.opponentTeamId);
  const isFull = size === "full";

  return (
    <div
      className={[
        "flex items-center gap-1 rounded border border-amber-400/40 bg-amber-500/10 text-amber-700 dark:text-amber-200",
        isFull ? "px-3 py-2 gap-2" : "px-1 py-0.5",
      ].join(" ")}
      title={t("schedule.scrimVs", { team: opponentName, defaultValue: "Scrim vs {{team}}" })}
    >
      <Swords className={`shrink-0 ${isFull ? "w-4 h-4" : "w-3 h-3"}`} />
      {opponentLogo ? (
        <img
          src={opponentLogo}
          alt=""
          className={`object-contain shrink-0 ${isFull ? "w-5 h-5" : "w-3.5 h-3.5"}`}
          loading="lazy"
        />
      ) : null}
      <span className={`font-heading font-bold uppercase tracking-wider truncate ${isFull ? "text-xs" : "text-2xs"}`}>
        {t("schedule.scrimVs", { team: opponentName, defaultValue: "Scrim vs {{team}}" })}
      </span>
    </div>
  );
}

export default function ScheduleCalendarView({
  gameState,
  fixtures,
  competitionLabelMap,
  onOpenFixtureResult,
}: Props) {
  const { t, i18n } = useTranslation();
  const remoteScrimContext = useScrimContextWithFallback(gameState);
  const remoteWeeklyContext = remoteScrimContext?.week ?? null;
  const userTeamId = gameState.manager.team_id ?? "";
  const todayKey = gameState.clock?.current_date?.substring(0, 10) ?? "";

  const [viewMonth, setViewMonth] = useState<Date>(() =>
    pickInitialMonth(gameState.clock?.current_date ?? "", fixtures),
  );
  const [openDayKey, setOpenDayKey] = useState<string | null>(null);

  const bestOfContext = useMemo(() => buildBestOfContext(fixtures), [fixtures]);

  const fixturesByDay = useMemo(() => {
    const map = new Map<string, FixtureData[]>();
    fixtures.forEach((f) => {
      const key = f.date.substring(0, 10);
      const list = map.get(key) ?? [];
      list.push(f);
      map.set(key, list);
    });
    map.forEach((list, key) => {
      map.set(key, sortFixturesUserFirst(list, userTeamId));
    });
    return map;
  }, [fixtures, userTeamId]);

  const scrimsByDay = useMemo(() => {
    const map = new Map<string, ScrimCalendarEvent[]>();
    buildSelectedScrimEvents(gameState, remoteWeeklyContext).forEach((scrim) => {
      const list = map.get(scrim.dateKey) ?? [];
      list.push(scrim);
      map.set(scrim.dateKey, list);
    });
    return map;
  }, [gameState, remoteWeeklyContext]);

  const seasonStartKey = useMemo(() => {
    const firstLeagueDate = fixtures
      .filter((f) => f.match_type === "League")
      .map((f) => parseFixtureDate(f.date))
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    if (!firstLeagueDate) return null;
    return isoDateKey(firstLeagueDate);
  }, [fixtures]);

  const estimatedPlayoffsStartKey = useMemo(() => {
    const hasPlayoffs = fixtures.some((f) => f.match_type === "Playoffs");
    if (hasPlayoffs) return null;
    const lastLeagueDate = fixtures
      .filter((f) => f.match_type === "League")
      .map((f) => parseFixtureDate(f.date))
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0];
    if (!lastLeagueDate) return null;
    const estimated = new Date(lastLeagueDate);
    estimated.setDate(estimated.getDate() + 7);
    return isoDateKey(estimated);
  }, [fixtures]);

  const monthCells = useMemo(() => buildMonthGrid(viewMonth), [viewMonth]);

  const monthLabel = useMemo(() => {
    return new Intl.DateTimeFormat(i18n.language, {
      month: "long",
      year: "numeric",
    }).format(viewMonth);
  }, [viewMonth, i18n.language]);

  const weekdayLabels = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(i18n.language, { weekday: "short" });
    return Array.from({ length: 7 }, (_, idx) => {
      const day = new Date(WEEKDAY_REFERENCE_MONDAY);
      day.setUTCDate(WEEKDAY_REFERENCE_MONDAY.getUTCDate() + idx);
      return formatter.format(day);
    });
  }, [i18n.language]);

  const goPrev = () => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1));
  const goNext = () => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1));
  const goToday = () =>
    setViewMonth(pickInitialMonth(gameState.clock?.current_date ?? "", fixtures));

  const openDayEvents: CalendarDayEvent[] = openDayKey
    ? [
        ...(fixturesByDay.get(openDayKey) ?? []).map((fixture) => ({ type: "fixture" as const, fixture })),
        ...(scrimsByDay.get(openDayKey) ?? []).map((scrim) => ({ type: "scrim" as const, scrim })),
      ]
    : [];

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 p-4 border-b border-border/60 bg-muted rounded-t-xl">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={goPrev}
            aria-label={t("schedule.previousMonth", "Mes anterior")}
            className="inline-flex items-center justify-center w-8 h-8 rounded-md text-gray-500 dark:text-gray-300 hover:text-primary hover:bg-white dark:hover:bg-navy-700 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <h4 className="font-heading font-bold text-sm uppercase tracking-wider text-foreground/90 min-w-40 text-center">
            {monthLabel}
          </h4>
          <button
            type="button"
            onClick={goNext}
            aria-label={t("schedule.nextMonth", "Mes siguiente")}
            className="inline-flex items-center justify-center w-8 h-8 rounded-md text-gray-500 dark:text-gray-300 hover:text-primary hover:bg-white dark:hover:bg-navy-700 transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={goToday}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-card border border-border text-xs font-heading font-bold uppercase tracking-wider text-foreground/80 hover:text-primary transition-colors"
        >
          <CalendarIcon className="w-3.5 h-3.5" />
          {t("schedule.today", "Hoy")}
        </button>
      </div>
      <CardBody className="p-3">
        <div className="grid grid-cols-7 gap-1 mb-1">
          {weekdayLabels.map((label, idx) => (
            <div
              key={`${label}-${idx}`}
              className="text-center text-2xs font-heading font-bold uppercase tracking-wider text-muted-foreground/60 py-1"
            >
              {label}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {monthCells.map((cell) => {
            const cellKey = isoDateKey(cell);
            const inMonth = cell.getMonth() === viewMonth.getMonth();
            const isToday = cellKey === todayKey;
            const cellFixtures = fixturesByDay.get(cellKey) ?? [];
            const cellScrims = scrimsByDay.get(cellKey) ?? [];
            const cellEvents: CalendarDayEvent[] = [
              ...cellFixtures.map((fixture) => ({ type: "fixture" as const, fixture })),
              ...cellScrims.map((scrim) => ({ type: "scrim" as const, scrim })),
            ];
            const hasUserMatch = cellFixtures.some(
              (f) => f.home_team_id === userTeamId || f.away_team_id === userTeamId,
            );
            const overflow = cellEvents.length - MAX_FIXTURES_PER_CELL;
            const isPlayoffsStart = cellKey === estimatedPlayoffsStartKey;
            const isSeasonStart = cellKey === seasonStartKey;

            return (
              <div
                key={cellKey}
                className={[
                  "min-h-[120px] rounded-md border p-2 flex flex-col gap-1 transition-colors",
                  inMonth
                    ? "bg-card border-border"
                    : "bg-muted/30 border-border/40 opacity-60",
                  isToday ? "ring-2 ring-primary/60 border-primary-400" : "",
                  hasUserMatch && !isToday ? "border-accent-400/60" : "",
                  isPlayoffsStart ? "ring-1 ring-accent-500/50 border-accent-500/50" : "",
                  isSeasonStart && !isToday ? "ring-1 ring-primary/50 border-primary/50" : "",
                ].join(" ")}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`text-xs font-heading font-bold tabular-nums ${
                      isToday
                        ? "text-primary"
                        : inMonth
                          ? "text-foreground/80"
                          : "text-muted-foreground/60"
                    }`}
                  >
                    {cell.getDate()}
                  </span>
                  {cellEvents.length > 1 ? (
                    <span className="text-2xs text-muted-foreground/60 tabular-nums">
                      ×{cellEvents.length}
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-col gap-1 overflow-hidden">
                  {isSeasonStart ? (
                    <div
                      className="flex items-center gap-1 px-1 py-0.5 rounded border border-primary/60 bg-primary/10 text-primary-600 dark:text-primary-300"
                      title={t("schedule.seasonStartHint", "Día de inicio de la temporada regular")}
                    >
                      <Flag className="w-3 h-3 shrink-0" />
                      <span className="text-2xs font-heading font-bold uppercase tracking-wider truncate">
                        {t("schedule.seasonStart", "Inicio de temporada")}
                      </span>
                    </div>
                  ) : null}
                  {isPlayoffsStart ? (
                    <div
                      className="flex items-center gap-1 px-1 py-0.5 rounded border border-dashed border-accent-500/60 bg-accent-500/10 text-accent-600 dark:text-accent-300"
                      title={t("schedule.playoffsStartEstimateHint", "Fecha estimada — los emparejamientos se generan al cerrar la liga regular")}
                    >
                      <Trophy className="w-3 h-3 shrink-0" />
                      <span className="text-2xs font-heading font-bold uppercase tracking-wider truncate">
                        {t("schedule.playoffsStartEstimate", "Inicio playoffs (est.)")}
                      </span>
                    </div>
                  ) : null}
                  {cellEvents.slice(0, MAX_FIXTURES_PER_CELL).map((event) =>
                    event.type === "fixture" ? (
                      <FixtureChip
                        key={event.fixture.id}
                        fixture={event.fixture}
                        gameState={gameState}
                        bestOfContext={bestOfContext}
                        userTeamId={userTeamId}
                        competitionLabel={competitionLabelMap.get(event.fixture.id)}
                        onOpenFixtureResult={onOpenFixtureResult}
                      />
                    ) : (
                      <ScrimChip
                        key={event.scrim.id}
                        scrim={event.scrim}
                        gameState={gameState}
                      />
                    ),
                  )}
                  {overflow > 0 ? (
                    <button
                      type="button"
                      onClick={() => setOpenDayKey(cellKey)}
                      className="text-2xs font-heading font-bold uppercase tracking-wider text-primary hover:text-primary px-1 text-left transition-colors"
                    >
                      +{overflow} {t("schedule.moreMatches", "más")}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </CardBody>

      {openDayKey && openDayEvents.length > 0 ? (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setOpenDayKey(null)}
        >
          <div
            className="bg-card rounded-xl shadow-2xl border border-border w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border/60">
              <div className="flex flex-col gap-0.5">
                <h3 className="text-sm font-heading font-bold uppercase tracking-wider text-muted-foreground">
                  {t("schedule.matchesOnDay", "Partidos del día")}
                </h3>
                <p className="text-base font-heading font-bold text-foreground">
                  {formatMatchDate(openDayKey, i18n.language)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpenDayKey(null)}
                aria-label={t("common.close", "Cerrar")}
                className="inline-flex items-center justify-center w-8 h-8 rounded-md text-gray-500 dark:text-gray-300 hover:text-primary hover:bg-gray-100 dark:hover:bg-navy-700 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex flex-col gap-2 p-5 overflow-y-auto">
              {openDayEvents.map((event) =>
                event.type === "fixture" ? (
                  <FixtureChip
                    key={event.fixture.id}
                    fixture={event.fixture}
                    gameState={gameState}
                    bestOfContext={bestOfContext}
                    userTeamId={userTeamId}
                    competitionLabel={competitionLabelMap.get(event.fixture.id)}
                    onOpenFixtureResult={(stored) => {
                      setOpenDayKey(null);
                      onOpenFixtureResult(stored);
                    }}
                    size="full"
                  />
                ) : (
                  <ScrimChip
                    key={event.scrim.id}
                    scrim={event.scrim}
                    gameState={gameState}
                    size="full"
                  />
                ),
              )}
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}


