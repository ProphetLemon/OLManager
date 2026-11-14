import { Table2 } from "lucide-react";
import { useMemo, useState, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";

import { formatClock } from "@/lib/match/live/clock";
import { compactGold } from "@/lib/match/live/formatNumbers";
import { goldChartModel, goldSummary, leadOf, nearestIndex } from "@/lib/match/live/goldChart";
import { goldGaps, type GoldSample, type MatchRecord } from "@/lib/match/live/matchRecord";
import { placeMarkers, type TimelineEntry } from "@/lib/match/live/postGameTimeline";
import type { TeamIdentity } from "@/lib/match/live/teamIdentity";
import { eventSentence } from "../live/eventSentence";
import { entryIcon } from "./postGameIcons";
import "./postGame.css";

export interface GoldDiffChartProps {
  record: MatchRecord | undefined;
  durationSec: number;
  /** Objectives and structures, for the markers on the time axis. */
  entries: TimelineEntry[];
  blue: TeamIdentity;
  red: TeamIdentity;
}

const pct = (fraction: number): string => `${(fraction * 100).toFixed(2)}%`;
const ROW = 1.5;

/** "+8k", "0", "-2k": the axis labels, in the locale's decimal mark. */
function axisGold(value: number, locale: string): string {
  if (value === 0) return "0";
  const thousands = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Math.abs(value) / 1000);
  return `${value > 0 ? "+" : "-"}${thousands}k`;
}

/**
 * The team gold difference through the match: one line above the zero line while the blue side
 * leads and below it while the red side does, both areas tinted by team, with the objectives and
 * structures marked on the time axis. A skipped match leaves minutes nobody saw: the line stops,
 * the gap is hatched and named, and the text alternative says the series is partial. The values
 * are always reachable without the picture: a text summary, a slider that reads the chart minute by
 * minute, and a table.
 */
