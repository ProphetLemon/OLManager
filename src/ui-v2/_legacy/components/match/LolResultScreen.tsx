import { useTranslation } from "react-i18next";
import { compactGold } from "@/lib/match/live/formatNumbers";
import { buildLolScrimPrepInsight } from "@/lib/scrims/lolScrimPrep";
import type { FixtureData, GameStateData } from "@/store/gameStore";
import type { MatchEvent, MatchSnapshot } from "@/ui-v2/_legacy/components/match/types";
import type { LolSimV1RuntimeState } from "@/ui-v2/_legacy/components/match/lol-prototype/backend/contract-v1";

interface LolResultScreenProps {
  snapshot: MatchSnapshot;
  gameState: GameStateData;
  currentFixture?: FixtureData | null;
  userSide: "Home" | "Away" | null;
  importantEvents: MatchEvent[];
  finalRuntimeState?: LolSimV1RuntimeState | null;
  onPressConference: () => void;
  onFinish: () => void;
}

function count(events: MatchEvent[], type: string, side: "Home" | "Away") {
  return events.filter((event) => event.event_type === type && event.side === side).length;
}

type Side = "Home" | "Away";

function sideFromRuntimeEvent(text: string): Side | "-" {
  const upper = text.toUpperCase();
  if (upper.includes("BLUE")) return "Home";
  if (upper.includes("RED")) return "Away";
  return "-";
}

