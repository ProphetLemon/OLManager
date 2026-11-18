import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

/** "y" fades the top and bottom of a list; "x" fades the inline edges of a row. */
export type FadeAxis = "x" | "y";

/** How far the fade reaches in from an edge. A scroller pads its snap and focus by the same amount. */
const FADE = "1.5rem";

/**
 * Fade cues for a scrolling list: the edge fades only while there is more content past it.
 * `key` re-measures when the list's content changes; the scroller's children are observed
 * too, so a child that grows or shrinks without the scroller resizing (a lane pill whose
 * text changed) refreshes the fades.
 */
export function useFadeMask<T extends HTMLElement>(key: string | number, { axis = "y" }: { axis?: FadeAxis } = {}) {
  const ref = useRef<T | null>(null);
  const [overflow, setOverflow] = useState({ start: false, end: false });
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Math.abs: a right-to-left row scrolls to negative offsets.
    const offset = Math.abs(axis === "x" ? el.scrollLeft : el.scrollTop);
    const room = axis === "x" ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight;
    const start = offset > 1;
    const end = room - offset > 1;
    setOverflow((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, [axis]);
  useEffect(() => {
    measure();
    const el = ref.current;
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (el && observer) {
      observer.observe(el);
      for (const child of Array.from(el.children)) observer.observe(child);
    }
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [measure, key]);
  const mask = `linear-gradient(${axis === "x" ? "to right" : "to bottom"}, ${
    overflow.start ? `transparent 0, #000 ${FADE}` : "#000 0"
  }, ${overflow.end ? `#000 calc(100% - ${FADE}), transparent 100%` : "#000 100%"})`;
  const style: CSSProperties = { maskImage: mask, WebkitMaskImage: mask };
  const x = axis === "x";
  const flag = (on: boolean) => (on ? "true" : undefined);
  const edges = {
    "data-overflow-top": flag(!x && overflow.start),
    "data-overflow-bottom": flag(!x && overflow.end),
    "data-overflow-start": flag(x && overflow.start),
    "data-overflow-end": flag(x && overflow.end),
  };
  return { ref, onScroll: measure, style, ...edges } as const;
}