export function GoldDiffChart({ record, durationSec, entries, blue, red }: GoldDiffChartProps) {
  const { t, i18n } = useTranslation();
  const [index, setIndex] = useState<number | null>(null);
  const [table, setTable] = useState(false);

  const series = useMemo<GoldSample[]>(() => [...(record?.gold ?? [])].sort((a, b) => a.timeSec - b.timeSec), [record]);
  const gaps = useMemo(() => goldGaps(series), [series]);
  const model = useMemo(() => goldChartModel(series, durationSec), [series, durationSec]);
  const plan = useMemo(() => placeMarkers(entries, model?.durationSec ?? durationSec), [entries, model, durationSec]);
  const gold = (amount: number) => compactGold(amount, i18n.language);
  const tagOf = (side: "blue" | "red" | null) => (side === "blue" ? blue.tag : side === "red" ? red.tag : "");
  const nameOf = (side: "blue" | "red" | null) => (side === "blue" ? blue.name : side === "red" ? red.name : "");

  const readout = (sample: GoldSample): string => {
    const lead = leadOf(sample);
    return lead.side
      ? t("onAir.match.post.readout", { time: formatClock(sample.timeSec), team: tagOf(lead.side), amount: gold(lead.amount) })
      : t("onAir.match.post.readoutEven", { time: formatClock(sample.timeSec) });
  };

  const summary = useMemo(() => {
    if (!model || series.length === 0) return "";
    const facts = goldSummary(series, gaps);
    const parts = [t("onAir.match.post.goldSummary")];
    parts.push(
      facts.final.side
        ? t("onAir.match.end.lead", { team: nameOf(facts.final.side), amount: gold(facts.final.amount) })
        : t("onAir.match.end.leadEven"),
    );
    for (const peak of [facts.peakBlue, facts.peakRed]) {
      if (peak) parts.push(t("onAir.match.post.peak", { team: nameOf(peak.side), amount: gold(peak.amount), time: formatClock(peak.timeSec) }));
    }
    for (const gap of facts.gaps) parts.push(t("onAir.match.post.partial", { from: formatClock(gap.fromSec), to: formatClock(gap.toSec) }));
    return parts.join(" ");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, series, gaps, t, i18n.language, blue.name, red.name]);

  const header = (
    <div className="pg-panel-head">
      <h3 id="pg-golddiff-title">{t("onAir.match.post.goldTitle")}</h3>
      {gaps.length > 0 ? <span className="pg-badge">{t("onAir.match.post.partialBadge")}</span> : null}
      {model ? (
        <span className="pg-readout" aria-hidden="true">
          {readout(series[index ?? series.length - 1])}
        </span>
      ) : null}
      {model ? (
        <button type="button" className="pg-toggle" aria-pressed={table} onClick={() => setTable((on) => !on)}>
          <Table2 aria-hidden="true" focusable="false" />
          {t("onAir.match.post.table")}
        </button>
      ) : null}
    </div>
  );

  if (!model) {
    return (
      <section className="pg-panel" data-kind="line" aria-labelledby="pg-golddiff-title" data-testid="gold-diff-chart">
        {header}
        <p className="pg-note">{t("onAir.match.post.goldNone")}</p>
      </section>
    );
  }

  const point = index === null ? null : model.points[index];
  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    const next = nearestIndex(model.points, (event.clientX - box.left) / box.width);
    if (next !== index) setIndex(next);
  };

  const epicRows = plan.epicLevels;
  const railHeight = (epicRows + plan.structureLevels) * ROW + (epicRows > 0 && plan.structureLevels > 0 ? 0.375 : 0) + 0.125;
  const markerTop = (marker: { row: "epic" | "structure"; level: number }) =>
    marker.row === "epic" ? marker.level * ROW : epicRows * ROW + (epicRows > 0 ? 0.375 : 0) + marker.level * ROW;

  const xTicks: number[] = [];
  for (let minute = 0; minute * 60 < model.durationSec; minute += 5) xTicks.push(minute * 60);
  // The last label would sit on the end label: drop it.
  if (xTicks.length > 1 && model.durationSec - xTicks[xTicks.length - 1] < model.durationSec * 0.06) xTicks.pop();

  return (
    <section className="pg-panel" data-kind="line" aria-labelledby="pg-golddiff-title" aria-describedby="pg-golddiff-summary" data-testid="gold-diff-chart">
      {header}
      <p className="sr-only" id="pg-golddiff-summary">
        {summary}
      </p>
      {table ? (
        <div className="pg-values">
          <table aria-label={t("onAir.match.post.goldTableLabel")}>
            <thead>
              <tr>
                <th scope="col">{t("onAir.match.post.columnTime")}</th>
                <th scope="col">{t("onAir.match.post.goldTitle")}</th>
              </tr>
            </thead>
            <tbody>
              {series.map((sample, i) => {
                const gap = gaps.find((candidate) => candidate.toSec === sample.timeSec);
                const lead = leadOf(sample);
                return [
                  gap ? (
                    <tr key={`gap-${i}`} data-gap="true">
                      <td colSpan={2}>{t("onAir.match.post.gapRow", { from: formatClock(gap.fromSec), to: formatClock(gap.toSec) })}</td>
                    </tr>
                  ) : null,
                  <tr key={`s-${i}`}>
                    <th scope="row">{formatClock(sample.timeSec)}</th>
                    <td>{lead.side ? t("onAir.match.post.aheadByGold", { team: tagOf(lead.side), amount: gold(lead.amount) }) : t("match.draftResult.evenGold")}</td>
                  </tr>,
                ];
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="pg-lc">
          <div className="pg-yax" aria-hidden="true">
            {model.ticks.map((tick) => (
              <span key={tick.value} style={{ top: pct(tick.top) }}>
                {axisGold(tick.value, i18n.language)}
              </span>
            ))}
          </div>
          <div className="pg-plot" onPointerMove={onMove} onPointerLeave={() => setIndex(null)}>
            {model.ticks.map((tick) => (
              <i key={tick.value} className="pg-grid" data-zero={tick.value === 0 || undefined} style={{ top: pct(tick.top) }} aria-hidden="true" />
            ))}
            {model.gaps.map((gap) => (
              <span key={gap.fromSec} className="pg-gap" style={{ left: pct(gap.left), width: pct(gap.width) }} aria-hidden="true" data-testid="gold-gap">
                <span className="pg-gap-label">{t("onAir.match.post.gapLabel")}</span>
              </span>
            ))}
            <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
              {model.runs.map((run) => (
                <g key={run.line}>
                  <path className="pg-area-blue" d={run.areaPos} />
                  <path className="pg-area-red" d={run.areaNeg} />
                  <path className="pg-line" d={run.line} data-testid="gold-line" />
                </g>
              ))}
            </svg>
            {model.isolated.map((dot) => (
              <i key={dot.timeSec} className="pg-dot" style={{ left: pct(dot.x), top: pct(dot.y) }} aria-hidden="true" />
            ))}
            <span className="pg-sidetag" data-team="blue" aria-hidden="true">
              <i className="pg-shape" data-team="blue" />
              {t("onAir.match.post.ahead", { team: blue.tag })}
            </span>
            <span className="pg-sidetag" data-team="red" aria-hidden="true">
              <i className="pg-shape" data-team="red" />
              {t("onAir.match.post.ahead", { team: red.tag })}
            </span>
            {point ? (
              <>
                <i className="pg-cross" style={{ left: pct(point.x) }} aria-hidden="true" />
                <i className="pg-cross-dot" style={{ left: pct(point.x), top: pct(point.y) }} aria-hidden="true" />
                <span className="pg-tip" style={{ left: pct(Math.min(0.9, Math.max(0.1, point.x))) }} aria-hidden="true">
                  {readout(series[index ?? 0])}
                </span>
              </>
            ) : null}
            <input
              className="pg-scrub"
              type="range"
              min={0}
              max={series.length - 1}
              step={1}
              value={index ?? series.length - 1}
              aria-label={t("onAir.match.post.scrubLabel")}
              aria-valuetext={readout(series[index ?? series.length - 1])}
              onChange={(event) => setIndex(Number(event.target.value))}
              onBlur={() => setIndex(null)}
            />
          </div>
          <div className="pg-rail" style={{ height: `${railHeight}rem` }} role="group" aria-label={t("onAir.match.post.markersLabel")}>
            {plan.markers.map((marker) => {
              const first = marker.entries[0];
              const last = marker.entries[marker.entries.length - 1];
              const label =
                marker.count > 1
                  ? t("onAir.match.post.markerRun", { from: formatClock(first.t), to: formatClock(last.t), count: marker.count, team: nameOf(marker.side) })
                  : `${formatClock(first.t)}, ${eventSentence(first.event, t, { blue: blue.tag, red: red.tag })}`;
              const icon = entryIcon({ kind: marker.kind, side: marker.side, structureOwner: first.structureOwner, dragonKind: marker.dragonKind });
              return (
                <span
                  key={marker.id}
                  className="pg-marker"
                  data-team={marker.side ?? undefined}
                  data-kind={marker.kind}
                  style={{ left: pct(marker.left), top: `${markerTop(marker)}rem` }}
                  role="img"
                  aria-label={label}
                  title={label}
                >
                  {icon ? <img src={icon} alt="" draggable={false} /> : null}
                  {marker.count > 1 ? <sup>{marker.count}</sup> : null}
                </span>
              );
            })}
          </div>
          <div className="pg-xax" aria-hidden="true">
            {xTicks.map((sec) => (
              <span key={sec} style={{ left: pct(sec / model.durationSec) }}>
                {formatClock(sec)}
              </span>
            ))}
            <span style={{ left: "100%" }}>{formatClock(model.durationSec)}</span>
          </div>
        </div>
      )}
    </section>
  );
}
