// @ts-nocheck
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { buildLolScrimPrepInsight } from "@/lib/scrims/lolScrimPrep";
import { resolvePlayerPhoto } from "@/lib/players/playerPhotos";
import { resolveTeamLogo } from "@/lib/teams/teamLogos";
import type { MatchSnapshot } from "@/ui-v2/_legacy/components/match/types";
import type { DraftMatchResult, DraftTimelineEvent } from "@/ui-v2/_legacy/components/match/draftResultSimulator";
import { cn } from "@/ui-v2/lib/utils";

type Side = "blue" | "red";

interface TeamSeed {
  id: string;
  name: string;
  shortName: string;
}

interface DraftResultScreenProps {
  snapshot: MatchSnapshot;
  controlledSide: Side;
  result: DraftMatchResult;
  seriesGames?: DraftResultSeriesGame[];
  seriesLength?: 1 | 3 | 5;
  seriesGameIndex?: number;
  userSeriesWins?: number;
  opponentSeriesWins?: number;
  canUserChooseSide?: boolean;
  onPressConference?: () => void;
  onContinue: (nextUserSide?: Side) => void;
  teams?: import("@/store/types").TeamData[];
}

export interface DraftResultSeriesGame {
  gameIndex: number;
  result: DraftMatchResult;
  winnerSide?: Side;
}

const TEAM_SEEDS: TeamSeed[] = [];
const GOLD_CHART_CENTER_Y = 36;
const GOLD_CHART_HALF_HEIGHT = 28;

type GoldDiffPoint = { minute: number; diff: number };

export type GoldChartPoint = GoldDiffPoint & { x: number; y: number };

export function buildGoldAdvantageChartPoints(timeline: GoldDiffPoint[]): GoldChartPoint[] {
  const orderedTimeline = [...timeline]
    .filter((point) => Number.isFinite(point.minute) && Number.isFinite(point.diff))
    .sort((left, right) => left.minute - right.minute);

  const maxDiff = Math.max(...orderedTimeline.map((point) => Math.abs(point.diff)), 100);
  const minMinute = orderedTimeline[0]?.minute ?? 0;
  const maxMinute = orderedTimeline[orderedTimeline.length - 1]?.minute ?? 1;
  const range = maxMinute - minMinute || 1;
  const centerX = 6;
  const chartWidth = 88;

  return orderedTimeline.map((point) => ({
    ...point,
    x: centerX + ((point.minute - minMinute) / range) * chartWidth,
    y: GOLD_CHART_CENTER_Y + (point.diff / maxDiff) * GOLD_CHART_HALF_HEIGHT,
  }));
}

function buildKDAColor(kills: number, deaths: number, assists: number): string {
  const kda = (kills + assists) / Math.max(1, deaths);
  if (kda >= 4) return "text-emerald-400";
  if (kda >= 2) return "text-foreground";
  return "text-muted-foreground";
}

function count(events: DraftTimelineEvent[], type: string, side: string) {
  return events.filter((event) => event.type === type).filter((event) => {
    if (type === "kill" && event.participants) {
      const source = typeof event.participants[0] === "object" ? (event.participants[0] as { teamId?: string }).teamId : undefined;
      return source === side;
    }
    return true;
  }).length;
}

function estimatedRuntimeEvents(runtime: DraftMatchResult): Array<{ t: number; text: string; type: "kill" | "tower" | "dragon" | "baron" | "info" }> {
  const minutes = Math.max(8, Math.floor((runtime.durationSec ?? 0) / 60));
  const blueName = (runtime as unknown as Record<string, { name: string }>).blue_team?.name ?? "BLUE";
  const redName = (runtime as unknown as Record<string, { name: string }>).red_team?.name ?? "RED";
  const seed = Math.floor((runtime.durationSec ?? 0) + (runtime.blueKills ?? 0) * 13 + (runtime.redKills ?? 0) * 17);
  let state = (seed >>> 0) || 1;
  const rng = () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };

  const events: Array<{ t: number; text: string; type: "kill" | "tower" | "dragon" | "baron" | "info" }> = [];
  const pushKill = (minute: number, side: string) => {
    const jitter = Math.floor(rng() * 60);
    events.push({ t: minute * 60 + jitter, text: `${side} secured a kill`, type: "kill" });
  };
  for (let i = 0; i < (runtime.blueKills ?? 0); i++) {
    const minute = Math.max(2, Math.floor(((i + 1) / ((runtime.blueKills ?? 1) + 1)) * minutes));
    pushKill(minute, blueName);
  }
  for (let i = 0; i < (runtime.redKills ?? 0); i++) {
    const minute = Math.max(2, Math.floor(((i + 1) / ((runtime.redKills ?? 1) + 1)) * minutes));
    pushKill(minute, redName);
  }
  events.sort((a, b) => a.t - b.t);
  return events.slice(0, 50);
}

