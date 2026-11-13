import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";

import type { TowerBeam } from "@/lib/match/live/contacts";
import { FIRE_RING_GAP_PX } from "@/lib/match/live/fireObstacles";
import { beamGeometry, linkOpacity } from "@/lib/match/live/linkGeometry";
import { MAP_UNITS, anchorTransform, bubbleDiameterPx, structureDiameterPx } from "@/lib/match/live/mapGeometry";
import type { LolSimV1RuntimeState } from "@/ui-v2/_legacy/components/match/lol-prototype/backend/contract-v1";

import { useArenaBus, useMapSize } from "./arenaMapContext";
import { DOT_RADIUS_PX } from "./ContactLayer";
import { keyOf, useElementRegistry, writeDot, writeLine } from "./layerDom";
import { RING_CLASSES } from "./ringClasses";

export interface TowerFireLayerProps {
  /** The state of the last engine answer. Positions between answers come from the frame bus. */
  state: LolSimV1RuntimeState;
  beams: readonly TowerBeam[];
}

type Champions = LolSimV1RuntimeState["champions"];

/**
 * A tower that is shooting a champion: a dashed ring on the tower, a beam to the target ending
 * in an arrowhead, a dot where it starts, and a chip with the shot count (`xN`) behind the tower.
 * This is the layer above the champions: a target standing next to the tower would hide a beam
 * and a chip drawn under its bubble. The beam never gets shorter than a few pixels, and the chip
 * sits on the far side of the tower from the target. What exists is decided on each committed
 * answer; where the beam ends is decided on every frame, by writing attributes and one
 * `transform` per chip through refs. Nothing renders per frame.
 */
export function TowerFireLayer({ state, beams }: TowerFireLayerProps) {
  const { t } = useTranslation();
  const bus = useArenaBus();
  const sizePx = useMapSize();
  const { elements, refFor } = useElementRegistry();

  const names = useMemo(() => new Map(state.champions.map((champion) => [champion.id, champion.name])), [state.champions]);
  const structures = useMemo(() => new Map(state.structures.map((structure) => [structure.id, structure])), [state.structures]);

  const unitsPerPx = sizePx > 0 ? MAP_UNITS / sizePx : 0;
  const dotRadius = DOT_RADIUS_PX * unitsPerPx;

  const latest = useRef({ beams, structures, sizePx });
  const lastFrameChampions = useRef<Champions | null>(null);

  const apply = useCallback(
    (champions: Champions) => {
      const { beams: shooting, structures: byId, sizePx: size } = latest.current;
      const bubbleRadius = bubbleDiameterPx(size) / 2;
      const position = new Map(champions.map((champion) => [champion.id, champion.pos]));
      for (const beam of shooting) {
        const structure = byId.get(beam.structureId);
        const target = position.get(beam.targetId);
        if (!structure || !target) continue;
        const ringRadius = structureDiameterPx(structure.kind, size) / 2 + FIRE_RING_GAP_PX;
        const geometry = beamGeometry(structure.pos, target, ringRadius, bubbleRadius, size);
        writeLine(elements.current.get(keyOf("halo", beam.structureId)), geometry);
        writeLine(elements.current.get(keyOf("beam", beam.structureId)), geometry);
        elements.current.get(keyOf("head", beam.structureId))?.setAttribute("points", geometry.head);
        writeDot(elements.current.get(keyOf("beam-dot", beam.structureId)), geometry.x1, geometry.y1);
        const chip = elements.current.get(keyOf("chip", beam.structureId)) as HTMLElement | undefined;
        if (chip) chip.style.transform = anchorTransform(geometry.chip, size);
      }
    },
    [elements],
  );

  // After every commit: the new beams get their ends at once, from the freshest positions.
  useLayoutEffect(() => {
    latest.current = { beams, structures, sizePx };
    apply(lastFrameChampions.current ?? state.champions);
  });

  useEffect(
    () =>
      bus.subscribe((frame) => {
        lastFrameChampions.current = frame.state.champions;
        apply(frame.state.champions);
      }),
    [bus, apply],
  );

  const nameOf = (id: string) => names.get(id) ?? id;

  return (
    <>
      <svg className="arena-links" viewBox={`0 0 ${MAP_UNITS} ${MAP_UNITS}`} preserveAspectRatio="none" aria-hidden="true" focusable="false" data-testid="tower-fire">
        {beams.map((beam) => {
          const structure = structures.get(beam.structureId);
          if (!structure) return null;
          const ringRadius = (structureDiameterPx(structure.kind, sizePx) / 2 + FIRE_RING_GAP_PX) * unitsPerPx;
          return (
            <g key={beam.structureId} data-beam={beam.structureId} data-team={structure.team} opacity={linkOpacity(beam.ageSec)}>
              <circle className={RING_CLASSES.fire} cx={structure.pos.x * MAP_UNITS} cy={structure.pos.y * MAP_UNITS} r={ringRadius} />
              <line ref={refFor(keyOf("halo", beam.structureId))} className="arena-link-halo" data-part="beam-halo" />
              <line ref={refFor(keyOf("beam", beam.structureId))} className="arena-beam" />
              <polyline ref={refFor(keyOf("head", beam.structureId))} className="arena-beam-head" data-part="beam-head" />
              <circle ref={refFor(keyOf("beam-dot", beam.structureId))} className="arena-link-dot" data-part="beam-dot" r={dotRadius} />
            </g>
          );
        })}
      </svg>
      <div className="arena-chips" aria-hidden="true">
        {beams.map((beam) => (
          <div key={beam.structureId} ref={refFor(keyOf("chip", beam.structureId))} className="arena-chip-anchor">
            <span
              className="arena-chip"
              data-testid="shots-chip"
              data-kind="tower"
              data-team={structures.get(beam.structureId)?.team}
              data-beam={beam.structureId}
              title={t("onAir.match.contact.towerShot", { target: nameOf(beam.targetId), count: beam.shots })}
            >
              {`x${beam.shots}`}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
