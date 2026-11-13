import { useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/ui-v2/lib/utils";

import { ArenaMapContext } from "./arenaMapContext";
import { ArenaTerrain } from "./ArenaTerrain";
import type { FrameBus } from "./frameBus";
import type { LiveFrame } from "./useLiveSession";
import "./liveMatch.css";

/**
 * The slots the layers fill, from the ground up. The order is the stacking order. `callouts` is
 * above the champions: what must not be hidden by a bubble (a tower's beam and its xN chip) goes there.
 */
export const ARENA_LAYERS = ["structures", "pits", "minions", "contacts", "champions", "callouts"] as const;
export type ArenaLayerName = (typeof ARENA_LAYERS)[number];

export type ArenaLayers = Partial<Record<ArenaLayerName, ReactNode>>;

export interface ArenaMapProps {
  bus: FrameBus<LiveFrame>;
  /** Id of the element that says in text what the map shows (the Fight board). */
  describedBy?: string;
  paused?: boolean;
  layers?: ArenaLayers;
  className?: string;
}

/** Width of an element in whole pixels, kept up to date by one ResizeObserver. 0 until measured. */
function useMeasuredWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const apply = (next: number) => {
      const rounded = Math.round(next);
      setWidth((previous) => (previous === rounded ? previous : rounded));
    };
    apply(element.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) apply(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

/**
 * The square map: static terrain, then the layers in a fixed order. It measures its side once
 * and shares it with the layers, so a layer never reads the DOM. For assistive technology the
 * map is one image whose text twin is the Fight board; the player cards are the way in.
 */
export function ArenaMap({ bus, describedBy, paused = false, layers, className }: ArenaMapProps) {
  const { t } = useTranslation();
  const [ref, sizePx] = useMeasuredWidth<HTMLDivElement>();
  const context = useMemo(() => ({ sizePx, bus }), [sizePx, bus]);

  return (
    <div
      ref={ref}
      role="img"
      aria-label={t("onAir.match.map.label")}
      aria-describedby={describedBy}
      className={cn("arena-map", className)}
      data-testid="arena-map"
      data-size={sizePx}
    >
      <ArenaTerrain className="arena-fill" />
      <ArenaMapContext.Provider value={context}>
        {ARENA_LAYERS.map((name) => (
          <div key={name} data-layer={name} className="arena-layer">
            {sizePx > 0 ? layers?.[name] : null}
          </div>
        ))}
      </ArenaMapContext.Provider>
      {paused ? (
        <div className="arena-banner" data-testid="arena-paused">
          {t("match.paused")}
        </div>
      ) : null}
    </div>
  );
}
