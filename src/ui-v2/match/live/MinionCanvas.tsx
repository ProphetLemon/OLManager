import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

import type { MinionState } from "@/ui-v2/_legacy/components/match/lol-prototype/engine/types";

import { useArenaBus, useMapSize } from "./arenaMapContext";
import { drawMinions, type MinionColors } from "./drawMinions";

/** Used when a token cannot be read (a DOM with no stylesheet): the canvas text colour. */
const FALLBACK_COLOR = "currentColor";

/** The two clubs' colours as the screen publishes them for this element right now (the game's own blue and red until it does). */
export function readMinionColors(element: Element): MinionColors {
  const style = getComputedStyle(element);
  const token = (name: string) => style.getPropertyValue(name).trim() || FALLBACK_COLOR;
  return { blue: token("--side-blue"), red: token("--side-red") };
}

/** Attributes of the page root that switch the theme (high contrast) or retint it (the club). */
const THEME_ATTRIBUTES = ["class", "style", "data-theme", "data-contrast"];
const THEME_QUERIES = ["(prefers-color-scheme: dark)", "(prefers-contrast: more)"];

/**
 * The lane minions, drawn on one canvas in one pass per frame. They are decorative and many
 * (about 30 to 40), so a canvas is cheaper than as many DOM nodes and nothing needs to read
 * them: the canvas is hidden from assistive technology. The frame path draws from the frame
 * bus, so React never renders for a frame. The canvas backing store follows the map size times
 * the screen pixel ratio; the team colours are read from the theme tokens when it mounts and
 * again whenever the theme changes.
 */
export function MinionCanvas() {
  const bus = useArenaBus();
  const sizePx = useMapSize();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const minionsRef = useRef<readonly MinionState[]>([]);
  const colorsRef = useRef<MinionColors>({ blue: FALLBACK_COLOR, red: FALLBACK_COLOR });
  const sizeRef = useRef(sizePx);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!contextRef.current) contextRef.current = canvas.getContext("2d");
    const context = contextRef.current;
    if (!context) return;
    const size = sizeRef.current;
    const ratio = window.devicePixelRatio || 1;
    const pixels = Math.max(1, Math.round(size * ratio));
    if (canvas.width !== pixels || canvas.height !== pixels) {
      canvas.width = pixels;
      canvas.height = pixels;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawMinions(context, minionsRef.current, size, colorsRef.current);
  }, []);

  // A new map size resizes the backing store, which clears it: draw again at once.
  useLayoutEffect(() => {
    sizeRef.current = sizePx;
    paint();
  }, [sizePx, paint]);

  // Colours first, so the frame a late subscriber gets at once is already painted right.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const refresh = () => {
      colorsRef.current = readMinionColors(canvas);
      paint();
    };
    refresh();

    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: THEME_ATTRIBUTES });
    const queries =
      typeof window.matchMedia === "function" ? THEME_QUERIES.map((query) => window.matchMedia(query)) : [];
    for (const query of queries) query.addEventListener("change", refresh);
    return () => {
      observer.disconnect();
      for (const query of queries) query.removeEventListener("change", refresh);
    };
  }, [paint]);

  useEffect(
    () =>
      bus.subscribe((frame) => {
        minionsRef.current = frame.state.minions;
        paint();
      }),
    [bus, paint],
  );

  return <canvas ref={canvasRef} className="arena-minions" aria-hidden="true" data-testid="minion-canvas" />;
}
