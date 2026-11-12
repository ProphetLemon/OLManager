import type { SoloQDayKind, SoloQDecayMode, SoloQDecayPreset, SoloQHistory, SoloQHistoryDay } from "@/api/types";
import { normalizeOptionalTrainingFocus, RECOVERY_TRAINING_FOCUS } from "@/lib/teams/trainingFocus";
import { tierFromLp, type SoloQTier } from "./soloq";

export type Translate = (key: string, options?: Record<string, string | number>) => string;

export const HISTORY_MAX_DAYS = 90;
export const RANGE_PRESETS = [30, 60, 90] as const;
export const GRANDMASTER_LP = 800;
export const CHALLENGER_LP = 1300;

// ---------------------------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------------------------

const KINDS: readonly SoloQDayKind[] = ["Played", "Idle", "Decay", "Match", "Rest"];
const MODES: readonly SoloQDecayMode[] = ["Off", "Soft", "Real", "Harsh"];

function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Accepts only a well-formed history; anything else is treated as "no history available". */
export function normalizeHistory(raw: unknown): SoloQHistory | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Partial<SoloQHistory>;
  if (!Array.isArray(source.days) || typeof source.player_id !== "string") return null;
  const mode: SoloQDecayMode = MODES.includes(source.decay_mode as SoloQDecayMode)
    ? (source.decay_mode as SoloQDecayMode)
    : "Off";
  const days = source.days
    .filter(
      (day): day is SoloQHistoryDay =>
        Boolean(day) && typeof day.date === "string" && KINDS.includes(day.kind) && typeof day.lp === "number",
    )
    .map((day) => ({
      date: day.date,
      lp: finite(day.lp),
      formula_lp: finite(day.formula_lp, finite(day.lp)),
      focus: typeof day.focus === "string" && day.focus !== "" ? day.focus : null,
      kind: day.kind,
      bank: finite(day.bank),
    }))
    .slice(-HISTORY_MAX_DAYS);
  return {
    player_id: source.player_id,
    followed: Boolean(source.followed),
    decay_mode: mode,
    bank_days: finite(source.bank_days),
    bank_max: finite(source.bank_max),
    offset_lp: finite(source.offset_lp),
    days,
  };
}

/** LP held back on a day: the formula LP minus the displayed LP (at the floor, the capped offset). */
export function offsetOf(day: Pick<SoloQHistoryDay, "lp" | "formula_lp">): number {
  return Math.max(0, day.formula_lp - day.lp);
}

// ---------------------------------------------------------------------------------------------
// Dates and numbers
// ---------------------------------------------------------------------------------------------

function utcDate(iso: string): Date {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1));
}

export function formatShortDate(iso: string, language: string): string {
  return new Intl.DateTimeFormat(language, { month: "short", day: "numeric", timeZone: "UTC" }).format(utcDate(iso));
}