function pick<T>(arr: T[], seed: number): T {
  return arr[Math.abs(seed) % arr.length];
}

function MvpCard({ result, snapshot }: { result: DraftMatchResult; snapshot?: MatchSnapshot }) {
  const r: any = result;
  const { t } = useTranslation();
  const mvp = (() => {
    const all = [...(r.homeChampions ?? []), ...(r.awayChampions ?? [])];
    if (all.length === 0) return null;
    const best = all.reduce((a, b) => getScore(b) > getScore(a) ? b : a);
    const player = r.players?.find((p: any) => p.id === best.id);
    return { ...best, name: player?.name ?? best.name, photoUrl: player ? resolvePlayerPhoto(player.id, player.name, player.profile_image_url) : null };
  })();

  return (
    <div className="rounded-xl border border-primary/20 bg-card p-4">
      <p className="text-xs uppercase tracking-[0.2em] text-club-text">{t("match.draftResult.mvp")}</p>
      <div className="mt-3 flex items-center gap-3">
        {mvp?.photoUrl ? (
          <img src={mvp.photoUrl} alt={mvp.name} className="w-14 h-14 rounded-full object-cover border border-border" loading="lazy" />
        ) : (
          <div className="w-14 h-14 rounded-full bg-muted" />
        )}
        <div>
          <p className="font-bold text-lg text-foreground">{mvp?.name ?? "-"}</p>
          <p className="text-sm text-muted-foreground/50">
            {mvp ? `${mvp.kills}/${mvp.deaths}/${mvp.assists}` : ""}
          </p>
        </div>
      </div>
    </div>
  );
}

function getScore(c: { kills: number; deaths: number; assists: number; gold?: number }): number {
  return (c.kills * 3 + c.assists * 2 - c.deaths) + (c.gold ?? 0) / 1000;
}

function formatGold(val: number): string {
  if (val >= 1000) return `${(val / 1000).toFixed(1)}k`;
  return String(val);
}

