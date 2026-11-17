import { useEffect, useState, type RefObject } from "react";
import { useSettingsStore } from "@/store/settingsStore";
import { decideRailMode, railNeed, type RailMode, type RailPlatform } from "./railMode";

export interface RailModeState {
  mode: RailMode;
  /** Content box of the observed element, CSS px (0 until the observer first fires). */
  slotW: number;
  slotH: number;
  /** Height the tree needs at the current root size. */
  need: number;
}

interface Measured {
  slotW: number;
  slotH: number;
  rootPx: number;
  platform: RailPlatform;
  reservedTop: number;
  mode: RailMode;
}

const FALLBACK_ROOT_PX = 16;

function readRootPx(): number {
  const px = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(px) && px > 0 ? px : FALLBACK_ROOT_PX;
}

/** `data-platform` on <html> is the single source (set by AppV2), never the user agent. */
function readPlatform(): RailPlatform {
  return document.documentElement.dataset.platform === "android" ? "android" : "desktop";
}

/** Pure step: change some inputs and re-decide the mode, with the old mode as `current`. */
function next(prev: Measured, patch: Partial<Omit<Measured, "mode">>): Measured {
  const merged = { ...prev, ...patch };
  const unmeasured = merged.slotW === 0 && merged.slotH === 0;
  const mode = unmeasured
    ? merged.platform === "android"
      ? "split"
      : "tree"
    : decideRailMode({
        platform: merged.platform,
        slotW: merged.slotW,
        slotH: merged.slotH,
        rootPx: merged.rootPx,
        current: prev.mode,
        reservedTop: merged.reservedTop,
      });
  return mode === prev.mode && Object.keys(patch).every((k) => prev[k as keyof Measured] === merged[k as keyof Measured])
    ? prev
    : { ...merged, mode };
}

/**
 * Tree or Split for the rail, from the size of `slot` (the dashboard body, under the
 * title bar). Until the observer first fires the slot is 0 x 0 and the mode is the
 * desktop default, Tree (Split on Android), so the first real measurement is decided
 * without hysteresis.
 */
export function useRailMode(
  slot: RefObject<HTMLElement | null>,
  { reservedTop = 0 }: { reservedTop?: number } = {},
): RailModeState {
  const uiScale = useSettingsStore((s) => s.settings.ui_scale);
  const [m, setM] = useState<Measured>(() => {
    const platform = readPlatform();
    return {
      slotW: 0,
      slotH: 0,
      rootPx: readRootPx(),
      platform,
      reservedTop,
      mode: platform === "android" ? "split" : "tree",
    };
  });

  useEffect(() => {
    const el = slot.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1]?.contentRect;
      if (box) setM((prev) => next(prev, { slotW: box.width, slotH: box.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [slot]);

  // Same effect as the scale: AppV2 writes the root font size in an effect of its own,
  // which runs after this one, so the observer below catches the late write.
  useEffect(() => {
    setM((prev) => next(prev, { rootPx: readRootPx(), platform: readPlatform() }));
  }, [uiScale]);

  useEffect(() => {
    const mo = new MutationObserver(() =>
      setM((prev) => next(prev, { rootPx: readRootPx(), platform: readPlatform() })),
    );
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-platform"] });
    return () => mo.disconnect();
  }, []);

  useEffect(() => {
    setM((prev) => next(prev, { reservedTop }));
  }, [reservedTop]);

  return { mode: m.mode, slotW: m.slotW, slotH: m.slotH, need: railNeed(m.rootPx, m.reservedTop) };
}