/** A state from before the engine counted damage has none: a dash, not a made-up zero. */
function damageText(damage: number | undefined, locale: string): string {
  return typeof damage === "number" && Number.isFinite(damage) ? compactGold(damage, locale) : "-";
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

function seededRng(seed: number) {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function estimatedRuntimeEvents(runtime: LolSimV1RuntimeState): Array<{ t: number; text: string; type: "kill" | "tower" | "dragon" | "baron" | "info" }> {
  const minutes = Math.max(8, Math.floor((runtime.timeSec ?? 0) / 60));
  const blueName = "BLUE";
  const redName = "RED";
  const rng = seededRng(
    Math.floor((runtime.timeSec ?? 0) + (runtime.stats?.blue?.gold ?? 0) * 13 + (runtime.stats?.red?.gold ?? 0) * 17),
  );

  const events: Array<{ t: number; text: string; type: "kill" | "tower" | "dragon" | "baron" | "info" }> = [];
  const pushCount = (count: number, type: "tower" | "dragon" | "baron", label: string, side: "blue" | "red") => {
    for (let i = 0; i < count; i += 1) {
      const minute = Math.max(2, Math.floor(((i + 1) / (count + 1)) * minutes));
      const jitter = Math.floor(rng() * 70);
      const team = side === "blue" ? blueName : redName;
      events.push({
        t: minute * 60 + jitter,
        text: `${team} secured ${label} (estimated)`,
        type,
      });
    }
  };

  pushCount(runtime.stats?.blue?.towers ?? 0, "tower", "tower", "blue");
  pushCount(runtime.stats?.red?.towers ?? 0, "tower", "tower", "red");
  pushCount(runtime.stats?.blue?.dragons ?? 0, "dragon", "dragon", "blue");
  pushCount(runtime.stats?.red?.dragons ?? 0, "dragon", "dragon", "red");
  pushCount(runtime.stats?.blue?.barons ?? 0, "baron", "baron", "blue");
  pushCount(runtime.stats?.red?.barons ?? 0, "baron", "baron", "red");

  const blueKills = runtime.stats?.blue?.kills ?? 0;
  const redKills = runtime.stats?.red?.kills ?? 0;
  const fallbackKillCount = blueKills + redKills > 0 ? 0 : Math.max(2, Math.min(6, Math.floor(minutes / 3)));
  const totalKills = blueKills + redKills + fallbackKillCount;
  const blueKillShare = totalKills > 0
    ? (blueKills + fallbackKillCount * 0.5) / totalKills
    : 0.5;
  const championsBlue = (runtime.champions ?? []).filter((champion) => champion.team === "blue");
  const championsRed = (runtime.champions ?? []).filter((champion) => champion.team === "red");

  for (let i = 0; i < totalKills; i += 1) {
    const minute = Math.max(3, Math.floor(((i + 1) / (totalKills + 1)) * minutes));
    const jitter = Math.floor(rng() * 45);
    const blueKill = rng() <= blueKillShare;
    const killers = blueKill ? championsBlue : championsRed;
    const victims = blueKill ? championsRed : championsBlue;
    const killer = killers.length > 0 ? killers[Math.floor(rng() * killers.length)] : null;
    const victim = victims.length > 0 ? victims[Math.floor(rng() * victims.length)] : null;
    const team = blueKill ? blueName : redName;
    const text = killer?.name && victim?.name
      ? `${team} ${killer.name} killed ${victim.name} (estimated)`
      : `${team} won skirmish (estimated)`;
    events.push({ t: minute * 60 + jitter, text, type: "kill" });
  }

  return events.sort((left, right) => left.t - right.t);
}

export default function LolResultScreen({
  snapshot,
  userSide,
  importantEvents,
  finalRuntimeState,
  onPressConference,
  onFinish,
}: LolResultScreenProps) {
  const { t, i18n } = useTranslation();

  const runtime = finalRuntimeState ?? null;

  const homeKills = runtime ? runtime.stats.blue.kills : count(importantEvents, "Kill", "Home");
  const awayKills = runtime ? runtime.stats.red.kills : count(importantEvents, "Kill", "Away");
  const homeKillsFromUnits = snapshot.lol_map?.units
    .filter((unit) => unit.side === "Home")
    .reduce((acc, unit) => acc + unit.kills, 0) ?? 0;
  const awayKillsFromUnits = snapshot.lol_map?.units
    .filter((unit) => unit.side === "Away")
    .reduce((acc, unit) => acc + unit.kills, 0) ?? 0;
  const displayHomeKills = Math.max(homeKills, homeKillsFromUnits);
  const displayAwayKills = Math.max(awayKills, awayKillsFromUnits);

  const homeObjectives = runtime
    ? runtime.stats.blue.dragons + runtime.stats.blue.barons
    : count(importantEvents, "ObjectiveTaken", "Home");
  const awayObjectives = runtime
    ? runtime.stats.red.dragons + runtime.stats.red.barons
    : count(importantEvents, "ObjectiveTaken", "Away");

  const homeStructures = runtime ? runtime.stats.blue.towers :
    count(importantEvents, "TowerDestroyed", "Home") +
      count(importantEvents, "InhibitorDestroyed", "Home") +
      count(importantEvents, "NexusTowerDestroyed", "Home") +
      count(importantEvents, "NexusDestroyed", "Home");
  const awayStructures = runtime ? runtime.stats.red.towers :
    count(importantEvents, "TowerDestroyed", "Away") +
      count(importantEvents, "InhibitorDestroyed", "Away") +
      count(importantEvents, "NexusTowerDestroyed", "Away") +
      count(importantEvents, "NexusDestroyed", "Away");

  const winnerSide = runtime?.winner
    ? runtime.winner === "blue" ? "Home" : "Away"
    : snapshot.lol_map?.destroyed_nexus_by ?? (displayHomeKills >= displayAwayKills ? "Home" : "Away");
  const userWon = userSide ? winnerSide === userSide : false;
  const userPrepInsight = buildLolScrimPrepInsight(
    snapshot.lol_scrim_prep,
    userSide === "Away" ? "away" : "home",
  );
  const userPrepFocus = userPrepInsight
    ? t(userPrepInsight.focusLabel.key, { defaultValue: userPrepInsight.focusLabel.defaultValue })
    : null;

  const durationMin = runtime ? Math.floor((runtime.timeSec ?? 0) / 60) : snapshot.current_minute;
  const homeChampions = runtime?.champions?.filter((champion) => champion.team === "blue") ?? [];
  const awayChampions = runtime?.champions?.filter((champion) => champion.team === "red") ?? [];
  const homeGold = runtime ? runtime.stats.blue.gold : homeChampions.reduce((acc, champion) => acc + (champion.gold ?? 0), 0);
  const awayGold = runtime ? runtime.stats.red.gold : awayChampions.reduce((acc, champion) => acc + (champion.gold ?? 0), 0);
  const dragonObjective = runtime?.objectives?.dragon;
  const dragonSummary = runtime
    ? t("match.lolResult.dragonSummary", {
      defaultValue: "Dragon {{kind}} · H/A stacks {{home}}/{{away}} · Soul {{soul}}",
      kind: dragonObjective?.currentKind ?? "elemental",
      home: dragonObjective?.homeStacks ?? 0,
      away: dragonObjective?.awayStacks ?? 0,
      soul: dragonObjective?.soulClaimedBy ?? "-",
    })
    : null;
  const runtimeTimelineSource = runtime
    ? (() => {
      const base = [...(runtime.events ?? [])];
      if (base.length >= 8) return base;
      const estimated = estimatedRuntimeEvents(runtime);
      return [...base, ...estimated];
    })()
    : null;

  const timelineItems = runtime
    ? [...(runtimeTimelineSource ?? [])].slice(-20).reverse().map((event, idx) => ({
      key: `${event.t}-${event.type}-${idx}`,
      minute: Math.max(0, Math.floor((event.t ?? 0) / 60)),
      label: event.text,
      side: sideFromRuntimeEvent(event.text),
    }))
    : importantEvents.slice(-20).reverse().map((evt, idx) => ({
      key: `${evt.minute}-${evt.event_type}-${idx}`,
      minute: evt.minute,
      label: evt.event_type.replace(/([A-Z])/g, " $1").trim(),
      side: evt.side,
    }));

  const winnerRoster = winnerSide === "Home" ? homeChampions : awayChampions;
  const mvp = winnerRoster
    .map((champion) => {
      const score =
        champion.kills * 3 +
        champion.assists * 1.6 -
        champion.deaths * 1.25 +
        (champion.cs ?? 0) * 0.02 +
        (champion.gold ?? 0) * 0.001;
      return { champion, score };
    })
    .sort((left, right) => right.score - left.score)[0]?.champion ?? null;

  const statRows = [
    { label: t("match.lolResult.stats.gold"), home: homeGold, away: awayGold },
    { label: t("match.lolResult.stats.towers"), home: homeStructures, away: awayStructures },
    {
      label: t("match.lolResult.stats.dragons"),
      home: runtime?.stats.blue.dragons ?? 0,
      away: runtime?.stats.red.dragons ?? 0,
    },
    {
      label: t("match.lolResult.stats.barons"),
      home: runtime?.stats.blue.barons ?? 0,
      away: runtime?.stats.red.barons ?? 0,
    },
    { label: t("match.lolResult.stats.kills"), home: displayHomeKills, away: displayAwayKills },
  ];

  const seriesLength = Math.max(8, Math.min(28, durationMin + 1));
  const baseSeries = Array.from({ length: seriesLength }, () => 0);

  const pointsByType: Record<string, number> = {
    kill: 300,
    tower: 650,
    dragon: 400,
    baron: 1500,
    nexus: 2500,
  };

  if (runtime?.events?.length) {
    for (const event of runtime.events) {
      const minute = Math.max(0, Math.min(seriesLength - 1, Math.floor((event.t ?? 0) / 60)));
      const side = sideFromRuntimeEvent(event.text);
      if (side === "-") continue;
      const delta = pointsByType[event.type] ?? 80;
      baseSeries[minute] += side === "Home" ? delta : -delta;
    }
  }

  const cumulative = baseSeries.reduce<number[]>((acc, value, index) => {
    const prev = index > 0 ? acc[index - 1] : 0;
    acc.push(prev + value);
    return acc;
  }, []);
  const finalGoldDelta = homeGold - awayGold;
  const correction = cumulative.length > 0 ? (finalGoldDelta - cumulative[cumulative.length - 1]) / cumulative.length : 0;
  const goldDiffSeries = cumulative.map((value, index) => value + correction * (index + 1));
  const peakAbsDelta = Math.max(1, ...goldDiffSeries.map((value) => Math.abs(value)));

  return (
    <div className="min-h-0 flex-1 overflow-y-auto scrollbar-v2 bg-background text-foreground p-4 md:p-6">
      <div className="w-[92%] max-w-[2000px] mx-auto space-y-4">
        <header className="rounded-2xl border border-border bg-card px-6 py-5 text-center shadow-lg">
          <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">{t("match.matchOver")}</p>
          <h1 className={`mt-1 text-5xl font-heading uppercase ${userWon ? "text-emerald-400" : "text-rose-400"}`}>
            {userWon ? t("match.victory") : t("match.defeat")}
          </h1>
          <div className="mt-4 flex items-center justify-center gap-4 text-3xl font-black">
            <span className="text-foreground">{snapshot.home_team.name}</span>
            <span className="text-club-text">{displayHomeKills}</span>
            <span className="text-muted-foreground/70">-</span>
            <span className="text-orange-400">{displayAwayKills}</span>
            <span className="text-foreground">{snapshot.away_team.name}</span>
          </div>
          <div className="mt-3 inline-flex items-center gap-3 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-sm text-club-text">
            <span className="font-heading uppercase tracking-wider">{t("match.draftResult.mvp")}</span>
            <span>{mvp?.name ?? "-"}</span>
            <span className="text-muted-foreground">· {durationMin}:{String(Math.max(0, Math.floor((runtime?.timeSec ?? 0) % 60))).padStart(2, "0")}</span>
          </div>
        </header>

        {userPrepInsight ? (
          <section className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 shadow-md">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-heading text-xs uppercase tracking-[0.22em] text-emerald-400">
                {t(userPrepInsight.title.key, { defaultValue: userPrepInsight.title.defaultValue })}
              </p>
              <span className="rounded-full border border-emerald-400/30 bg-emerald-500/20 px-3 py-1 text-sm font-bold text-emerald-400">
                +{userPrepInsight.totalSignal}
              </span>
            </div>
            <p className="mt-2 text-sm text-emerald-300/90">
              {t(userPrepInsight.summary.key, {
                ...userPrepInsight.summary.values,
                focus: userPrepFocus ?? userPrepInsight.focusLabel.defaultValue,
                defaultValue: userPrepInsight.summary.defaultValue,
              })}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {userPrepInsight.details.map((detail) => (
                <span key={detail.key} className="rounded-full border border-border bg-muted px-2 py-1 text-xs text-muted-foreground">
                  {t(detail.key, {
                    ...detail.values,
                    focus: userPrepFocus ?? userPrepInsight.focusLabel.defaultValue,
                    defaultValue: detail.defaultValue,
                  })}
                </span>
              ))}
            </div>
          </section>
        ) : null}

        <section className="grid grid-cols-1 xl:grid-cols-[1.25fr_0.9fr] gap-4">
          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground mb-3">
              {t("match.lolResult.performanceHeader")}
            </p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="rounded-xl border border-border bg-muted/50 p-3">
                <p className="text-club-text font-heading mb-2">{snapshot.home_team.name}</p>
                {(homeChampions.length ? homeChampions : []).map((champion) => {
                  const isMvp = mvp?.id === champion.id;
                  return (
                    <div key={champion.id} className={`grid grid-cols-[1fr_auto] gap-2 py-1.5 border-b border-border text-sm ${isMvp ? "text-amber-400" : "text-foreground"}`}>
                      <span className="truncate">{isMvp ? "★ " : ""}{champion.name}</span>
                      <span>{champion.kills}/{champion.deaths}/{champion.assists} · {champion.cs} · {champion.gold} · <span title={t("match.damageDealt")} aria-label={`${t("match.damageDealt")}: ${damageText(champion.damageDealt, i18n.language)}`} data-testid="row-damage">{damageText(champion.damageDealt, i18n.language)}</span></span>
                    </div>
                  );
                })}
              </div>
              <div className="rounded-xl border border-border bg-muted/50 p-3">
                <p className="text-orange-400 font-heading mb-2">{snapshot.away_team.name}</p>
                {(awayChampions.length ? awayChampions : []).map((champion) => {
                  const isMvp = mvp?.id === champion.id;
                  return (
                    <div key={champion.id} className={`grid grid-cols-[1fr_auto] gap-2 py-1.5 border-b border-border text-sm ${isMvp ? "text-amber-400" : "text-foreground"}`}>
                      <span className="truncate">{isMvp ? "★ " : ""}{champion.name}</span>
                      <span>{champion.kills}/{champion.deaths}/{champion.assists} · {champion.cs} · {champion.gold} · <span title={t("match.damageDealt")} aria-label={`${t("match.damageDealt")}: ${damageText(champion.damageDealt, i18n.language)}`} data-testid="row-damage">{damageText(champion.damageDealt, i18n.language)}</span></span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground mb-3">
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
            {dragonSummary && <p className="mt-3 text-xs text-muted-foreground">{dragonSummary}</p>}
            <p className="mt-2 text-xs text-muted-foreground">{t("match.neutralObjectives")}: <span className="text-club-text">{homeObjectives}</span> - <span className="text-orange-400">{awayObjectives}</span></p>
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground mb-3">
            {t("match.lolResult.goldDiffOverTime")}
          </p>
          <div className="h-40 rounded-xl border border-border bg-muted/30 p-3">
            <div className="relative h-full w-full">
              <div className="absolute left-0 right-0 top-1/2 border-t border-border" />
              <div className="absolute inset-0 flex items-end gap-1">
                {goldDiffSeries.map((value, idx) => {
                  const normalizedHeight = clamp01(Math.abs(value) / peakAbsDelta);
                  const height = Math.max(6, normalizedHeight * 78);
                  const isPositive = value >= 0;
                  return (
                    <div key={`${value}-${idx}`} className="flex-1 h-full flex flex-col justify-center">
                      <div
                        className={`w-full rounded-sm ${isPositive ? "bg-primary/70" : "bg-rose-400/70"}`}
                        style={{
                          height: `${height}px`,
                          marginTop: isPositive ? `-${height}px` : undefined,
                          marginBottom: isPositive ? undefined : `-${height}px`,
                          alignSelf: "center",
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>0:00</span>
            <span className="text-club-text">{snapshot.home_team.name} {homeGold - awayGold >= 0 ? `+${homeGold - awayGold}` : homeGold - awayGold}</span>
            <span>{durationMin}:00</span>
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground mb-2">
            {t("match.lolResult.keyTimeline")}
          </p>
          <div className="space-y-1 max-h-52 overflow-auto scrollbar-v2 pr-1">
            {timelineItems.map((evt) => (
              <div key={evt.key} className="text-sm text-foreground flex items-center justify-between gap-3">
                <span>{evt.minute}'</span>
                <span className="flex-1 truncate">{evt.label}</span>
                <span className={evt.side === "Home" ? "text-club-text" : evt.side === "Away" ? "text-orange-400" : "text-muted-foreground"}>
                  {evt.side === "Home" ? t("match.home") : evt.side === "Away" ? t("match.away") : "-"}
                </span>
              </div>
            ))}
          </div>
        </section>

        <footer className="flex items-center justify-end gap-2 pt-1">
          <button
            onClick={onPressConference}
            className="px-4 py-2 rounded-lg border border-border bg-muted hover:bg-muted/70 text-xs uppercase tracking-wider text-foreground"
          >
            {t("match.pressConference")}
          </button>
          <button
            onClick={onFinish}
            className="px-6 py-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-heading text-sm uppercase tracking-wider"
          >
            {t("match.continue")}
          </button>
        </footer>
      </div>
    </div>
  );
}

