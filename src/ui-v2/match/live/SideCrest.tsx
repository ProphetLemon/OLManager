import { useEffect, useState } from "react";

import type { TeamSide } from "@/lib/match/live/mapGeometry";
import type { TeamIdentity } from "@/lib/match/live/teamIdentity";

import "./liveMatch.css";

/** First letter of the club's name, or of its tag when the name is empty. */
export function crestInitial(identity: Pick<TeamIdentity, "name" | "tag">): string {
  return (identity.name.trim() || identity.tag.trim()).slice(0, 1).toUpperCase();
}

export interface SideCrestProps {
  side: TeamSide;
  identity: Pick<TeamIdentity, "name" | "tag" | "logoUrl">;
  /** CSS length for the plate; the stylesheet's default when left out. */
  size?: string;
}

/**
 * The club's logo on a light plate, ringed in the club's colour: round for blue, a rounded
 * square for red. A club with no logo, or one that fails to load, shows its initial on the club's
 * fill. Decorative: the club's name sits next to it in text.
 */
export function SideCrest({ side, identity, size }: SideCrestProps) {
  const [failed, setFailed] = useState(false);
  // A new logo gets a fresh chance to load.
  useEffect(() => setFailed(false), [identity.logoUrl]);
  const style = size ? ({ "--crest-size": size } as React.CSSProperties) : undefined;
  if (!identity.logoUrl || failed) {
    return (
      <span className="arena-crest" data-team={side} data-fallback="true" style={style} aria-hidden="true">
        {crestInitial(identity)}
      </span>
    );
  }
  return (
    <span className="arena-crest" data-team={side} style={style} aria-hidden="true">
      <img src={identity.logoUrl} alt="" draggable={false} onError={() => setFailed(true)} />
    </span>
  );
}
