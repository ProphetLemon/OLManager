import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import { hpShare, initialsOf, shortName, type MarkerState } from "@/lib/match/live/championMarker";
import { recallProgress } from "@/lib/match/live/contacts";
import { anchorTransform, bubbleDiameterPx, type MapPoint } from "@/lib/match/live/mapGeometry";
import type { TagPlacement } from "@/lib/match/live/tagPlacement";
import type { ChampionState } from "@/ui-v2/_legacy/components/match/lol-prototype/engine/types";
import { cn } from "@/ui-v2/lib/utils";

import { useArenaBus, useMapSize } from "./arenaMapContext";
import { RING_CLASSES } from "./ringClasses";
import type { MarkerTexts } from "./useMarkerTexts";

/** The recall ring is drawn in a 100 unit box; the arc is a circle of this radius. */
const RING_RADIUS = 46;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;
/** Gap between the bubble edge and the near edge of a tag, as in the solver. */
const TAG_BELOW_GAP = 11;
const TAG_OTHER_GAP = 8;
/** How far an edge anchored tag reaches past the bubble edge. */
const TAG_EDGE_REACH = 6;

/** A marker states what it is to legend and to tests. */
export const MARKER_LEGEND_KEYS = {
  recallRing: "onAir.match.legend.ringRecall",
  deadOutline: "onAir.match.legend.ringDead",
} as const;

/** Stroke pattern of the arc that drains from full (1) to empty (0). */
function arcPattern(remaining: number): string {
  const clamped = Math.min(1, Math.max(0, remaining));
  return `${(clamped * RING_LENGTH).toFixed(2)} ${RING_LENGTH.toFixed(2)}`;
}

export interface ChampionMarkerProps {
  /** The champion as of the last engine answer. The frame path moves the marker between answers. */
  champion: ChampionState;
  /** Key of the champion picked for this player, for the tile. */
  championKey?: string;
  /** Game time of that answer: the dead countdown reads it. */
  nowSec: number;
  state: MarkerState | null;
  texts: MarkerTexts;
  tag: TagPlacement | undefined;
  fighting: boolean;
  selected: boolean;
  /** Another player is followed: this one steps back. */
  dimmed: boolean;
  onSelect: (id: string) => void;
}

function tagStyle(tag: Extract<TagPlacement, { slot: string }>, radius: number): CSSProperties {
  switch (tag.slot) {
    case "below":
      return { top: radius + TAG_BELOW_GAP, ...horizontal(tag.align, radius) };
    case "above":
      return { bottom: radius + TAG_OTHER_GAP, ...horizontal(tag.align, radius) };
    case "right":
      return { top: 0, left: radius + TAG_OTHER_GAP };
    case "left":
      return { top: 0, right: radius + TAG_OTHER_GAP };
  }
}

function horizontal(align: "center" | "start" | "end", radius: number): CSSProperties {
  if (align === "start") return { left: -(radius + TAG_EDGE_REACH) };
  if (align === "end") return { right: -(radius + TAG_EDGE_REACH) };
  return { left: 0 };
}

/**
 * One champion on the map. The root is a zero size anchor that the frame path moves with
 * `transform` through a ref; the bubble is a centred child, so nothing here animates
 * `left` or `top`. Everything the viewer reads (name, state, level, health) comes from the
 * last engine answer, and the recall arc is the only thing the frame path draws besides
 * the position. The marker is hidden from assistive technology: the player cards carry it.
 */
