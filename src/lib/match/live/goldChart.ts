import type { TeamSide } from "@/lib/match/live/mapGeometry";
import type { GoldGap, GoldSample } from "@/lib/match/live/matchRecord";

/**
 * The geometry of the team gold difference chart, as data. Pure: samples in, numbers and path
 * strings out. Positions are fractions of the plot (0 to 1) and the paths are in a 1000 by 1000
 * box, so the screen scales them with a viewBox and never measures anything. A series with a gap
 * (a skip left minutes nobody saw) is drawn as separate runs with the gap between them marked:
 * no line, and no area, crosses minutes that were not recorded.
 */

const STEPS = [500, 1000, 2000, 2500, 5000, 10000, 20000, 50000, 100000];
/** The most grid steps one side of the axis may hold before the step grows. */
const MAX_STEPS = 4.5;

/** A round step for the grid lines that keeps the largest value within a handful of them. */
export function niceStep(maxAbs: number): number {
  return STEPS.find((step) => maxAbs / step <= MAX_STEPS) ?? STEPS[STEPS.length - 1];
}

export interface ChartPoint {
  timeSec: number;
  diff: number;
  /** 0 to 1 across the plot. */
  x: number;
  /** 0 (top) to 1 (bottom). */
  y: number;
}

export interface ChartRun {
  line: string;
  areaPos: string;
  areaNeg: string;
}

export interface ChartGap {
  fromSec: number;
  toSec: number;
  left: number;
  width: number;
}

export interface GoldChartModel {
  durationSec: number;
  yMin: number;
  yMax: number;
  /** Grid lines from the top of the plot down, each with its value and its place. */
  ticks: Array<{ value: number; top: number }>;
  /** Where the zero line is, 0 (top) to 1 (bottom). */
  zeroTop: number;
  points: ChartPoint[];
  runs: ChartRun[];
  /** Samples with nothing recorded on either side of them: a dot, not a line. */
  isolated: ChartPoint[];
  gaps: ChartGap[];
}

const fixed = (value: number): string => value.toFixed(1);

/** The model of a series, or null when there is less than a line to draw. */
export function goldChartModel(series: readonly GoldSample[], durationSec: number): GoldChartModel | null {
  if (series.length < 2) return null;
  const span = Math.max(1, durationSec, series[series.length - 1].timeSec);
  const maxDiff = Math.max(...series.map((sample) => sample.diff));
  const minDiff = Math.min(...series.map((sample) => sample.diff));
  const step = niceStep(Math.max(Math.abs(maxDiff), Math.abs(minDiff)));
  const yMax = Math.max(step, Math.ceil(maxDiff / step) * step);
  const yMin = Math.min(-step, Math.floor(minDiff / step) * step);
  const range = yMax - yMin;
  const x = (timeSec: number) => timeSec / span;
  const y = (diff: number) => (yMax - diff) / range;

  const ticks: GoldChartModel["ticks"] = [];
  for (let value = yMax; value >= yMin; value -= step) ticks.push({ value, top: y(value) });

  const points = series.map<ChartPoint>((sample) => ({ timeSec: sample.timeSec, diff: sample.diff, x: x(sample.timeSec), y: y(sample.diff) }));

  // Runs of samples that were seen one minute after the other.
  const groups: GoldSample[][] = [];
  series.forEach((sample, index) => {
    const previous = series[index - 1];
    if (!previous || sample.minute - previous.minute > 1) groups.push([sample]);
    else groups[groups.length - 1].push(sample);
  });

  const runs: ChartRun[] = [];
  const isolated: ChartPoint[] = [];
  for (const group of groups) {
    if (group.length < 2) {
      const only = group[0];
      isolated.push({ timeSec: only.timeSec, diff: only.diff, x: x(only.timeSec), y: y(only.diff) });
      continue;
    }
    runs.push(runOf(group, x, y));
  }

  const gaps: ChartGap[] = [];
  for (let i = 1; i < series.length; i += 1) {
    if (series[i].minute - series[i - 1].minute > 1) {
      const fromSec = series[i - 1].timeSec;
      const toSec = series[i].timeSec;
      gaps.push({ fromSec, toSec, left: x(fromSec), width: x(toSec) - x(fromSec) });
    }
  }

  return { durationSec: span, yMin, yMax, ticks, zeroTop: y(0), points, runs, isolated, gaps };
}

