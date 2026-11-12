import championListSeed from "../../../assets/simulation/champion-list.json";
import { normalizeChampionKey } from "./championIds";

const DISPLAY_NAMES: ReadonlyMap<string, string> = new Map(
  (championListSeed as { champions: Array<{ id: string; name: string }> }).champions.map((champion) => [
    champion.id,
    champion.name,
  ]),
);

/**
 * Display name of a champion ("Aurelion Sol", "Dr. Mundo", "Wukong") from its id or key.
 * Champion names are game data and are not translated. Falls back to `fallback`
 * (or the key itself) when the champion is not in the game's champion list.
 */
export function championDisplayName(key: string, fallback?: string): string {
  return DISPLAY_NAMES.get(normalizeChampionKey(key)) ?? fallback ?? key;
}
