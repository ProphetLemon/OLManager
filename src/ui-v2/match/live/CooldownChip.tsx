import { Crosshair, Globe, HeartPulse, Lock, Shield, Swords, Target, Zap, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { initialsOf } from "@/lib/match/live/championMarker";
import type { CooldownChip as ChipView } from "@/lib/match/live/playerCardView";
import { IconTip } from "@/ui-v2/components/ui/icon-tip";

import "./liveMatch.css";

/** The glyph that stands in for an ultimate's icon when there is none: one per archetype of the kits. */
const ARCHETYPE_GLYPH: Readonly<Record<string, LucideIcon>> = {
  burst: Zap,
  engage: Swords,
  defensive: Shield,
  execute: Crosshair,
  zone: Target,
  sustain: HeartPulse,
  global: Globe,
};

export const archetypeGlyph = (archetype: string | null): LucideIcon => (archetype && ARCHETYPE_GLYPH[archetype]) || Zap;

export interface CooldownChipProps {
  chip: ChipView;
  /** What the chip says when hovered or pressed, and what the card's description repeats. */
  label: string;
  /** The item's name, for the initials that stand in for a trinket icon that fails to load. */
  name: string;
}

/** The image of an ultimate or a trinket, or what stands in for it. A summoner spell has no image: its letter. */
function Face({ chip, name }: { chip: ChipView; name: string }) {
  const [failed, setFailed] = useState(false);
  // A new icon gets a fresh chance to load.
  useEffect(() => setFailed(false), [chip.icon]);
  if (chip.icon && !failed) {
    return <img src={chip.icon} alt="" draggable={false} onError={() => setFailed(true)} />;
  }
  if (chip.kind === "ultimate") {
    const Glyph = archetypeGlyph(chip.archetype);
    return <Glyph className="arena-cd-glyph" aria-hidden="true" focusable="false" />;
  }
  return <span aria-hidden="true">{chip.kind === "trinket" ? initialsOf(name) : chip.letter}</span>;
}

/**
 * One cooldown on a player card. The ultimate and the trinket show their icon; a summoner spell
 * shows its letter. The state is never colour alone: ready is a solid double frame and the bare
 * icon, waiting is a dashed frame, a dimmed icon and the seconds, locked is a dotted frame, a
 * greyed icon and a lock. Every chip is named by `label` (tip) and by the card's description.
 */
export function CooldownChip({ chip, label, name }: CooldownChipProps) {
  const waiting = chip.state === "waiting";
  if (chip.kind === "summoner") {
    return (
      <IconTip className="arena-cd" data-ready={!waiting || undefined} data-state={chip.state} label={label} data-testid="card-cd">
        {waiting ? `${chip.letter} ${chip.seconds}` : chip.letter}
      </IconTip>
    );
  }
  return (
    <IconTip
      className={chip.kind === "ultimate" ? "arena-cd arena-cd-icon arena-cd-ult" : "arena-cd arena-cd-icon arena-cd-trinket"}
      data-ready={chip.state === "ready" || undefined}
      data-state={chip.state}
      label={label}
      data-testid="card-cd"
    >
      <Face chip={chip} name={name} />
      {waiting ? <b className="arena-cd-secs">{chip.seconds}</b> : null}
      {chip.state === "locked" ? <Lock className="arena-cd-lock" aria-hidden="true" focusable="false" /> : null}
    </IconTip>
  );
}
