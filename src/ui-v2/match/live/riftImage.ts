/**
 * public/map.webp, 1200x1200: the Summoner's Rift minimap art, in full colour. Measured against
 * the engine coordinates (lanes, towers, inhibitors, nexus, pits; scripts/rift-map/measure-alignment.py):
 * every lane sample and structure lands on walkable ground and both pits sit on the water bulbs,
 * so the picture is drawn 1:1 over the 0..MAP_UNITS square with no transform.
 */
export const RIFT_IMAGE_SRC = "/map.webp";
