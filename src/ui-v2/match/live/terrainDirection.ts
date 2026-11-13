import { MAP_UNITS } from "@/lib/match/live/mapGeometry";

/**
 * How the arena draws the Summoner's Rift picture under the layers.
 *  - original: the picture as it was painted.
 *  - night: the same picture dimmed and desaturated so it sits in the dark On Air screen.
 *  - tokens: the picture recoloured through an SVG filter: walls, paths, bases and water take the
 *    `--terrain-*` tokens, each base is washed with its team token.
 */
export const TERRAIN_DIRECTIONS = ["original", "night", "tokens"] as const;
export type TerrainDirection = (typeof TERRAIN_DIRECTIONS)[number];

/** The one line a reviewer changes to compare the directions. */
export const TERRAIN_DIRECTION: TerrainDirection = "tokens";

/**
 * public/map.webp, 1200x1200. Measured against the engine coordinates (lanes, towers, inhibitors,
 * nexus, pits; scripts/rift-map/measure-alignment.py): every lane sample and structure lands on
 * walkable ground and both pits sit on the water bulbs, so the picture is drawn 1:1 over the
 * 0..MAP_UNITS square with no transform.
 */
export const RIFT_IMAGE_SRC = "/map.webp";

/** Share of the picture that shows through in the night direction; the rest is the terrain ground. */
export const NIGHT_IMAGE_OPACITY = 0.34;
export const NIGHT_SATURATION = 0.6;

export const HALF_MAP_UNITS = MAP_UNITS / 2;
