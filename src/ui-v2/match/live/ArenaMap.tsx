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

/**
 * The side of the largest square that fits a cell: the smaller of its two sides, in whole pixels
 * (never rounded up, so the square never leaves the cell).
 */
export function squareSide(width: number, height: number): number {
  const side = Math.floor(Math.min(width, height));
  return Number.isFinite(side) && side > 0 ? side : 0;
}

/**
 * The side of the square that fits the element, kept up to date by one ResizeObserver. The element
 * is the map's grid cell, so the square is `min(cell width, cell height)` whatever the CSS
 * estimated for the grid: it can never be taller than its row. 0 until measured.
 */
function useSquareInCell<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [side, setSide] = useState(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const apply = (width: number, height: number) => {
      const next = squareSide(width, height);
      setSide((previous) => (previous === next ? previous : next));
    };
    apply(element.clientWidth, element.clientHeight);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) apply(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, side];
}

/**
 * The square map: static terrain, then the layers in a fixed order. It fills its grid cell with an
 * empty frame, measures that frame and sizes the square to the smaller side, centred; it shares
 * that side with the layers, so a layer never reads the DOM. For assistive technology the
 * map is one image whose text twin is the Fight board; the player cards are the way in.
 */
export function ArenaMap({ bus, describedBy, paused = false, layers, className }: ArenaMapProps) {
  const { t } = useTranslation();
  const [cellRef, sizePx] = useSquareInCell<HTMLDivElement>();
  const context = useMemo(() => ({ sizePx, bus }), [sizePx, bus]);

  return (
    <div ref={cellRef} className="arena-cell" data-testid="arena-cell">
      <div
        role="img"
        aria-label={t("onAir.match.map.label")}
        aria-describedby={describedBy}
        className={cn("arena-map", className)}
        style={{ width: sizePx, height: sizePx }}
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
    </div>
  );
}
