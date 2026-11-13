import { Castle, Coins } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { formatClock, formatCountdown } from "@/lib/match/live/clock";
import { compactGold } from "@/lib/match/live/formatNumbers";
import type { TeamSide } from "@/lib/match/live/mapGeometry";
import { teamBarView, type DragonPip, type TeamBarSide } from "@/lib/match/live/objectivesView";
import { NEUTRAL_OBJECTIVE_ICON_PATH } from "@/lib/match/lolMapLayout";
import type { LolSimV1RuntimeState } from "@/ui-v2/_legacy/components/match/lol-prototype/backend/contract-v1";

import type { FrameBus } from "./frameBus";
import { DRAGON_NAME_KEYS, DRAGON_PLAIN_KEY, TEAM_KEYS } from "./liveNames";
import type { LiveFrame } from "./useLiveSession";
import "./liveMatch.css";

/** The clock is written at most this often. The bus runs at the screen's rate; a person reads seconds. */
export const CLOCK_INTERVAL_MS = 100;

export interface TeamIdentity {
  /** Short code, "EMB". */
  tag: string;
  name: string;
}

export type ScoreStatus = "live" | "paused" | "final";

/** Icons and names the bar already has in the match namespace are reused. */
const STAT_KEYS = {
  tower: "match.liveA11y.towerIcon",
  gold: "match.liveA11y.goldIcon",
  dragon: "match.liveA11y.dragonIcon",
  voidgrub: "match.liveA11y.voidgrubIcon",
  baron: "match.draftResult.timelineEvents.baron",
} as const;

const BUFF_NAME_KEYS = {
  baron: "match.draftResult.timelineEvents.baron",
  elder: "match.draftResult.timelineEvents.elder",
} as const;

const STATUS_KEYS: Readonly<Record<ScoreStatus, string>> = {
  live: "match.live",
  paused: "match.paused",
  final: "onAir.match.bar.final",
};

function Stat({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <span className="arena-bar-stat">
      {icon}
      <span className="sr-only">{label}</span> <span className="arena-bar-num">{value}</span>
    </span>
  );
}

function Pip({ pip, name }: { pip: DragonPip; name: (kind: Exclude<DragonPip, "unknown" | null>) => string }) {
  const { t } = useTranslation();
  if (pip === null) return <span className="arena-pip" data-kind="empty" aria-hidden="true" />;
  if (pip === "unknown") {
    return (
      <span className="arena-pip" data-kind="unknown">
        <span aria-hidden="true">?</span>
        <span className="sr-only">{t(DRAGON_PLAIN_KEY)}</span>
      </span>
    );
  }
  return (
    <span className="arena-pip" data-kind={pip}>
      <img src={NEUTRAL_OBJECTIVE_ICON_PATH[`dragon_${pip}`]} alt={name(pip)} draggable={false} />
    </span>
  );
}

