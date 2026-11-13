import { memo } from "react";
import { MAP_UNITS } from "@/lib/match/live/mapGeometry";
import { NIGHT_FILTER_ID, NightFilter, TOKENS_FILTER_ID, TokensFilter } from "./ArenaTerrainFilters";
import {
  NIGHT_IMAGE_OPACITY,
  RIFT_IMAGE_SRC,
  TERRAIN_DIRECTION,
  type TerrainDirection,
} from "./terrainDirection";

/**
 * Static terrain of the arena: the Summoner's Rift picture over the terrain ground. It never
 * changes while a match runs, so it costs nothing per frame, and it is decoration only (the Fight
 * board is the text twin). The picture lines up 1:1 with the engine coordinates, so the layers
 * above need no offset. The direction (see terrainDirection.ts) only changes how it is filtered.
 */
export const ArenaTerrain = memo(function ArenaTerrain({
  className,
  direction = TERRAIN_DIRECTION,
}: {
  className?: string;
  direction?: TerrainDirection;
}) {
  const filterId = direction === "night" ? NIGHT_FILTER_ID : direction === "tokens" ? TOKENS_FILTER_ID : null;
  return (
    <svg
      className={className}
      viewBox={`0 0 ${MAP_UNITS} ${MAP_UNITS}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      data-testid="arena-terrain"
      data-direction={direction}
    >
      {direction === "night" ? <NightFilter /> : null}
      {direction === "tokens" ? <TokensFilter /> : null}
      <rect width={MAP_UNITS} height={MAP_UNITS} style={{ fill: "var(--terrain-ground)" }} />
      <image
        href={RIFT_IMAGE_SRC}
        x={0}
        y={0}
        width={MAP_UNITS}
        height={MAP_UNITS}
        preserveAspectRatio="xMidYMid meet"
        opacity={direction === "night" ? NIGHT_IMAGE_OPACITY : undefined}
        filter={filterId ? `url(#${filterId})` : undefined}
      />
    </svg>
  );
});
