import { HALF_MAP_UNITS, NIGHT_SATURATION } from "./terrainDirection";
import { MAP_UNITS } from "@/lib/match/live/mapGeometry";

export const NIGHT_FILTER_ID = "arena-terrain-night";
export const TOKENS_FILTER_ID = "arena-terrain-tokens";

const FILTER_REGION = {
  filterUnits: "userSpaceOnUse",
  primitiveUnits: "userSpaceOnUse",
  x: 0,
  y: 0,
  width: MAP_UNITS,
  height: MAP_UNITS,
  colorInterpolationFilters: "sRGB",
} as const;

/** Alpha-only mask rows: the colour rows are zero, the last row builds the alpha from the picture. */
const mask = (alphaRow: string) => `0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${alphaRow}`;

/** Anything that is not the black jungle wall or the black outside: luminance, stretched. */
const WALKABLE = mask("3 5.9 1.1 0 -2");
/** The pale lanes and jungle paths: red well above blue. */
const PATH = mask("10 0 -10 0 -0.3");
/** The river and the pits' water: blue well above red. */
const WATER = mask("-4 0 4 0 -1");

const flood = (token: string, opacity?: number) => ({
  style: { floodColor: `var(${token})` },
  ...(opacity === undefined ? {} : { floodOpacity: opacity }),
});

/** Same picture, less colour; the dimming is the image opacity over the terrain ground. */
export function NightFilter() {
  return (
    <filter id={NIGHT_FILTER_ID} {...FILTER_REGION}>
      <feColorMatrix type="saturate" values={String(NIGHT_SATURATION)} />
    </filter>
  );
}

/**
 * Rebuilds the picture from three masks read off it (walkable ground, pale paths, water) and
 * the terrain tokens. Layers, bottom to top: wall, base, path, water, then each team's wash over
 * the base pixels of its own corner (blue bottom left, red top right).
 */
export function TokensFilter() {
  return (
    <filter id={TOKENS_FILTER_ID} {...FILTER_REGION}>
      <feColorMatrix in="SourceGraphic" type="matrix" values={WALKABLE} result="walkable" />
      <feColorMatrix in="SourceGraphic" type="matrix" values={PATH} result="path" />
      <feColorMatrix in="SourceGraphic" type="matrix" values={WATER} result="water" />
      <feComposite in="walkable" in2="path" operator="out" result="baseA" />
      <feComposite in="baseA" in2="water" operator="out" result="baseMask" />

      <feFlood {...flood("--terrain-wall")} result="wallFill" />
      <feFlood {...flood("--terrain-base")} result="baseFill" />
      <feComposite in="baseFill" in2="walkable" operator="in" result="baseLayer" />
      <feFlood {...flood("--terrain-path")} result="pathFill" />
      <feComposite in="pathFill" in2="path" operator="in" result="pathLayer" />
      <feFlood {...flood("--terrain-river")} result="waterFill" />
      <feComposite in="waterFill" in2="water" operator="in" result="waterLayer" />

      <feFlood x={0} y={HALF_MAP_UNITS} width={HALF_MAP_UNITS} height={HALF_MAP_UNITS} {...flood("--team-blue", 0.22)} result="blueFill" />
      <feComposite in="blueFill" in2="baseMask" operator="in" result="blueWash" />
      <feFlood x={HALF_MAP_UNITS} y={0} width={HALF_MAP_UNITS} height={HALF_MAP_UNITS} {...flood("--team-red", 0.22)} result="redFill" />
      <feComposite in="redFill" in2="baseMask" operator="in" result="redWash" />

      <feMerge>
        <feMergeNode in="wallFill" />
        <feMergeNode in="baseLayer" />
        <feMergeNode in="pathLayer" />
        <feMergeNode in="waterLayer" />
        <feMergeNode in="blueWash" />
        <feMergeNode in="redWash" />
      </feMerge>
    </filter>
  );
}