/** The line of one run, and the two areas between it and the zero line, one for each side of it. */
function runOf(group: readonly GoldSample[], x: (timeSec: number) => number, y: (diff: number) => number): ChartRun {
  const line = group.map((sample, i) => `${i === 0 ? "M" : "L"}${fixed(x(sample.timeSec) * 1000)} ${fixed(y(sample.diff) * 1000)}`).join(" ");

  // The line meets zero between two samples that lie on opposite sides of it: both areas get that point.
  const outline: Array<[number, number]> = [];
  group.forEach((sample, i) => {
    outline.push([sample.timeSec, sample.diff]);
    const next = group[i + 1];
    if (next && sample.diff * next.diff < 0) {
      outline.push([sample.timeSec + ((0 - sample.diff) / (next.diff - sample.diff)) * (next.timeSec - sample.timeSec), 0]);
    }
  });
  const zero = fixed(y(0) * 1000);
  const area = (clip: (diff: number) => number): string =>
    `M${fixed(x(outline[0][0]) * 1000)} ${zero} ` +
    outline.map(([timeSec, diff]) => `L${fixed(x(timeSec) * 1000)} ${fixed(y(clip(diff)) * 1000)}`).join(" ") +
    ` L${fixed(x(outline[outline.length - 1][0]) * 1000)} ${zero} Z`;

  return { line, areaPos: area((diff) => Math.max(diff, 0)), areaNeg: area((diff) => Math.min(diff, 0)) };
}

// ── What the chart says ─────────────────────────────────────────────────

export interface Lead {
  side: TeamSide | null;
  amount: number;
}

/** Who is ahead in a sample, and by how much. */
export function leadOf(sample: Pick<GoldSample, "diff">): Lead {
  return sample.diff === 0 ? { side: null, amount: 0 } : { side: sample.diff > 0 ? "blue" : "red", amount: Math.abs(sample.diff) };
}

export interface LeadAt extends Lead {
  timeSec: number;
}

export interface GoldSummary {
  /** The lead at the last sample. */
  final: LeadAt;
  /** The biggest lead each side had, or null for a side that never led. */
  peakBlue: (LeadAt & { side: "blue" }) | null;
  peakRed: (LeadAt & { side: "red" }) | null;
  partial: boolean;
  gaps: GoldGap[];
}

/** The facts a text alternative needs: where the match ended, each side's best moment, and whether it is partial. */
export function goldSummary(series: readonly GoldSample[], gaps: readonly GoldGap[]): GoldSummary {
  const last = series[series.length - 1];
  const final: LeadAt = { ...leadOf(last), timeSec: last.timeSec };
  const best = series.reduce<{ blue: GoldSample | null; red: GoldSample | null }>(
    (peaks, sample) => ({
      blue: sample.diff > 0 && (!peaks.blue || sample.diff > peaks.blue.diff) ? sample : peaks.blue,
      red: sample.diff < 0 && (!peaks.red || sample.diff < peaks.red.diff) ? sample : peaks.red,
    }),
    { blue: null, red: null },
  );
  return {
    final,
    peakBlue: best.blue ? { side: "blue", amount: best.blue.diff, timeSec: best.blue.timeSec } : null,
    peakRed: best.red ? { side: "red", amount: Math.abs(best.red.diff), timeSec: best.red.timeSec } : null,
    partial: gaps.length > 0,
    gaps: [...gaps],
  };
}

/** The sample nearest to a place across the plot (0 to 1), for a pointer or a keyboard step. Null for an empty chart. */
export function nearestIndex(points: ReadonlyArray<Pick<ChartPoint, "x">>, x: number): number | null {
  if (points.length === 0) return null;
  const at = Math.max(0, Math.min(1, x));
  let best = 0;
  points.forEach((point, index) => {
    if (Math.abs(point.x - at) < Math.abs(points[best].x - at)) best = index;
  });
  return best;
}
