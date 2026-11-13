import type { MapPoint, TeamSide } from "@/lib/match/live/mapGeometry";
import type { ContactChampion, ContactStructure } from "@/lib/match/live/contacts";

/**
 * The one input of the spotlight caption and the Fight board: the engine's
 * champions and structures for a single answer, plus the clock. Both read the
 * same engagements (contacts, tower fire, recalls, deaths), so they share it.
 * The runtime state is assignable to these shapes; fields the engine does not
 * send stay optional.
 */

export interface LiveChampion extends ContactChampion {
  name: string;
  team: TeamSide;
  pos: MapPoint;
  level?: number;
  hp?: number;
  maxHp?: number;
}

export interface LiveStructure extends ContactStructure {
  team: TeamSide;
  kind?: string;
  pos?: MapPoint;
}

/** Who a row or a line is about; the screen picks the colour and shape from `team`. */
export interface ChampionRef {
  id: string;
  name: string;
  team: TeamSide;
}

export const refOf = (champion: Pick<LiveChampion, "id" | "name" | "team">): ChampionRef => ({
  id: champion.id,
  name: champion.name,
  team: champion.team,
});