export function formatLongDate(iso: string, language: string): string {
  return new Intl.DateTimeFormat(language, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(
    utcDate(iso),
  );
}

export function dayOfMonth(iso: string): number {
  return utcDate(iso).getUTCDate();
}

export function formatNumber(value: number, language: string): string {
  const text = new Intl.NumberFormat(language).format(Math.abs(Math.round(value)));
  return value < 0 ? `−${text}` : text;
}

export function formatSigned(value: number, language: string): string {
  const text = new Intl.NumberFormat(language).format(Math.abs(Math.round(value)));
  return value < 0 ? `−${text}` : `+${text}`;
}

// ---------------------------------------------------------------------------------------------
// Day kinds and the idle cause
// ---------------------------------------------------------------------------------------------

export type IdleCause = "reset" | "noTeam";

export function isIdleKind(kind: SoloQDayKind): boolean {
  return kind === "Idle" || kind === "Decay";
}

/** Why a player is off the ladder: no team (focus null), or the Mental Reset focus. Null for any other focus. */
export function idleCauseOfFocus(focus: string | null | undefined): IdleCause | null {
  if (focus === null || focus === undefined || focus === "") return "noTeam";
  return normalizeOptionalTrainingFocus(focus) === RECOVERY_TRAINING_FOCUS ? "reset" : null;
}

export function idleCause(day: Pick<SoloQHistoryDay, "kind" | "focus">): IdleCause | null {
  return isIdleKind(day.kind) ? idleCauseOfFocus(day.focus) : null;
}

export function causeName(cause: IdleCause | null, t: Translate): string {
  return t(cause === "reset" ? "soloqHistory.cause.reset" : cause === "noTeam" ? "soloqHistory.cause.noTeam" : "soloqHistory.cause.none");
}

/** Lower-case form for use inside a sentence. */
export function causeInline(cause: IdleCause | null, t: Translate): string {
  return t(
    cause === "reset"
      ? "soloqHistory.causeInline.reset"
      : cause === "noTeam"
        ? "soloqHistory.causeInline.noTeam"
        : "soloqHistory.causeInline.none",
  );
}

function causePhrase(causes: readonly IdleCause[], t: Translate): string {
  const reset = causes.includes("reset");
  const noTeam = causes.includes("noTeam");
  if (reset && noTeam) return t("soloqHistory.causePhrase.both");
  return t(noTeam ? "soloqHistory.causePhrase.noTeam" : "soloqHistory.causePhrase.reset");
}

export function focusLabel(focus: string | null, t: Translate): string {
  if (focus === null) return t("soloqHistory.cause.noTeam");
  const id = normalizeOptionalTrainingFocus(focus) ?? focus;
  return t(`training.focuses.${id}.label`, { defaultValue: id });
}

export type DayGlyph = "bar-up" | "bar-down" | "triangle" | "diamond" | "dash";
export type DayTone = "positive" | "warning" | "negative" | "foreground" | "dim";

export interface DayKindVisual {
  /** The shape carries the meaning; the tone is a second cue only. */
  glyph: DayGlyph;
  tone: DayTone;
}

export const DAY_KIND_VISUALS: Record<SoloQDayKind, DayKindVisual> = {
  Played: { glyph: "bar-up", tone: "positive" },
  Idle: { glyph: "bar-down", tone: "warning" },
  Decay: { glyph: "triangle", tone: "negative" },
  Match: { glyph: "diamond", tone: "foreground" },
  Rest: { glyph: "dash", tone: "dim" },
};

export function dayKindWord(day: Pick<SoloQHistoryDay, "kind" | "focus">, decayOn: boolean, t: Translate): string {
  const cause = idleCause(day);
  switch (day.kind) {
    case "Played":
      return t("soloqHistory.kinds.played");
    case "Match":
      return t("soloqHistory.kinds.match");
    case "Rest":
      return t("soloqHistory.kinds.rest");
    case "Decay":
      return t("soloqHistory.kinds.decayCause", { cause: causeInline(cause, t) });
    default:
      return t(decayOn ? "soloqHistory.kinds.graceCause" : "soloqHistory.kinds.idleCause", { cause: causeInline(cause, t) });
  }
}

/**
 * The kind a day is drawn with in spans and on the line. A match day inside a Mental Reset stretch is
 * neutral for the bank but keeps the run of the idle day before it, so the span runs straight through.
 */
export function displayKinds(days: readonly SoloQHistoryDay[]): Array<"Idle" | "Decay" | null> {
  const out: Array<"Idle" | "Decay" | null> = [];
  let carry: "Idle" | "Decay" | null = null;
  for (const day of days) {
    if (day.kind === "Idle" || day.kind === "Decay") {
      carry = day.kind;
      out.push(day.kind);
    } else if (day.kind === "Match" && carry && idleCauseOfFocus(day.focus) === "reset") {
      out.push(carry);
    } else {
      carry = null;
      out.push(null);
    }
  }
  return out;
}

export interface IdleRun {
  kind: "Idle" | "Decay";
  /** Indexes into the full day list, both inclusive. */
  from: number;
  to: number;
  /** Idle days in the run (neutral days inside it are not counted). */
  idleDays: number;
  cause: IdleCause | null;
  lostLp: number;
}

/** Runs of idle days that end inside the visible window starting at `start`. */
export function buildIdleRuns(days: readonly SoloQHistoryDay[], start: number): IdleRun[] {
  const shown = displayKinds(days);
  const runs: IdleRun[] = [];
  let current: IdleRun | null = null;
  for (let i = start; i < days.length; i += 1) {
    const kind = shown[i];
    const idle = isIdleKind(days[i].kind);
    if (kind && current && current.kind === kind) {
      current.to = i;
      if (idle) current.idleDays += 1;
    } else if (kind && idle) {
      current = { kind, from: i, to: i, idleDays: 1, cause: idleCause(days[i]), lostLp: 0 };
      runs.push(current);
    } else {
      current = null;
    }
    if (current && days[i].kind === "Decay" && i > 0) {
      current.lostLp += Math.max(0, offsetOf(days[i]) - offsetOf(days[i - 1]));
    }
  }
  return runs;
}

// ---------------------------------------------------------------------------------------------
// Ranges and the selected day
// ---------------------------------------------------------------------------------------------

/** 30/60/90 days, never more than the history that exists; the last option is the whole history. */
export function rangeOptions(length: number): number[] {
  if (length <= 0) return [];
  const options: number[] = RANGE_PRESETS.filter((range) => range < length);
  options.push(Math.min(length, HISTORY_MAX_DAYS));
  return options;
}

/** First visible index for a range over `length` days. */
export function rangeStart(length: number, range: number): number {
  return Math.max(0, length - Math.min(range, length));
}

export function clampIndex(index: number | null, start: number, last: number): number {
  if (index === null) return last;
  return Math.min(last, Math.max(start, index));
}

/** One pointer overlay maps a horizontal fraction (0 to 1) of the plot to the nearest day. */
export function dayIndexFromFraction(fraction: number, start: number, last: number): number {
  const f = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
  return start + Math.round(f * Math.max(0, last - start));
}

// ---------------------------------------------------------------------------------------------
// Totals, story, KPIs, chips
// ---------------------------------------------------------------------------------------------

export interface RangeSummary {
  idleDays: number;
  decayDays: number;
  lostLp: number;
  peakLp: number;
  peakIndex: number;
  peakOffset: number;
  causes: IdleCause[];
}

export function summarizeRange(days: readonly SoloQHistoryDay[], start: number): RangeSummary {
  const summary: RangeSummary = { idleDays: 0, decayDays: 0, lostLp: 0, peakLp: -1, peakIndex: start, peakOffset: 0, causes: [] };
  for (let i = start; i < days.length; i += 1) {
    const day = days[i];
    if (day.lp > summary.peakLp) {
      summary.peakLp = day.lp;
      summary.peakIndex = i;
    }
    if (isIdleKind(day.kind)) {
      summary.idleDays += 1;
      const cause = idleCause(day);
      if (cause && !summary.causes.includes(cause)) summary.causes.push(cause);
    }
    if (day.kind === "Decay") {
      summary.decayDays += 1;
      if (i > 0) summary.lostLp += Math.max(0, offsetOf(day) - offsetOf(days[i - 1]));
    }
    summary.peakOffset = Math.max(summary.peakOffset, offsetOf(day));
  }
  if (summary.peakLp < 0) summary.peakLp = 0;
  return summary;
}

export interface Sentence {
  headline: string;
  sub: string;
}

interface StoryInput {
  days: readonly SoloQHistoryDay[];
  start: number;
  decayOn: boolean;
  preset: Pick<SoloQDecayPreset, "recovery_per_played_day"> | null;
  bankMax: number;
  language: string;
}

/** The one-sentence verdict above the chart, generated from the visible range. */
export function buildStory({ days, start, decayOn, preset, bankMax, language }: StoryInput, t: Translate): Sentence {
  const range = days.length - start;
  const last = days[days.length - 1];
  const summary = summarizeRange(days, start);
  const phrase = causePhrase(summary.causes, t);
  const offsetNow = decayOn ? offsetOf(last) : 0;

  if (summary.idleDays === 0) {
    return {
      headline: t(decayOn ? "soloqHistory.story.noIdle" : "soloqHistory.story.noIdleOff", { count: range }),
      sub: t("soloqHistory.story.noIdleSub", { change: formatSigned(last.lp - days[start].lp, language) }),
    };
  }
  if (!decayOn) {
    return {
      headline: t("soloqHistory.story.idleOff", { count: summary.idleDays, cause: phrase }),
      sub: t("soloqHistory.story.idleOffSub"),
    };
  }
  if (summary.decayDays > 0) {
    const rec = preset?.recovery_per_played_day ?? 0;
    return {
      headline: t("soloqHistory.story.decayed", {
        count: summary.idleDays,
        cause: phrase,
        peak: formatNumber(summary.peakOffset, language),
      }),
      sub:
        offsetNow > 0
          ? rec > 0
            ? t("soloqHistory.story.decayedHeld", {
                offset: formatNumber(offsetNow, language),
                rec: formatNumber(rec, language),
                count: Math.ceil(offsetNow / rec),
              })
            : t("soloqHistory.story.decayedHeldNoRate", { offset: formatNumber(offsetNow, language) })
          : t("soloqHistory.story.decayedClear"),
    };
  }
  return {
    headline: t("soloqHistory.story.graceHeld", { count: summary.idleDays, cause: phrase, cap: bankMax }),
    sub: t("soloqHistory.story.graceSub", { bank: last.bank, cap: bankMax }),
  };
}

export interface Kpi {
  id: "now" | "peak" | "change" | "played" | "decay";
  label: string;
  value: string;
  sub: string;
  tone: "tier" | "foreground" | "positive" | "negative" | "dim";
  tier?: SoloQTier;
}

export function buildKpis(
  input: { days: readonly SoloQHistoryDay[]; start: number; decayOn: boolean; language: string },
  t: Translate,
): Kpi[] {
  const { days, start, decayOn, language } = input;
  const lastIndex = days.length - 1;
  const last = days[lastIndex];
  const range = days.length - start;
  const summary = summarizeRange(days, start);
  const tierNow = tierFromLp(last.lp);
  const windowStart = Math.max(0, lastIndex - 29);
  let played = 0;
  for (let i = windowStart; i <= lastIndex; i += 1) if (days[i].kind === "Played") played += 1;
  const baseIndex = Math.max(0, lastIndex - 30);
  const delta = last.lp - days[baseIndex].lp;
  const longHistory = days.length > 30;
  const offsetNow = decayOn ? offsetOf(last) : 0;
  const peakTier = tierFromLp(summary.peakLp);

  return [
    {
      id: "now",
      label: t("soloqHistory.kpi.now"),
      value: t("soloqHistory.lpValue", { value: formatNumber(last.lp, language) }),
      sub: last.lp === 0 ? t("soloqHistory.floorTier") : tierNow,
      tone: "tier",
      tier: tierNow,
    },
    {
      id: "peak",
      label: t("soloqHistory.kpi.peak", { count: range }),
      value: t("soloqHistory.lpValue", { value: formatNumber(summary.peakLp, language) }),
      sub: t("soloqHistory.kpi.peakSub", { date: formatShortDate(days[summary.peakIndex].date, language), tier: peakTier }),
      tone: "foreground",
    },
    {
      id: "change",
      label: longHistory ? t("soloqHistory.kpi.change30") : t("soloqHistory.kpi.changeShort", { count: lastIndex - baseIndex }),
      value: t("soloqHistory.lpValue", { value: formatSigned(delta, language) }),
      sub: longHistory
        ? t("soloqHistory.kpi.changeSince", { date: formatShortDate(days[baseIndex].date, language) })
        : t("soloqHistory.kpi.changeSinceStart", { date: formatShortDate(days[baseIndex].date, language) }),
      tone: delta >= 0 ? "positive" : "negative",
    },
    {
      id: "played",
      label: t("soloqHistory.kpi.played", { count: lastIndex - windowStart + 1 }),
      value: t("soloqHistory.kpi.playedValue", { played, total: lastIndex - windowStart + 1 }),
      sub: t("soloqHistory.kpi.playedSub"),
      tone: "foreground",
    },
    decayOn
      ? {
          id: "decay",
          label: t("soloqHistory.kpi.held"),
          value: offsetNow > 0 ? t("soloqHistory.lpValue", { value: formatNumber(-offsetNow, language) }) : t("soloqHistory.lpValue", { value: "0" }),
          sub: t("soloqHistory.kpi.heldSub", { count: summary.decayDays, lost: formatNumber(summary.lostLp, language) }),
          tone: offsetNow > 0 ? "negative" : "foreground",
        }
      : {
          id: "decay",
          label: t("soloqHistory.kpi.decay"),
          value: t("soloqDecay.modes.off"),
          sub: t("soloqHistory.kpi.decayOffSub"),
          tone: "dim",
        },
  ];
}

export type ChipIcon = "alert" | "pause" | "check" | "down" | "up" | "info";
export type ChipTone = "positive" | "warning" | "negative" | "dim";

export interface Chip {
  id: string;
  text: string;
  icon: ChipIcon;
  tone: ChipTone;
}

interface ChipInput {
  decayOn: boolean;
  preset: Pick<SoloQDecayPreset, "decay_per_idle_day" | "recovery_per_played_day"> | null;
  /** Today's record, when history is kept for the player. */
  today: Pick<SoloQHistoryDay, "kind" | "focus"> | null;
  lp: number;
  bank: number;
  bankMax: number;
  offset: number;
  language: string;
}

/** Forward-looking status chips for the hero: what happens next, not what the tag said. */
export function buildChips(input: ChipInput, t: Translate): Chip[] {
  const { decayOn, preset, today, lp, bank, bankMax, offset, language } = input;
  const chips: Chip[] = [];
  const idleNow = today ? isIdleKind(today.kind) : false;
  const cause = today ? causeInline(idleCause(today), t) : "";

  if (!decayOn) {
    chips.push({ id: "off", text: t("soloqHistory.chip.decayOff"), icon: "info", tone: "dim" });
    chips.push({
      id: "formula",
      text: idleNow ? t("soloqHistory.chip.idleFormula", { cause }) : t("soloqHistory.chip.formulaDaily"),
      icon: "info",
      tone: "dim",
    });
    return chips;
  }

  if (today) {
    if (idleNow) chips.push({ id: "idle", text: t("soloqHistory.chip.idle", { cause }), icon: "pause", tone: "warning" });
    else if (today.kind === "Played") chips.push({ id: "played", text: t("soloqHistory.chip.onLadder"), icon: "check", tone: "positive" });
    else
      chips.push({
        id: "neutral",
        text: t(today.kind === "Match" ? "soloqHistory.chip.matchDay" : "soloqHistory.chip.restDay"),
        icon: "info",
        tone: "dim",
      });
  }

  if (bank <= 0) chips.push({ id: "bank", text: t("soloqHistory.chip.graceUsed"), icon: "alert", tone: "warning" });
  else if (bank <= 3) chips.push({ id: "bank", text: t("soloqHistory.chip.graceLow", { count: bank }), icon: "alert", tone: "warning" });
  else chips.push({ id: "bank", text: t("soloqHistory.chip.graceOk", { bank, cap: bankMax }), icon: "check", tone: "positive" });

  const rate = preset?.decay_per_idle_day ?? 0;
  const rec = preset?.recovery_per_played_day ?? 0;
  if (lp === 0 && idleNow) chips.push({ id: "next", text: t("soloqHistory.chip.atFloor"), icon: "down", tone: "negative" });
  else if (today?.kind === "Decay" && rate > 0)
    chips.push({ id: "next", text: t("soloqHistory.chip.floorIn", { count: Math.max(1, Math.ceil(lp / rate)) }), icon: "down", tone: "negative" });
  else if (idleNow && bank > 0)
    chips.push({ id: "next", text: t("soloqHistory.chip.lossStarts", { count: bank + 1 }), icon: "alert", tone: "warning" });
  else if (offset > 0 && rec > 0)
    chips.push({
      id: "next",
      text: t("soloqHistory.chip.heldBack", { offset: formatNumber(offset, language), count: Math.ceil(offset / rec) }),
      icon: "up",
      tone: "positive",
    });
  else chips.push({ id: "next", text: t("soloqHistory.chip.noLoss"), icon: "check", tone: "positive" });
  return chips;
}

export function selectedDayStatus(
  day: SoloQHistoryDay,
  previous: SoloQHistoryDay | null,
  ctx: { decayOn: boolean; bankMax: number; language: string },
  t: Translate,
): string {
  const { decayOn, bankMax, language } = ctx;
  const cause = causeInline(idleCause(day), t);
  const held = offsetOf(day);
  switch (day.kind) {
    case "Played":
      if (!decayOn) return t("soloqHistory.status.played");
      return held > 0
        ? t("soloqHistory.status.playedHeld", { bank: day.bank, cap: bankMax, offset: formatNumber(held, language) })
        : t("soloqHistory.status.playedDecay", { bank: day.bank, cap: bankMax });
    case "Match":
      return t(decayOn ? "soloqHistory.status.matchDecay" : "soloqHistory.status.match");
    case "Rest":
      return t(decayOn ? "soloqHistory.status.restDecay" : "soloqHistory.status.rest");
    case "Idle":
      return decayOn
        ? t("soloqHistory.status.graceDay", { cause, count: day.bank })
        : t("soloqHistory.status.idleOff", { cause });
    default: {
      const lost = previous ? Math.max(0, held - offsetOf(previous)) : 0;
      return lost > 0
        ? t("soloqHistory.status.decayLost", { cause, lost: formatNumber(lost, language) })
        : t("soloqHistory.status.decayFloor", { cause });
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Chart geometry
// ---------------------------------------------------------------------------------------------

export const CHART = { width: 960, height: 424, left: 58, right: 808, top: 34, bottom: 318, axisY: 372 } as const;

const r1 = (value: number) => Math.round(value * 10) / 10;

export interface ChartMark {
  d: string;
  glyph: DayGlyph;
  tone: DayTone;
}

export interface ChartModel {
  lo: number;
  hi: number;
  bands: Array<{ tier: SoloQTier; y: number; h: number; showName: boolean; labelY: number }>;
  yTicks: Array<{ y: number; labelY: number; label: string }>;
  thresholds: Array<{ id: "challenger" | "grandmaster" | "floor"; y: number; labelY: number; noteY: number; label: string; text: string }>;
  xTicks: Array<{ x: number; label: string }>;
  spans: Array<{ kind: "Idle" | "Decay"; x: number; w: number; tx: number; label: string }>;
  mainPath: string;
  decayPath: string;
  formulaPath: string;
  marks: ChartMark[];
  selX: number;
  selY: number;
  selFormulaY: number;
  showFormulaDot: boolean;
  formulaLabelY: number;
  lpLabelY: number;
  axisNote: string | null;
  stepX: number;
  label: string;
}

export function glyphPath(glyph: DayGlyph, x: number, width: number): string {
  const x0 = r1(x - width / 2);
  const half = Math.min(6, width / 2 + 1);
  switch (glyph) {
    case "bar-up":
      return `M${x0} 356h${r1(width)}v12h-${r1(width)}z`;
    case "bar-down":
      return `M${x0} 376h${r1(width)}v12h-${r1(width)}z`;
    case "triangle":
      return `M${x0} 376h${r1(width)}l-${r1(width / 2)} 12z`;
    case "diamond":
      return `M${r1(x)} ${CHART.axisY - half}l${r1(half)} ${r1(half)}l-${r1(half)} ${r1(half)}l-${r1(half)} -${r1(half)}z`;
    default:
      return `M${r1(x - half)} ${CHART.axisY}h${r1(half * 2)}`;
  }
}

/** 16 by 16 glyphs for the legend and the activity grid, the same shapes as the strip. */
export const LEGEND_GLYPH_PATHS: Record<DayGlyph, string> = {
  "bar-up": "M3 2h10v6H3z",
  "bar-down": "M3 8h10v6H3z",
  triangle: "M2 8h12l-6 7z",
  diamond: "M8 2l6 6-6 6-6-6z",
  dash: "M2 8h12",
};

export function buildChartModel(
  input: {
    days: readonly SoloQHistoryDay[];
    start: number;
    sel: number;
    decayOn: boolean;
    bankLabelWidth?: number;
    language: string;
    headline: string;
  },
  t: Translate,
): ChartModel {
  const { days, start, sel, decayOn, language, headline } = input;
  const last = days.length - 1;
  const span = Math.max(1, last - start);
  const plotW = CHART.right - CHART.left;
  const plotH = CHART.bottom - CHART.top;
  const stepX = plotW / span;

  let minV = Infinity;
  let maxV = -Infinity;
  for (let i = start; i <= last; i += 1) {
    minV = Math.min(minV, days[i].lp, days[i].formula_lp);
    maxV = Math.max(maxV, days[i].lp, days[i].formula_lp);
  }
  const lo = Math.max(0, Math.floor((Math.min(minV, GRANDMASTER_LP) - 40) / 100) * 100);
  const hi = Math.ceil((Math.max(maxV, CHALLENGER_LP) + 30) / 100) * 100;
  const stepY = hi - lo > 800 ? 200 : 100;
  const xOf = (i: number) => CHART.left + ((i - start) / span) * plotW;
  const yOf = (v: number) => CHART.top + ((hi - v) / (hi - lo)) * plotH;

  const bands = ([
    { tier: "Challenger", from: CHALLENGER_LP, to: hi },
    { tier: "Grandmaster", from: GRANDMASTER_LP, to: CHALLENGER_LP },
    { tier: "Master", from: lo, to: GRANDMASTER_LP },
  ] as const).map((band) => {
    const y = yOf(band.to);
    const h = yOf(band.from) - yOf(band.to);
    return { tier: band.tier, y: r1(y), h: r1(h), showName: h >= 22, labelY: r1(y + Math.min(20, Math.max(16, h - 6))) };
  });

  const yTicks: ChartModel["yTicks"] = [];
  for (let v = Math.ceil(lo / stepY) * stepY; v <= hi; v += stepY) {
    if (v === 0 || Math.abs(v - GRANDMASTER_LP) < stepY * 0.3 || Math.abs(v - CHALLENGER_LP) < stepY * 0.3) continue;
    yTicks.push({ y: r1(yOf(v)), labelY: r1(yOf(v) + 5), label: formatNumber(v, language) });
  }

  const thresholds: ChartModel["thresholds"] = [
    { id: "challenger" as const, value: CHALLENGER_LP, text: t("soloqHistory.chart.tierFrom", { tier: "Challenger", lp: formatNumber(CHALLENGER_LP, language) }) },
    { id: "grandmaster" as const, value: GRANDMASTER_LP, text: t("soloqHistory.chart.tierFrom", { tier: "Grandmaster", lp: formatNumber(GRANDMASTER_LP, language) }) },
  ].map((item) => ({
    id: item.id,
    y: r1(yOf(item.value)),
    labelY: r1(yOf(item.value) + 5),
    noteY: r1(yOf(item.value) - 7),
    label: formatNumber(item.value, language),
    text: item.text,
  }));
  if (lo === 0) {
    thresholds.push({
      id: "floor",
      y: r1(yOf(0)),
      labelY: r1(yOf(0) + 5),
      noteY: r1(yOf(0) - 7),
      label: "0",
      text: t("soloqHistory.chart.floor"),
    });
  }

  const range = last - start + 1;
  const xTicks: ChartModel["xTicks"] = [];
  for (let i = start; i <= last; i += 1) {
    const show = range <= 30 ? (last - i) % 7 === 0 : dayOfMonth(days[i].date) === 1 || dayOfMonth(days[i].date) === 15;
    if (show) xTicks.push({ x: r1(xOf(i)), label: formatShortDate(days[i].date, language) });
  }

  const runs = buildIdleRuns(days, start);
  const spans = runs.map((run) => {
    const x1 = Math.max(CHART.left, xOf(run.from) - stepX / 2);
    const x2 = Math.min(CHART.right, xOf(run.to) + stepX / 2);
    const w = x2 - x1;
    const full =
      run.kind === "Decay"
        ? t("soloqHistory.chart.spanDecayFull", { lost: formatNumber(run.lostLp, language) })
        : t("soloqHistory.chart.spanIdleFull", { cause: causeName(run.cause, t), count: run.idleDays });
    const short =
      run.kind === "Decay"
        ? t("soloqHistory.chart.spanDecayShort", { count: run.idleDays })
        : t("soloqHistory.chart.spanIdleShort", { count: run.idleDays });
    const label = w >= 120 ? full : w >= 54 ? short : w >= 24 ? t("soloqHistory.chart.spanDays", { count: run.idleDays }) : "";
    return { kind: run.kind, x: r1(x1), w: r1(w), tx: r1((x1 + x2) / 2), label };
  });

  const shown = displayKinds(days);
  const point = (i: number, pick: (day: SoloQHistoryDay) => number) => `${r1(xOf(i))} ${r1(yOf(pick(days[i])))}`;
  const lpOf = (day: SoloQHistoryDay) => day.lp;
  const formulaOf = (day: SoloQHistoryDay) => day.formula_lp;
  let mainPath = "";
  let decayPath = "";
  let inDecay = false;
  for (let i = start; i <= last; i += 1) {
    if (decayOn && shown[i] === "Decay") {
      if (!inDecay) {
        decayPath += `${decayPath ? " " : ""}M${point(Math.max(start, i - 1), lpOf)}`;
        inDecay = true;
      }
      decayPath += ` L${point(i, lpOf)}`;
    } else {
      if (i === start) mainPath += `M${point(i, lpOf)}`;
      else if (inDecay) mainPath += ` M${point(i - 1, lpOf)} L${point(i, lpOf)}`;
      else mainPath += ` L${point(i, lpOf)}`;
      inDecay = false;
    }
  }
  let formulaPath = "";
  if (decayOn) for (let i = start; i <= last; i += 1) formulaPath += `${i === start ? "M" : " L"}${point(i, formulaOf)}`;

  const markWidth = Math.max(2, Math.min(12, stepX - 2));
  const marks: ChartMark[] = [];
  for (let i = start; i <= last; i += 1) {
    const visual = DAY_KIND_VISUALS[days[i].kind];
    marks.push({ d: glyphPath(visual.glyph, xOf(i), markWidth), glyph: visual.glyph, tone: visual.tone });
  }

  const day = days[sel];
  const lastDay = days[last];
  const onEndY = yOf(lastDay.lp);
  const offEndY = yOf(lastDay.formula_lp);
  const formulaAbove = offEndY <= onEndY;

  return {
    lo,
    hi,
    bands,
    yTicks,
    thresholds,
    xTicks,
    spans,
    mainPath,
    decayPath,
    formulaPath,
    marks,
    selX: r1(xOf(sel)),
    selY: r1(yOf(day.lp)),
    selFormulaY: r1(yOf(day.formula_lp)),
    showFormulaDot: decayOn && Math.abs(yOf(day.formula_lp) - yOf(day.lp)) > 8,
    formulaLabelY: r1(formulaAbove ? offEndY - 12 : offEndY + 22),
    lpLabelY: r1(formulaAbove ? onEndY + 22 : onEndY - 12),
    axisNote: lo > 0 ? t("soloqHistory.chart.axisNote", { lp: formatNumber(lo, language) }) : null,
    stepX,
    label: t("soloqHistory.chart.label", {
      from: formatShortDate(days[start].date, language),
      to: formatShortDate(lastDay.date, language),
      now: lastDay.lp === 0 ? t("soloqHistory.floorTier") : t("soloqHistory.chart.nowTier", { lp: formatNumber(lastDay.lp, language), tier: tierFromLp(lastDay.lp) }),
      story: headline,
    }),
  };
}
