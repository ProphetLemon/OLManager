import { NEUTRAL_OBJECTIVE_ICON_PATH, STRUCTURE_ICON_PATH } from "@/lib/match/lolMapLayout";
import type { TimelineEntry } from "@/lib/match/live/postGameTimeline";
import type { Side } from "@/lib/match/live/postGame";

/** The summoner spells the engine sends, by key, and the icon of each in /public. A key not listed shows its letter. */
const SPELL_ICONS: Readonly<Record<string, string>> = {
  flash: "/lol-summoner-icons/SummonerFlash.png",
  teleport: "/lol-summoner-icons/SummonerTeleport.png",
  smite: "/lol-summoner-icons/SummonerSmite.png",
  heal: "/lol-summoner-icons/SummonerHeal.png",
  ignite: "/lol-summoner-icons/SummonerDot.png",
};

export const spellIcon = (key: string): string | null => SPELL_ICONS[key] ?? null;

export const itemIcon = (key: string): string => `/lol-item-icons/${key}.png`;

export const championTile = (championKey: string): string => `/champion-tiles/${championKey}.webp`;

const other = (side: Side): Side => (side === "blue" ? "red" : "blue");

/**
 * The map icon of an objective or structure event, in its owner's colour for a structure. A kill has
 * none (its portrait is the icon), and neither has anything the map has no icon for.
 */
export function entryIcon(entry: Pick<TimelineEntry, "kind" | "side" | "structureOwner" | "dragonKind">): string | null {
  const owner: Side | null = entry.structureOwner ?? (entry.side ? other(entry.side) : null);
  switch (entry.kind) {
    case "tower":
      return owner ? STRUCTURE_ICON_PATH[`tower_${owner}`] : null;
    case "inhibitor":
      return owner ? STRUCTURE_ICON_PATH[`inhibitor_${owner}`] : null;
    case "nexus":
      return owner ? STRUCTURE_ICON_PATH[`nexus_${owner}`] : null;
    case "dragon":
      return entry.dragonKind ? NEUTRAL_OBJECTIVE_ICON_PATH[`dragon_${entry.dragonKind}`] : NEUTRAL_OBJECTIVE_ICON_PATH.dragon;
    case "elder":
      return NEUTRAL_OBJECTIVE_ICON_PATH.dragon_elder;
    case "herald":
      return NEUTRAL_OBJECTIVE_ICON_PATH.riftherald;
    case "grub":
      return NEUTRAL_OBJECTIVE_ICON_PATH.grub;
    case "baron":
      return NEUTRAL_OBJECTIVE_ICON_PATH.baron;
    default:
      return null;
  }
}
