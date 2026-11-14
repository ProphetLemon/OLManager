import { useEffect, useState } from "react";

import { initialsOf } from "@/lib/match/live/championMarker";
import type { Side } from "@/lib/match/live/postGame";

import { championTile } from "./postGameIcons";

export interface PortraitProps {
  side: Side;
  /** Key of the champion the player picked; without one the player's initials stand in. */
  championKey?: string;
  /** The player's name, for the initials. */
  name: string;
  size?: "sm" | "md";
}

/**
 * The champion's tile in a ring of the club's colour: round for blue, a rounded square for red, so
 * the side never rests on colour alone. Decorative: the name always sits next to it.
 */
export function Portrait({ side, championKey, name, size = "md" }: PortraitProps) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [championKey]);
  return (
    <span className="pg-portrait" data-team={side} data-size={size} aria-hidden="true">
      {championKey && !failed ? (
        <img src={championTile(championKey)} alt="" draggable={false} onError={() => setFailed(true)} />
      ) : (
        <span>{initialsOf(name)}</span>
      )}
    </span>
  );
}
