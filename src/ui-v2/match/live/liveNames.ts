import type { DragonKind } from "@/lib/match/live/liveEvents";
import type { TeamSide } from "@/lib/match/live/mapGeometry";

/**
 * Translation keys the panels of the live match share with the map layers. Kept as literal
 * strings in const maps so the key guards can see every one of them.
 */

export const DRAGON_NAME_KEYS: Readonly<Record<DragonKind, string>> = {
  infernal: "onAir.match.pit.dragonInfernal",
  ocean: "onAir.match.pit.dragonOcean",
  mountain: "onAir.match.pit.dragonMountain",
  cloud: "onAir.match.pit.dragonCloud",
  hextech: "onAir.match.pit.dragonHextech",
  chemtech: "onAir.match.pit.dragonChemtech",
};

/** A dragon of a kind this build does not know. */
export const DRAGON_PLAIN_KEY = "match.draftResult.timelineEvents.dragon";

export const TEAM_KEYS: Readonly<Record<TeamSide, string>> = {
  blue: "onAir.match.team.blue",
  red: "onAir.match.team.red",
};
