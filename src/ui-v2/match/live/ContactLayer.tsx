import { Swords } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";

import type { ContactPair, ContactResult, TowerBeam } from "@/lib/match/live/contacts";
import { chipPosition, linkDots, linkEndpoints, linkOpacity, type LinkEndpoints } from "@/lib/match/live/linkGeometry";
import {
  MAP_UNITS,
  anchorTransform,
  bubbleDiameterPx,
  structureDiameterPx,
  type MapPoint,
} from "@/lib/match/live/mapGeometry";
import type { LolSimV1RuntimeState } from "@/ui-v2/_legacy/components/match/lol-prototype/backend/contract-v1";

import { useArenaBus, useMapSize } from "./arenaMapContext";
import { RING_CLASSES } from "./ringClasses";

/** Radius of the dot that marks who is hitting, in pixels. */
const DOT_RADIUS_PX = 4.5;
/** Clear space between a firing tower and its dashed ring, in pixels. */
const FIRE_RING_GAP_PX = 5;

/** What the legend says about links and beams; the legend (MapLegend) reads these keys. */
export const CONTACT_LEGEND_KEYS = {
  dot: "onAir.match.legend.dot",
  shots: "onAir.match.legend.shots",
  beam: "onAir.match.legend.beam",
  ringFighting: "onAir.match.legend.ringFighting",
  ringFire: "onAir.match.legend.ringFire",
} as const;

export interface ContactLayerProps {
  /** The state of the last engine answer. Positions between answers come from the frame bus. */
  state: LolSimV1RuntimeState;
  contacts: Pick<ContactResult, "pairs">;
  beams: readonly TowerBeam[];
}

type Champions = LolSimV1RuntimeState["champions"];

/** Remembers the elements the frame path has to move, by a key, without a render. */
function useElementRegistry() {
  const elements = useRef(new Map<string, Element>());
  const callbacks = useRef(new Map<string, (element: Element | null) => void>());
  const refFor = useCallback((key: string) => {
    let callback = callbacks.current.get(key);
    if (!callback) {
      callback = (element) => {
        if (element) elements.current.set(key, element);
        else elements.current.delete(key);
      };
      callbacks.current.set(key, callback);
    }
    return callback;
  }, []);
  return { elements, refFor };
}

const keyOf = (part: string, id: string) => `${part}:${id}`;

function writeLine(element: Element | undefined, endpoints: LinkEndpoints) {
  if (!element) return;
  element.setAttribute("x1", endpoints.x1.toFixed(1));
  element.setAttribute("y1", endpoints.y1.toFixed(1));
  element.setAttribute("x2", endpoints.x2.toFixed(1));
  element.setAttribute("y2", endpoints.y2.toFixed(1));
}

function writeDot(element: Element | undefined, x: number, y: number) {
  if (!element) return;
  element.setAttribute("cx", x.toFixed(1));
  element.setAttribute("cy", y.toFixed(1));
}

/**
 * The lines between fighters and from firing towers to their target. What exists (a pair, a
 * beam, a chip) is decided on each committed answer; where its ends are is decided on every
 * frame, from the interpolated champions, by writing attributes and one `transform` per chip
 * through refs. The links start outside the bubbles and carry a dot on the attacker's end.
 */
