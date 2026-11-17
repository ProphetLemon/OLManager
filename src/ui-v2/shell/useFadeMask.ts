import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

/**
 * Fade cues for a scrolling list: the edge fades only while there is more content past it.
 * `key` re-measures when the list's content changes.
 */
export function useFadeMask<T extends HTMLElement>(key: string | number) {
  const ref = useRef<T | null>(null);
  const [overflow, setOverflow] = useState({ top: false, bottom: false });
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const top = el.scrollTop > 1;
    const bottom = el.scrollHeight - el.clientHeight - el.scrollTop > 1;
    setOverflow((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }));
  }, []);
  useEffect(() => {
    measure();
    const el = ref.current;
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (el) observer?.observe(el);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [measure, key]);
  const mask = `linear-gradient(to bottom, ${overflow.top ? "transparent 0, #000 1.5rem" : "#000 0"}, ${
    overflow.bottom ? "#000 calc(100% - 1.5rem), transparent 100%" : "#000 100%"
  })`;
  const style: CSSProperties = { maskImage: mask, WebkitMaskImage: mask };
  return {
    ref,
    onScroll: measure,
    style,
    "data-overflow-top": overflow.top ? "true" : undefined,
    "data-overflow-bottom": overflow.bottom ? "true" : undefined,
  } as const;
}
