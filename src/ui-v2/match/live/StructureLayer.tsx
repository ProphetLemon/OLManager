import { ChevronsUp } from "lucide-react";
import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { formatCountdown } from "@/lib/match/live/clock";
import type { TowerBeam } from "@/lib/match/live/contacts";
import { anchorTransform, structureDiameterPx, type StructureKind, type TeamSide } from "@/lib/match/live/mapGeometry";
import {
  campViews,
  placePushBadge,
  pushBadges,
  structureViews,
  wardViews,
  type BadgeBox,
  type CampView,
  type PushBadgeView,
  type PushMode,
  type StructureView,
  type WardView,
} from "@/lib/match/live/structuresView";
import type { LolSimV1RuntimeState } from "@/ui-v2/_legacy/components/match/lol-prototype/backend/contract-v1";

import { useMapSize } from "./arenaMapContext";

/** The nexus is named on the map; the word is the one the rest of the match screens use. */
const NEXUS_LABEL_KEY = "match.draftResult.timelineEvents.nexus";

/** What the push badge says, by mode. A countdown carries the time; the others have none. */
export const PUSH_KEYS: Readonly<Record<PushMode, string>> = {
  countdown: "onAir.match.map.push",
  open: "onAir.match.map.pushOpen",
  ending: "onAir.match.map.pushEnding",
};

/** Size assumed for a badge until it has been measured, and in a DOM that measures nothing. */
const FALLBACK_BADGE: BadgeBox = { w: 96, h: 24 };
/** Space between a structure marker and the health bar or label under it, in pixels. */
const UNDER_GAP_PX = 3;

interface StructureMarkerProps {
  id: string;
  team: TeamSide;
  kind: StructureKind;
  x: number;
  y: number;
  dead: boolean;
  hpShare: number | null;
  /** A tower that fired in the last 3 seconds. Its dashed ring is drawn with the beam. */
  firing: boolean;
  label: string | null;
  sizePx: number;
}

/**
 * One tower, inhibitor or nexus. Blue is round and red is a diamond, so the team never rests
 * on colour alone; the kind sets the size and whether the centre is hollow. A destroyed
 * structure is hatched. The health bar only shows once it is damaged. The anchor is placed
 * with `transform`: structures never move, they change only on a committed answer.
 */
const StructureMarker = memo(function StructureMarker({
  id,
  team,
  kind,
  x,
  y,
  dead,
  hpShare,
  firing,
  label,
  sizePx,
}: StructureMarkerProps) {
  const diameter = structureDiameterPx(kind, sizePx);
  const radius = diameter / 2;
  return (
    <div
      className="arena-struct"
      style={{ transform: anchorTransform({ x, y }, sizePx) }}
      data-testid={`structure-${id}`}
      data-team={team}
      data-kind={kind}
      data-dead={dead || undefined}
      data-firing={firing || undefined}
    >
      <div className="arena-struct-body" style={{ width: diameter, height: diameter, left: -radius, top: -radius }} />
      {hpShare !== null || label ? (
        <div className="arena-struct-under" style={{ top: radius + UNDER_GAP_PX }}>
          {hpShare !== null ? (
            <span className="arena-struct-hp" data-testid="structure-hp">
              <i style={{ width: `${Math.round(hpShare * 100)}%` }} />
            </span>
          ) : null}
          {label ? <span className="arena-struct-label">{label}</span> : null}
        </div>
      ) : null}
    </div>
  );
});

function CampMarker({ camp, sizePx }: { camp: CampView; sizePx: number }) {
  return (
    <div
      className="arena-camp"
      style={{ transform: anchorTransform(camp.pos, sizePx) }}
      data-testid="camp"
      data-camp={camp.id}
      data-alive={camp.alive}
    >
      <span className="arena-camp-dot" />
    </div>
  );
}

function WardMarker({ ward, sizePx }: { ward: WardView; sizePx: number }) {
  return (
    <div
      className="arena-ward"
      style={{ transform: anchorTransform(ward.pos, sizePx) }}
      data-testid="ward"
      data-team={ward.team}
    >
      <span className="arena-ward-dot" />
    </div>
  );
}

/**
 * The plan of a team that is ahead: a badge by the structure it goes for, with the time left
 * of the advantage. It is placed from its measured size and kept whole inside the map.
 */
function PushBadge({ badge, text, sizePx }: { badge: PushBadgeView; text: string; sizePx: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<BadgeBox | null>(null);

  // Measured once per text and map size, before paint, so the badge never shows in a wrong place.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const { offsetWidth: w, offsetHeight: h } = element;
    if (w > 0 && h > 0) setMeasured((previous) => (previous && previous.w === w && previous.h === h ? previous : { w, h }));
  }, [text, sizePx]);

  const radius = structureDiameterPx(badge.targetKind, sizePx) / 2;
  const centre = placePushBadge(badge.target, radius, measured ?? FALLBACK_BADGE, sizePx);

  return (
    <div
      ref={ref}
      className="arena-push"
      style={{ transform: `translate(${centre.x}px, ${centre.y}px) translate(-50%, -50%)` }}
      data-testid="push-badge"
      data-team={badge.team}
      data-mode={badge.mode}
      data-target={badge.targetId}
    >
      <ChevronsUp size={14} aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}

export interface StructureLayerProps {
  /** The state of the last engine answer. Nothing in this layer moves between answers. */
  state: LolSimV1RuntimeState;
  /** The towers that are firing, to flag their markers. */
  beams: readonly TowerBeam[];
}

/**
 * What stands on the map: jungle camps, wards, the 30 structures and the push badges, in that
 * order from the ground up. The map is one image for assistive technology, so all of it is
 * hidden from it; the Fight board says in words what matters.
 */
export function StructureLayer({ state, beams }: StructureLayerProps) {
  const { t } = useTranslation();
  const sizePx = useMapSize();

  const structures = useMemo(() => structureViews(state), [state]);
  const camps = useMemo(() => campViews(state), [state]);
  const wards = useMemo(() => wardViews(state), [state]);
  const badges = useMemo(() => pushBadges(state), [state]);
  const firing = useMemo(() => new Set(beams.map((beam) => beam.structureId)), [beams]);
  const nexusLabel = t(NEXUS_LABEL_KEY);

  return (
    <div className="arena-structures" aria-hidden="true" data-testid="structure-layer">
      {camps.map((camp) => (
        <CampMarker key={camp.id} camp={camp} sizePx={sizePx} />
      ))}
      {wards.map((ward) => (
        <WardMarker key={ward.id} ward={ward} sizePx={sizePx} />
      ))}
      {structures.map((structure: StructureView) => (
        <StructureMarker
          key={structure.id}
          id={structure.id}
          team={structure.team}
          kind={structure.kind}
          x={structure.pos.x}
          y={structure.pos.y}
          dead={structure.dead}
          hpShare={structure.hpShare}
          firing={firing.has(structure.id)}
          label={structure.kind === "nexus" ? nexusLabel : null}
          sizePx={sizePx}
        />
      ))}
      {badges.map((badge) => (
        <PushBadge
          key={badge.team}
          badge={badge}
          sizePx={sizePx}
          text={t(PUSH_KEYS[badge.mode], { time: formatCountdown(badge.remainingSec) })}
        />
      ))}
    </div>
  );
}
