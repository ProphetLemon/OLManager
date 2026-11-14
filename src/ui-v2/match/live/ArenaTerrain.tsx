import { memo } from "react";
import { MAP_UNITS } from "@/lib/match/live/mapGeometry";
import { RIFT_IMAGE_SRC } from "./riftImage";

/**
 * Static terrain of the arena: the Summoner's Rift picture in full colour over the terrain
 * ground. It never changes while a match runs, so it costs nothing per frame, and it is
 * decoration only (the Fight board is the text twin). The picture lines up 1:1 with the engine
 * coordinates, so the layers above need no offset. Its lanes are pale in every theme, which is
 * why each marker, tag and beam above it wears the dark `--map-casing` (see liveMatch.css).
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
      <image
        href={RIFT_IMAGE_SRC}
        x={0}
        y={0}
        width={MAP_UNITS}
        height={MAP_UNITS}
        preserveAspectRatio="xMidYMid meet"
      />
    </svg>
  );
});