function BarSide({ side, identity, view }: { side: TeamSide; identity: TeamIdentity; view: TeamBarSide }) {
  const { t, i18n } = useTranslation();
  const dragonName = (kind: Exclude<DragonPip, "unknown" | null>) => t(DRAGON_NAME_KEYS[kind]);
  const mono = (identity.name.trim() || identity.tag.trim()).slice(0, 1).toUpperCase();

  const chips: Array<{ id: string; text: string }> = [];
  if (view.soulKind) {
    chips.push({ id: "soul", text: t("onAir.match.bar.soul", { kind: dragonName(view.soulKind) }) });
  }
  if (view.baronBuff) {
    chips.push({
      id: "baron",
      text: t("onAir.match.bar.buff", {
        name: t(BUFF_NAME_KEYS.baron),
        time: formatCountdown(view.baronBuff.remainingSec),
      }),
    });
  }
  if (view.elderBuff) {
    chips.push({
      id: "elder",
      text: t("onAir.match.bar.buff", {
        name: t(BUFF_NAME_KEYS.elder),
        time: formatCountdown(view.elderBuff.remainingSec),
      }),
    });
  }

  return (
    <div className="arena-bar-side" data-team={side} role="group" aria-label={identity.name}>
      <span className="arena-bar-mono" aria-hidden="true">
        {mono}
      </span>
      <span className="arena-bar-id">
        <span className="arena-bar-tag">{identity.tag}</span>
        <span className="arena-bar-name">{identity.name}</span>
      </span>
      <Stat
        label={t(STAT_KEYS.tower)}
        value={String(view.towers)}
        icon={<Castle className="arena-bar-icon" aria-hidden="true" focusable="false" />}
      />
      <Stat
        label={t(STAT_KEYS.gold)}
        value={compactGold(view.gold, i18n.language)}
        icon={<Coins className="arena-bar-icon" aria-hidden="true" focusable="false" />}
      />
      <span className="arena-bar-pips" role="group" aria-label={t(STAT_KEYS.dragon)}>
        {view.dragonPips.map((pip, index) => (
          <Pip key={index} pip={pip} name={dragonName} />
        ))}
      </span>
      <Stat
        label={t(STAT_KEYS.voidgrub)}
        value={String(view.grubs)}
        icon={<img className="arena-bar-icon" src={NEUTRAL_OBJECTIVE_ICON_PATH.grub} alt="" draggable={false} />}
      />
      <Stat
        label={t(STAT_KEYS.baron)}
        value={String(view.barons)}
        icon={<img className="arena-bar-icon" src={NEUTRAL_OBJECTIVE_ICON_PATH.baron} alt="" draggable={false} />}
      />
      {/* Always rendered: its space is reserved, so a buff starting or ending never reflows the bar. */}
      <span
        className="arena-bar-buffs"
        data-active={chips.length > 0 || undefined}
        role={chips.length > 0 ? "group" : undefined}
        aria-label={chips.length > 0 ? t("onAir.match.bar.buffs") : undefined}
      >
        {chips.map((chip) => (
          <span key={chip.id} className="arena-buff" data-kind={chip.id}>
            {chip.text}
          </span>
        ))}
      </span>
    </div>
  );
}

export interface ScoreBarProps {
  /** The last engine answer: everything but the clock comes from it. */
  state: LolSimV1RuntimeState;
  blue: TeamIdentity;
  red: TeamIdentity;
  status: ScoreStatus;
  /** The clock listens to the frames, so it runs smoothly without a React render. */
  bus: FrameBus<LiveFrame>;
}

/**
 * The broadcast bar: for each team its towers, gold, dragons, voidgrubs and barons plus the
 * Baron and Elder buffs and the soul; in the middle the kills, the clock and the match status.
 * The clock is the only moving part and it never goes through React: a bus subscriber writes
 * its text about ten times a second. The status differs by shape and by text, not by colour.
 */
export function ScoreBar({ state, blue, red, status, bus }: ScoreBarProps) {
  const { t } = useTranslation();
  const view = teamBarView(state);
  const clockRef = useRef<HTMLSpanElement>(null);

  const writeClock = useCallback((seconds: number) => {
    const element = clockRef.current;
    if (!element) return;
    const text = formatClock(seconds);
    if (element.textContent !== text) element.textContent = text;
  }, []);

  // The clock holds the engine's time on mount, and at a pause or the end, when no frame moves it.
  useLayoutEffect(() => {
    if (status !== "live" || !clockRef.current?.textContent) writeClock(state.timeSec);
  }, [status, state.timeSec, writeClock]);

  useEffect(() => {
    let lastWriteMs = Number.NEGATIVE_INFINITY;
    return bus.subscribe((frame) => {
      if (frame.nowMs - lastWriteMs < CLOCK_INTERVAL_MS) return;
      lastWriteMs = frame.nowMs;
      writeClock(frame.clockSec);
    });
  }, [bus, writeClock]);

  const kills = (side: TeamSide, value: number) => (
    <span className="arena-bar-kills" data-team={side}>
      <span className="sr-only">{t("onAir.match.bar.kills", { team: t(TEAM_KEYS[side]), value })}</span>
      <span aria-hidden="true">{value}</span>
    </span>
  );

  return (
    <header className="arena-bar" aria-label={t("onAir.match.bar.label")} data-testid="score-bar">
      <BarSide side="blue" identity={blue} view={view.blue} />
      <div className="arena-bar-centre">
        {kills("blue", view.blue.kills)}
        <div className="arena-bar-clock">
          <span ref={clockRef} className="arena-bar-time" role="timer" aria-label={t("onAir.match.bar.clock")} />
          <span className="arena-bar-status" data-status={status} data-testid="match-status">
            {t(STATUS_KEYS[status])}
          </span>
        </div>
        {kills("red", view.red.kills)}
      </div>
      <BarSide side="red" identity={red} view={view.red} />
    </header>
  );
}
