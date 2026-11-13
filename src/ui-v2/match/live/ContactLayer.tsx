import { Swords } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";

import type { ContactPair, ContactResult } from "@/lib/match/live/contacts";
import { chipPosition, linkDots, linkEndpoints, linkOpacity } from "@/lib/match/live/linkGeometry";
import { MAP_UNITS, anchorTransform, bubbleDiameterPx } from "@/lib/match/live/mapGeometry";
import type { LolSimV1RuntimeState } from "@/ui-v2/_legacy/components/match/lol-prototype/backend/contract-v1";

import { useArenaBus, useMapSize } from "./arenaMapContext";
import { keyOf, useElementRegistry, writeDot, writeLine } from "./layerDom";

/** Radius of the dot that marks who is hitting, in pixels. */
export const DOT_RADIUS_PX = 4.5;

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
}

type Champions = LolSimV1RuntimeState["champions"];

/**
 * The lines between fighters (the tower beams are the next layer up, `TowerFireLayer`, because
 * they must show above the champions). What exists (a pair, a chip) is decided on each committed
 * answer; where its ends are is decided on every frame, from the interpolated champions, by
 * writing attributes and one `transform` per chip through refs. The links start outside the
 * bubbles and carry a dot on the attacker's end.
 */
export function ContactLayer({ state, contacts }: ContactLayerProps) {
  const { t } = useTranslation();
  const bus = useArenaBus();
  const sizePx = useMapSize();
  const { elements, refFor } = useElementRegistry();

  const names = useMemo(() => new Map(state.champions.map((champion) => [champion.id, champion.name])), [state.champions]);

  const unitsPerPx = sizePx > 0 ? MAP_UNITS / sizePx : 0;
  const dotRadius = DOT_RADIUS_PX * unitsPerPx;

  const latest = useRef({ pairs: contacts.pairs, sizePx });
  const lastFrameChampions = useRef<Champions | null>(null);

  const apply = useCallback(
    (champions: Champions) => {
      const { pairs, sizePx: size } = latest.current;
      const bubbleRadius = bubbleDiameterPx(size) / 2;
      const position = new Map(champions.map((champion) => [champion.id, champion.pos]));

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
        const chip = elements.current.get(keyOf("chip", pair.id)) as HTMLElement | undefined;
        if (chip) chip.style.transform = anchorTransform(chipPosition(a, b), size);
      }
    },
    [elements],
  );

  // After every commit: the new pairs get their ends at once, from the freshest positions.
  useLayoutEffect(() => {
    latest.current = { pairs: contacts.pairs, sizePx };
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
