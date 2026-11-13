import { memo } from "react";
import {
  BASE_ZONES,
  LANES,
  LANE_INNER_STROKE_UNITS,
  LANE_KEYS,
  LANE_STROKE_UNITS,
  MAP_UNITS,
  PIT_RADIUS_UNITS,
  PITS,
  RIVER,
  RIVER_STROKE_UNITS,
  type MapPoint,
} from "@/lib/match/live/mapGeometry";

const toPoints = (line: readonly MapPoint[]) => line.map((p) => `${p.x},${p.y}`).join(" ");

const ROUND = { strokeLinecap: "round", strokeLinejoin: "round" } as const;

/**
 * Static schematic of the arena: ground, bases, river, three lanes and the two
 * pits. It never changes while a match runs, so it costs nothing per frame, and
 * it is decoration only (the Fight board is the text twin). Colours come from
 * the `--terrain-*` tokens and the team tokens.
 */
export const ArenaTerrain = memo(function ArenaTerrain({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox={`0 0 ${MAP_UNITS} ${MAP_UNITS}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      data-testid="arena-terrain"
    >
      <rect width={MAP_UNITS} height={MAP_UNITS} style={{ fill: "var(--terrain-ground)" }} />
      <path d={BASE_ZONES.blue.path} data-base="blue" fillOpacity={0.18} style={{ fill: "var(--team-blue)" }} />
      <path d={BASE_ZONES.red.path} data-base="red" fillOpacity={0.18} style={{ fill: "var(--team-red)" }} />
      <polyline
        points={toPoints(RIVER)}
        data-part="river"
        fill="none"
        strokeWidth={RIVER_STROKE_UNITS}
        style={{ stroke: "var(--terrain-river)" }}
        {...ROUND}
      />
      <g fill="none" {...ROUND}>
        {LANE_KEYS.map((lane) => (
          <polyline
            key={`${lane}-edge`}
            points={toPoints(LANES[lane])}
            data-lane={lane}
            data-part="edge"
            strokeWidth={LANE_STROKE_UNITS}
            style={{ stroke: "var(--terrain-lane-edge)" }}
          />
        ))}
        {LANE_KEYS.map((lane) => (
          <polyline
            key={`${lane}-fill`}
            points={toPoints(LANES[lane])}
            data-lane={lane}
            data-part="fill"
            strokeWidth={LANE_INNER_STROKE_UNITS}
            style={{ stroke: "var(--terrain-lane)" }}
          />
        ))}
      </g>
      {(["top", "dragon"] as const).map((key) => (
        <circle
          key={key}
          cx={PITS[key].x}
          cy={PITS[key].y}
          r={PIT_RADIUS_UNITS}
          data-pit={key}
          strokeWidth={4}
          style={{ fill: "var(--terrain-pit)", stroke: "var(--terrain-pit-edge)" }}
        />
      ))}
    </svg>
  );
});
