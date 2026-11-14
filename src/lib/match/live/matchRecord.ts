import { totalGold } from "@/lib/match/live/playerCardView";

/**
 * What the watched match writes down for the post-game screen, as pure functions: each
 * champion's gold earned and the team gold difference through the match, and the key events the
 * engine reports. The engine keeps only its last 200 events and a skip plays most of the match
 * in one call, so what a watched match records is whole and what a skipped one records has a hole.
 * The record says where the hole is, so the screen never draws or counts across it.
 */

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

// ── Gold ────────────────────────────────────────────────────────────────

/** One look at the match: the clock, the team gold difference (blue minus red) and each champion's gold earned. */
export interface GoldSample {
  minute: number;
  timeSec: number;
  diff: number;
  /** Gold earned by champion id. A champion whose gold the engine did not send is absent. */
  players: Record<string, number>;
}

export interface RecordableState {
  timeSec?: number;
  stats?: { blue?: { gold?: number }; red?: { gold?: number } };
  champions?: ReadonlyArray<{ id: string; gold?: number; spentGold?: number }>;
}

/** The sample of an engine answer, or null when it carries no clock. */
export function sampleOf(state: RecordableState): GoldSample | null {
  if (!isNumber(state.timeSec)) return null;
  const players: Record<string, number> = {};
  for (const champion of state.champions ?? []) {
    if (isNumber(champion.gold) || isNumber(champion.spentGold)) players[champion.id] = Math.round(totalGold(champion));
  }
  return {
    minute: Math.max(0, Math.floor(state.timeSec / 60)),
    timeSec: state.timeSec,
    diff: Math.round((state.stats?.blue?.gold ?? 0) - (state.stats?.red?.gold ?? 0)),
    players,
  };
}

export interface GoldRecord {
  /** The first look at each minute the match was seen in. */
  samples: GoldSample[];
  /** The latest look, whatever the minute: the series ends on the real end of the match. */
  latest: GoldSample | null;
}

export const newGoldRecord = (): GoldRecord => ({ samples: [], latest: null });

/** Writes down an engine answer. Called on every answer, so a watched match has every minute. */
export function recordGold(record: GoldRecord, state: RecordableState): void {
  const sample = sampleOf(state);
  if (!sample) return;
  const last = record.samples[record.samples.length - 1];
  if (!last || last.minute !== sample.minute) record.samples.push(sample);
  record.latest = sample;
}

/** The recorded series, ending on the latest look. A copy: the caller may keep it. */
export function goldSeries(record: GoldRecord): GoldSample[] {
  const series = [...record.samples];
  const last = series[series.length - 1];
  if (record.latest && (!last || record.latest.timeSec > last.timeSec)) series.push(record.latest);
  return series;
}

export interface GoldGap {
  fromSec: number;
  toSec: number;
  fromMinute: number;
  toMinute: number;
}

/** Where two neighbouring samples are more than a minute apart: nobody saw what happened between them. */
export function goldGaps(series: readonly GoldSample[]): GoldGap[] {
  const gaps: GoldGap[] = [];
  for (let i = 1; i < series.length; i += 1) {
    const before = series[i - 1];
    const after = series[i];
    if (after.minute - before.minute > 1) {
      gaps.push({ fromSec: before.timeSec, toSec: after.timeSec, fromMinute: before.minute, toMinute: after.minute });
    }
  }
  return gaps;
}

// ── Key events ──────────────────────────────────────────────────────────

/** The engine's event codes that mark something a person would want on a timeline. */
export const KEY_EVENT_CODES: ReadonlySet<string> = new Set([
  "champion_killed",
  "ignite_kill",
  "structure_destroyed",
  "dragon_secured",
  "baron_secured",
  "elder_secured",
  "herald_secured",
  "voidgrub_secured",
]);

/** A state saved before events had a code is read by its type. */
const KEY_EVENT_TYPES: ReadonlySet<string> = new Set(["kill", "tower", "dragon", "baron", "nexus"]);

export interface EventData {
  actor?: string;
  actorId?: string;
  target?: string;
  targetId?: string;
  team?: string;
  cause?: string;
  structure?: string;
  objective?: string;
  dragonKind?: string;
  item?: string;
  spell?: string;
}

export interface KeyEvent {
  t: number;
  text: string;
  type: string;
  code?: string;
  data?: EventData | null;
}

export interface KeyEventLog {
  events: KeyEvent[];
  seen: Set<string>;
}

export const newKeyEventLog = (): KeyEventLog => ({ events: [], seen: new Set() });

const isKeyEvent = (event: KeyEvent): boolean =>
  event.code ? KEY_EVENT_CODES.has(event.code) : KEY_EVENT_TYPES.has(event.type);

/** Adds the key events of an answer that the log has not seen. The engine sends its rolling list again every time. */
export function recordKeyEvents(log: KeyEventLog, events: ReadonlyArray<KeyEvent> | undefined): void {
  for (const event of events ?? []) {
    if (!isNumber(event.t) || !isKeyEvent(event)) continue;
    const key = `${event.t}|${event.code ?? event.type}|${event.text}`;
    if (log.seen.has(key)) continue;
    log.seen.add(key);
    log.events.push({ t: event.t, text: event.text, type: event.type, code: event.code, data: event.data ?? undefined });
  }
}

// ── The record handed on with the finished match ────────────────────────

export interface MatchRecord {
  gold: GoldSample[];
  events: KeyEvent[];
  /** Game second at which the match was skipped to its end, or null for a match watched whole. */
  skippedAtSec: number | null;
}

export const buildMatchRecord = (gold: GoldSample[], events: KeyEvent[], skippedAtSec: number | null): MatchRecord => ({
  gold,
  events,
  skippedAtSec,
});

export interface RecordCoverage {
  goldPartial: boolean;
  gaps: GoldGap[];
  /** Events after this game second may be missing; null when the match was watched whole. */
  eventsPartialFromSec: number | null;
}

/** What the record covers. A match with no record at all is partial: nothing reads as complete by default. */
export function recordCoverage(record: MatchRecord | null | undefined): RecordCoverage {
  if (!record) return { goldPartial: true, gaps: [], eventsPartialFromSec: 0 };
  const gaps = goldGaps(record.gold);
  return { goldPartial: gaps.length > 0, gaps, eventsPartialFromSec: record.skippedAtSec };
}
