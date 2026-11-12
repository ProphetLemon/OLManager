import type { MouseEvent } from "react";
import { SOLOQ_TIER_COLORS, type SoloQTier } from "@/lib/players/soloq";
import {
  CHART,
  dayIndexFromFraction,
  type ChartModel,
  type DayTone,
  type Translate,
} from "@/lib/players/soloqHistory";
import { cn } from "@/ui-v2/lib/utils";

const TONE_FILL: Record<DayTone, string> = {
  positive: "fill-positive",
  warning: "fill-warning",
  negative: "fill-negative",
  foreground: "fill-foreground",
  dim: "fill-none stroke-dim",
};

const THRESHOLD_TIER: Record<string, SoloQTier> = {
  challenger: "Challenger",
  grandmaster: "Grandmaster",
  floor: "Master",
};

const HALO = { paintOrder: "stroke", strokeWidth: 4, strokeLinejoin: "round" } as const;

interface SoloqLpChartV2Props {
  model: ChartModel;
  decayOn: boolean;
  start: number;
  last: number;
  onSelect: (index: number) => void;
  t: Translate;
}

/**
 * The LP line over tier bands, with idle/decay spans behind it, the formula line when decay is on,
 * and a day-kind strip under the plot. One transparent overlay maps the pointer to the nearest day,
 * however many days are shown; the day buttons and slider next to it do the same from the keyboard.
 */
export default function SoloqLpChartV2({ model, decayOn, start, last, onSelect, t }: SoloqLpChartV2Props) {
  const plotWidth = CHART.right - CHART.left;

  function pickFromPointer(event: MouseEvent<SVGRectElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    if (!box.width) return;
    onSelect(dayIndexFromFraction((event.clientX - box.left) / box.width, start, last));
  }

  return (
    <div
      role="region"
      aria-label={t("soloqHistory.chart.region")}
      tabIndex={0}
      className="overflow-x-auto rounded-lg bg-rail focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <svg
        viewBox={`0 0 ${CHART.width} ${CHART.height}`}
        role="img"
        aria-label={model.label}
        className="block h-auto w-full min-w-[860px]"
      >
        <defs>
          <pattern id="soloq-decay-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="7" className="stroke-negative" strokeOpacity="0.55" strokeWidth="2" />
          </pattern>
        </defs>

        {model.bands.map((band) => (
          <g key={band.tier} className={SOLOQ_TIER_COLORS[band.tier]}>
            <rect x={CHART.left} y={band.y} width={plotWidth} height={band.h} className="fill-current" fillOpacity="0.07" />
            {band.showName ? (
              <text
                x={CHART.right + 10}
                y={band.labelY}
                className="fill-current font-heading uppercase"
                style={{ fontSize: 16, fontWeight: 700, letterSpacing: "0.04em" }}
              >
                {band.tier}
              </text>
            ) : null}
          </g>
        ))}

        {model.yTicks.map((tick) => (
          <g key={tick.label}>
            <line x1={CHART.left} x2={CHART.right} y1={tick.y} y2={tick.y} className="stroke-line" strokeWidth="1" />
            <text x={CHART.left - 10} y={tick.labelY} textAnchor="end" className="fill-muted-foreground" fontSize="14">
              {tick.label}
            </text>
          </g>
        ))}

        {model.thresholds.map((line) => (
          <g key={line.id} className={SOLOQ_TIER_COLORS[THRESHOLD_TIER[line.id]]}>
            <line
              x1={CHART.left}
              x2={CHART.right}
              y1={line.y}
              y2={line.y}
              className="stroke-current"
              strokeWidth="1.5"
              strokeDasharray="1 5"
              strokeLinecap="round"
            />
            <text x={CHART.left - 10} y={line.labelY} textAnchor="end" className="fill-current" fontSize="14" fontWeight="700">
              {line.label}
            </text>
            <text x={CHART.left + 8} y={line.noteY} className="fill-foreground stroke-rail" fontSize="14" style={HALO}>
              {line.text}
            </text>
          </g>
        ))}

        {model.spans.map((span) => (
          <g key={`${span.kind}-${span.x}`}>
            <rect
              x={span.x}
              y={CHART.top}
              width={span.w}
              height={CHART.bottom - CHART.top}
              className={span.kind === "Decay" ? undefined : "fill-warning"}
              fill={span.kind === "Decay" ? "url(#soloq-decay-hatch)" : undefined}
              fillOpacity={span.kind === "Decay" ? undefined : 0.14}
            />
            {span.label ? (
              <text x={span.tx} y={CHART.top - 12} textAnchor="middle" className="fill-foreground" fontSize="14" fontWeight="600">
                {span.label}
              </text>
            ) : null}
          </g>
        ))}

        {decayOn ? (
          <path d={model.formulaPath} fill="none" className="stroke-muted-foreground" strokeWidth="1.5" strokeDasharray="6 4" />
        ) : null}
        <path d={model.mainPath} fill="none" className="stroke-club-text" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {model.decayPath ? (
          <path
            d={model.decayPath}
            fill="none"
            className="stroke-club-text"
            strokeWidth="4"
            strokeDasharray="3 6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}

        {model.xTicks.map((tick) => (
          <g key={`${tick.x}-${tick.label}`}>
            <line x1={tick.x} x2={tick.x} y1={CHART.bottom} y2={CHART.bottom + 6} className="stroke-dim" strokeWidth="1" />
            <text x={tick.x} y={CHART.bottom + 26} textAnchor="middle" className="fill-muted-foreground" fontSize="14">
              {tick.label}
            </text>
          </g>
        ))}

        <line x1={CHART.left} x2={CHART.right} y1={CHART.axisY} y2={CHART.axisY} className="stroke-line" strokeWidth="1" />
        {model.marks.map((mark, index) => (
          <path key={index} d={mark.d} className={cn(TONE_FILL[mark.tone])} strokeWidth="2" />
        ))}

        {model.axisNote ? (
          <text x={CHART.right} y={CHART.height - 10} textAnchor="end" className="fill-muted-foreground" fontSize="14">
            {model.axisNote}
          </text>
        ) : null}

        <line x1={model.selX} x2={model.selX} y1={CHART.top} y2={CHART.axisY + 20} className="stroke-foreground" strokeOpacity="0.55" strokeWidth="1" />
        {model.showFormulaDot ? (
          <circle cx={model.selX} cy={model.selFormulaY} r="4.5" className="fill-rail stroke-muted-foreground" strokeWidth="2" />
        ) : null}
        <circle cx={model.selX} cy={model.selY} r="5.5" className="fill-rail stroke-club-text" strokeWidth="3" />

        {decayOn ? (
          <>
            <text x={CHART.right - 8} y={model.formulaLabelY} textAnchor="end" className="fill-muted-foreground stroke-rail" fontSize="14" fontWeight="600" style={HALO}>
              {t("soloqHistory.chart.formulaLabel")}
            </text>
            <text x={CHART.right - 8} y={model.lpLabelY} textAnchor="end" className="fill-foreground stroke-rail" fontSize="14" fontWeight="600" style={HALO}>
              {t("soloqHistory.chart.decayLabel")}
            </text>
          </>
        ) : null}

        <rect
          data-testid="soloq-chart-overlay"
          x={CHART.left}
          y={CHART.top}
          width={plotWidth}
          height={CHART.axisY + 20 - CHART.top}
          fill="transparent"
          className="cursor-crosshair"
          onMouseMove={pickFromPointer}
          onClick={pickFromPointer}
        />
      </svg>
    </div>
  );
}