export function ContactLayer({ state, contacts, beams }: ContactLayerProps) {
  const { t } = useTranslation();
  const bus = useArenaBus();
  const sizePx = useMapSize();
  const { elements, refFor } = useElementRegistry();

  const names = useMemo(() => new Map(state.champions.map((champion) => [champion.id, champion.name])), [state.champions]);
  const structures = useMemo(() => new Map(state.structures.map((structure) => [structure.id, structure])), [state.structures]);

  const unitsPerPx = sizePx > 0 ? MAP_UNITS / sizePx : 0;
  const dotRadius = DOT_RADIUS_PX * unitsPerPx;

  const latest = useRef({ pairs: contacts.pairs, beams, structures, sizePx });
  const lastFrameChampions = useRef<Champions | null>(null);

  const apply = useCallback(
    (champions: Champions) => {
      const { pairs, beams: shooting, structures: byId, sizePx: size } = latest.current;
      const bubbleRadius = bubbleDiameterPx(size) / 2;
      const position = new Map(champions.map((champion) => [champion.id, champion.pos]));
      const chip = (key: string, from: MapPoint, to: MapPoint) => {
        const element = elements.current.get(key) as HTMLElement | undefined;
        if (element) element.style.transform = anchorTransform(chipPosition(from, to), size);
      };

      for (const pair of pairs) {
        const a = position.get(pair.a);
        const b = position.get(pair.b);
        if (!a || !b) continue;
        const endpoints = linkEndpoints(a, b, bubbleRadius, size);
        const group = elements.current.get(keyOf("group", pair.id));
        group?.setAttribute("visibility", endpoints.visible ? "visible" : "hidden");
        writeLine(elements.current.get(keyOf("halo", pair.id)), endpoints);
        writeLine(elements.current.get(keyOf("link", pair.id)), endpoints);
        writeDot(elements.current.get(keyOf("dot-a", pair.id)), endpoints.x1, endpoints.y1);
        writeDot(elements.current.get(keyOf("dot-b", pair.id)), endpoints.x2, endpoints.y2);
        chip(keyOf("chip", pair.id), a, b);
      }

      for (const beam of shooting) {
        const structure = byId.get(beam.structureId);
        const target = position.get(beam.targetId);
        if (!structure || !target) continue;
        const towerRadius = structureDiameterPx(structure.kind, size) / 2 + FIRE_RING_GAP_PX;
        const endpoints = linkEndpoints(structure.pos, target, towerRadius, size, { radiusBPx: bubbleRadius });
        const group = elements.current.get(keyOf("group", beam.structureId));
        group?.setAttribute("visibility", endpoints.visible ? "visible" : "hidden");
        writeLine(elements.current.get(keyOf("beam", beam.structureId)), endpoints);
        writeDot(elements.current.get(keyOf("beam-dot", beam.structureId)), endpoints.x1, endpoints.y1);
        chip(keyOf("chip", beam.structureId), structure.pos, target);
      }
    },
    [elements],
  );

  // After every commit: the new pairs and beams get their ends at once, from the freshest positions.
  useLayoutEffect(() => {
    latest.current = { pairs: contacts.pairs, beams, structures, sizePx };
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
      <svg
        className="arena-links"
        viewBox={`0 0 ${MAP_UNITS} ${MAP_UNITS}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
        data-testid="contact-links"
      >
        {contacts.pairs.map((pair) => (
          <PairLines key={pair.id} pair={pair} dotRadius={dotRadius} refFor={refFor} />
        ))}
        {beams.map((beam) => {
          const structure = structures.get(beam.structureId);
          if (!structure) return null;
          const ringRadius = (structureDiameterPx(structure.kind, sizePx) / 2 + FIRE_RING_GAP_PX) * unitsPerPx;
          return (
            <g key={beam.structureId} ref={refFor(keyOf("group", beam.structureId))} data-beam={beam.structureId} data-team={structure.team} opacity={linkOpacity(beam.ageSec)}>
              <circle
                className={RING_CLASSES.fire}
                cx={structure.pos.x * MAP_UNITS}
                cy={structure.pos.y * MAP_UNITS}
                r={ringRadius}
              />
              <line ref={refFor(keyOf("beam", beam.structureId))} className="arena-beam" />
              <circle ref={refFor(keyOf("beam-dot", beam.structureId))} className="arena-link-dot" data-part="beam-dot" r={dotRadius} />
            </g>
          );
        })}
      </svg>
      <div className="arena-chips" aria-hidden="true">
        {contacts.pairs.map((pair) => (
          <div key={pair.id} ref={refFor(keyOf("chip", pair.id))} className="arena-chip-anchor">
            <span
              className="arena-chip"
              data-testid="contact-chip"
              data-pair={pair.id}
              title={t("onAir.match.contact.fighting", { a: nameOf(pair.a), b: nameOf(pair.b) })}
            >
              <Swords size={14} aria-hidden="true" />
            </span>
          </div>
        ))}
        {beams.map((beam) => {
          const structure = structures.get(beam.structureId);
          return (
            <div key={beam.structureId} ref={refFor(keyOf("chip", beam.structureId))} className="arena-chip-anchor">
              <span
                className="arena-chip"
                data-testid="shots-chip"
                data-kind="tower"
                data-team={structure?.team}
                data-beam={beam.structureId}
                title={t("onAir.match.contact.towerShot", { target: nameOf(beam.targetId), count: beam.shots })}
              >
                {`x${beam.shots}`}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

function PairLines({
  pair,
  dotRadius,
  refFor,
}: {
  pair: ContactPair;
  dotRadius: number;
  refFor: (key: string) => (element: Element | null) => void;
}) {
  const dots = linkDots(pair);
  return (
    <g ref={refFor(keyOf("group", pair.id))} data-link={pair.id} opacity={linkOpacity(pair.ageSec)}>
      <line ref={refFor(keyOf("halo", pair.id))} className="arena-link-halo" data-part="halo" />
      <line ref={refFor(keyOf("link", pair.id))} className="arena-link" data-part="link" />
      {dots.atA ? (
        <circle ref={refFor(keyOf("dot-a", pair.id))} className="arena-link-dot" data-part="dot-a" r={dotRadius} />
      ) : null}
      {dots.atB ? (
        <circle ref={refFor(keyOf("dot-b", pair.id))} className="arena-link-dot" data-part="dot-b" r={dotRadius} />
      ) : null}
    </g>
  );
}