export default function DraftResultScreen({
  snapshot,
  controlledSide,
  result,
  seriesGames,
  seriesLength = 1,
  seriesGameIndex = 1,
  userSeriesWins = 0,
  opponentSeriesWins = 0,
  canUserChooseSide = false,
  onPressConference,
  onContinue,
  teams,
}: DraftResultScreenProps) {
  const { t } = useTranslation();

  const userSide = controlledSide === "blue" ? "Home" : "Away";
  const userWon = (result as any).winner === userSide;
  const title = userWon ? t("match.victory") : t("match.defeat");
  const blueLabel = "BLUE";
  const redLabel = "RED";
  const blueTri = "▲";
  const redTri = "▼";
  const blueLogo = resolveTeamLogo(snapshot.home_team.name, undefined);
  const redLogo = resolveTeamLogo(snapshot.away_team.name, undefined);
  const displayHomeKills = result.homeKills ?? result.blueKills ?? 0;
  const displayAwayKills = result.awayKills ?? result.redKills ?? 0;

  const seriesGamesForTabs = useMemo(() => {
    if (!seriesGames || seriesGames.length <= 1) return [];
    return seriesGames.map((entry) => ({ ...entry, gameLabel: t("match.seriesGame", { game: entry.gameIndex }) }));
  }, [seriesGames, t]);

  const [selectedGameIndex, setSelectedGameIndex] = useState(seriesGameIndex);
  const selectedResult = seriesGamesForTabs.length > 0
    ? (seriesGamesForTabs.find((g) => g.gameIndex === selectedGameIndex)?.result ?? result)
    : result;

  const homeChampions = selectedResult.homeChampions ?? [];
  const awayChampions = selectedResult.awayChampions ?? [];
  const runtimeEvents = useMemo(() => estimatedRuntimeEvents(selectedResult), [selectedResult]);

  const blueKills = selectedResult.blueKills ?? selectedResult.homeKills ?? homeChampions.reduce((s, c) => s + c.kills, 0);
  const redKills = selectedResult.redKills ?? selectedResult.awayKills ?? awayChampions.reduce((s, c) => s + c.kills, 0);
  const blueGold = selectedResult.blueGold ?? homeChampions.reduce((s, c) => s + (c.gold ?? 0), 0);
  const redGold = selectedResult.redGold ?? awayChampions.reduce((s, c) => s + (c.gold ?? 0), 0);
  const homeGold = blueGold;
  const awayGold = redGold;
  const homeObjectives = (selectedResult.blueDragons ?? 0) + (selectedResult.blueBarons ?? 0) + (selectedResult.blueTowers ?? 0);
  const awayObjectives = (selectedResult.redDragons ?? 0) + (selectedResult.redBarons ?? 0) + (selectedResult.redTowers ?? 0);

  const statRows = useMemo(() => {
    const rows: Array<{ label: string; home: string; away: string }> = [];
    rows.push({ label: t("match.statKills"), home: String(blueKills), away: String(redKills) });
    rows.push({ label: t("match.statGold"), home: formatGold(blueGold), away: formatGold(redGold) });
    rows.push({ label: t("match.statTowers"), home: String(selectedResult.blueTowers ?? 0), away: String(selectedResult.redTowers ?? 0) });
    rows.push({ label: t("match.statDragons"), home: String(selectedResult.blueDragons ?? 0), away: String(selectedResult.redDragons ?? 0) });
    rows.push({ label: t("match.statBarons"), home: String(selectedResult.blueBarons ?? 0), away: String(selectedResult.redBarons ?? 0) });
    return rows;
  }, [t, blueKills, redKills, blueGold, redGold, selectedResult]);

  const homePlayers = useMemo(
    () => (result.players ?? []).filter((p) => p.team_id === snapshot.home_team.id),
    [result.players, snapshot.home_team.id],
  );
  const awayPlayers = useMemo(
    () => (result.players ?? []).filter((p) => p.team_id === snapshot.away_team.id),
    [result.players, snapshot.away_team.id],
  );

  const userPrepInsight = useMemo(() => {
    if (result.champion_ids_by_role == null) return null;
    return buildLolScrimPrepInsight({
      championIds: Object.values(result.champion_ids_by_role).filter(Boolean) as string[],
    });
  }, [result.champion_ids_by_role]);

  const userPrepFocus = useMemo(() => {
    return null;
  }, []);

  const sortedHome = useMemo(
    () => [...homeChampions].sort((a, b) => getScore(b) - getScore(a)),
    [homeChampions],
  );
  const sortedAway = useMemo(
    () => [...awayChampions].sort((a, b) => getScore(b) - getScore(a)),
    [awayChampions],
  );

  function renderTimelineItems() {
    if (runtimeEvents.length === 0) {
      return <p className="text-xs text-muted-foreground">{t("match.noTimelineData")}</p>;
    }
    return (
      <div className="space-y-1 max-h-52 overflow-auto scrollbar-v2 pr-1">
        {runtimeEvents.slice(0, 30).map((event, idx) => (
          <div key={idx} className="text-sm text-foreground flex items-center justify-between gap-3">
            <span>{Math.floor(event.t / 60)}'</span>
            <span className="flex-1 truncate">{event.text}</span>
            <span className={event.type === "kill" ? "text-rose-400" : "text-muted-foreground"}>
              {event.type.toUpperCase()}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto scrollbar-v2 bg-background text-foreground p-4 md:p-6">
      <div className="max-w-[1600px] mx-auto space-y-4">
        <header className="rounded-xl border border-border bg-card p-5 text-center shadow-md">
          <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground/70">{t("match.matchOver")}</p>
          <h1 className={`mt-1 text-4xl font-heading uppercase ${userWon ? "text-emerald-400" : "text-rose-400"}`}>
            {title}
          </h1>
          <div className="mt-3 flex items-center justify-center gap-4 text-3xl font-black">
            {blueLogo ? <img src={blueLogo} alt="" className="w-9 h-9 object-contain" loading="lazy" /> : <span className="text-club-text">{blueTri}</span>}
            <span>{displayHomeKills}</span>
            <span className="text-muted-foreground">-</span>
            <span>{displayAwayKills}</span>
            {redLogo ? <img src={redLogo} alt="" className="w-9 h-9 object-contain" loading="lazy" /> : <span className="text-orange-400">{redTri}</span>}
          </div>
        </header>

        <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-4">
          <div className="flex flex-col gap-4 order-1 xl:order-1">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div className="rounded-xl border border-border bg-card p-4 self-start">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3">{snapshot.home_team.name}</p>
                <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-1 items-center">
                  {sortedHome.map((champion) => {
                    const player = (result.players ?? []).find((p) =>
                      p.id === champion.id || p.match_name === champion.name || p.name === champion.name
                    );
                    const photoUrl = player ? resolvePlayerPhoto(player.id, player.name, player.profile_image_url) : null;
                    const isMvp = false;
                    const kdaColor = buildKDAColor(champion.kills, champion.deaths, champion.assists);
                    return (
                      <div key={champion.id} className={cn(
                        "col-span-4 grid grid-cols-subgrid items-center gap-3 rounded-md border px-3 py-2",
                        isMvp ? "border-primary/50 bg-primary/10" : "border-border bg-muted/30"
                      )}>
                        <div className="flex items-center gap-2 min-w-0">
                          {photoUrl ? (
                            <img src={photoUrl} alt={champion.name} className="w-7 h-7 rounded-full object-cover border border-border" loading="lazy" />
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-muted" />
                          )}
                          <span className="truncate text-foreground">{champion.name}</span>
                        </div>
                        <span className="text-sm text-muted-foreground/50">{champion.kills}/{champion.deaths}/{champion.assists}</span>
                        <span className="text-sm text-muted-foreground/50">{champion.gold ?? champion.cs}</span>
                        <span className={`text-sm font-bold ${kdaColor}`}>
                          {((champion.kills + champion.assists) / Math.max(1, champion.deaths)).toFixed(1)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="rounded-xl border border-border bg-card p-4 self-start">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3">{snapshot.away_team.name}</p>
                <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-1 items-center">
                  {sortedAway.map((champion) => {
                    const player = (result.players ?? []).find((p) =>
                      p.id === champion.id || p.match_name === champion.name || p.name === champion.name
                    );
                    const photoUrl = player ? resolvePlayerPhoto(player.id, player.name, player.profile_image_url) : null;
                    const isMvp = false;
                    const kdaColor = buildKDAColor(champion.kills, champion.deaths, champion.assists);
                    return (
                      <div key={champion.id} className={cn(
                        "col-span-4 grid grid-cols-subgrid items-center gap-3 rounded-md border px-3 py-2",
                        isMvp ? "border-primary/50 bg-primary/10" : "border-border bg-muted/30"
                      )}>
                        <div className="flex items-center gap-2 min-w-0">
                          {photoUrl ? (
                            <img src={photoUrl} alt={champion.name} className="w-7 h-7 rounded-full object-cover border border-border" loading="lazy" />
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-muted" />
                          )}
                          <span className="truncate text-foreground">{champion.name}</span>
                        </div>
                        <span className="text-sm text-muted-foreground/50">{champion.kills}/{champion.deaths}/{champion.assists}</span>
                        <span className="text-sm text-muted-foreground/50">{champion.gold ?? champion.cs}</span>
                        <span className={`text-sm font-bold ${kdaColor}`}>
                          {((champion.kills + champion.assists) / Math.max(1, champion.deaths)).toFixed(1)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <aside className="space-y-4 order-2">
            <MvpCard result={selectedResult} snapshot={snapshot} />

            <div className="rounded-xl border border-border bg-card p-4 shadow-md">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3">
                {t("match.lolResult.teamStats")}
              </p>
              <div className="space-y-2 text-sm">
                {statRows.map((row) => (
                  <div key={row.label} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg bg-muted/30 px-3 py-2">
                    <span className="text-club-text font-semibold">{row.home}</span>
                    <span className="text-center uppercase tracking-wider text-muted-foreground">{row.label}</span>
                    <span className="text-orange-400 font-semibold text-right">{row.away}</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {t("match.neutralObjectives")}: <span className="text-club-text">{homeObjectives}</span> - <span className="text-orange-400">{awayObjectives}</span>
              </p>
            </div>

            {renderTimelineItems()}
          </aside>
        </section>

        <footer className="flex items-center justify-end gap-2 pt-1">
          <button
            onClick={onPressConference}
            className="px-4 py-2 rounded-lg border border-border bg-muted hover:bg-muted/70 text-xs uppercase tracking-wider text-foreground"
          >
            {t("match.pressConference")}
          </button>
          <button
            onClick={() => onContinue(canUserChooseSide ? undefined : controlledSide)}
            className="px-6 py-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-heading text-sm uppercase tracking-wider"
          >
            {t("match.continue")}
          </button>
        </footer>
      </div>
    </div>
  );
}