export const ChampionMarker = memo(function ChampionMarker({
  champion,
  championKey,
  nowSec,
  state,
  texts,
  tag,
  fighting,
  selected,
  dimmed,
  onSelect,
}: ChampionMarkerProps) {
  const bus = useArenaBus();
  const sizePx = useMapSize();
  const id = champion.id;
  const diameter = bubbleDiameterPx(sizePx);
  const radius = diameter / 2;

  const anchorRef = useRef<HTMLDivElement>(null);
  const arcRef = useRef<SVGCircleElement | null>(null);
  const sizeRef = useRef(sizePx);
  const posRef = useRef<MapPoint>(champion.pos);
  const remainingRef = useRef(1 - (recallProgress(champion, nowSec) ?? 0));

  const place = useCallback((pos: MapPoint) => {
    posRef.current = pos;
    const anchor = anchorRef.current;
    if (anchor) anchor.style.transform = anchorTransform(pos, sizeRef.current);
  }, []);

  // A new map size moves every marker to where it already was.
  useLayoutEffect(() => {
    sizeRef.current = sizePx;
    place(posRef.current);
  }, [sizePx, place]);

  // The arc is set when the ring appears and then only by the frame path.
  const attachArc = useCallback((element: SVGCircleElement | null) => {
    arcRef.current = element;
    if (element) element.setAttribute("stroke-dasharray", arcPattern(remainingRef.current));
  }, []);

  useEffect(
    () =>
      bus.subscribe((frame) => {
        const live = frame.state.champions.find((candidate) => candidate.id === id);
        if (!live) return;
        place(live.pos);
        const progress = recallProgress(live, frame.clockSec);
        remainingRef.current = progress === null ? 1 : 1 - progress;
        arcRef.current?.setAttribute("stroke-dasharray", arcPattern(remainingRef.current));
      }),
    [bus, id, place],
  );

  const [failedTile, setFailedTile] = useState<string | null>(null);
  const showTile = Boolean(championKey) && failedTile !== championKey && champion.alive;
  const dead = !champion.alive;
  const recalling = state?.kind === "recall";
  const hp = hpShare(champion.hp, champion.maxHp, champion.alive);

  return (
    <div
      ref={anchorRef}
      className="arena-champ"
      aria-hidden="true"
      data-testid={`champion-${id}`}
      data-team={champion.team}
      data-dead={dead || undefined}
      data-fighting={fighting || undefined}
      data-selected={selected || undefined}
      data-dim={dimmed || undefined}
      data-state={state?.kind}
      onClick={() => onSelect(id)}
    >
      <div
        className={cn("arena-bubble", fighting && RING_CLASSES.fighting, selected && RING_CLASSES.selected)}
        style={{ width: diameter, height: diameter, left: -radius, top: -radius }}
      >
        <div className="arena-tile">
          {showTile ? (
            <img
              src={`/champion-tiles/${championKey}.webp`}
              alt=""
              draggable={false}
              onError={() => setFailedTile(championKey ?? null)}
            />
          ) : (
            <span className="arena-initials" data-testid={dead ? "respawn-seconds" : undefined}>
              {dead ? (state?.seconds ?? 0) : initialsOf(champion.name)}
            </span>
          )}
        </div>
        {recalling ? (
          <svg className="arena-recall" viewBox="0 0 100 100" focusable="false" data-testid="recall-ring">
            <circle className="arena-recall-track" cx="50" cy="50" r={RING_RADIUS} />
            <circle
              ref={attachArc}
              className="arena-recall-arc"
              cx="50"
              cy="50"
              r={RING_RADIUS}
              transform="rotate(-90 50 50)"
            />
          </svg>
        ) : null}
        <span className="arena-level">{champion.level}</span>
        {!dead ? (
          <span className="arena-hp">
            <i style={{ width: `${Math.round(hp * 100)}%` }} />
          </span>
        ) : null}
        {tag?.form === "badge" && texts.badge ? (
          <span className="arena-badge" data-testid="state-badge">
            {texts.badge}
          </span>
        ) : null}
      </div>
      {tag && (tag.form === "full" || tag.form === "compact") ? (
        <div
          className="arena-tag"
          style={tagStyle(tag, radius)}
          data-slot={tag.slot}
          data-align={tag.align}
          data-form={tag.form}
          data-testid="tag"
        >
          <b>
            <span className="arena-tag-long">{champion.name}</span>
            <span className="arena-tag-short">{shortName(champion.name)}</span>
          </b>
          {texts.sub ? <span className="arena-tag-sub arena-tag-long">{texts.sub}</span> : null}
          {texts.subCompact ? <span className="arena-tag-sub arena-tag-short">{texts.subCompact}</span> : null}
        </div>
      ) : null}
    </div>
  );
});
