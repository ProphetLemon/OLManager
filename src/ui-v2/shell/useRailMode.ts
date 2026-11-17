import { useEffect, useState } from "react";
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
  /** False until the observer first reports a size. */
  measured: boolean;
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
  if (!merged.measured) {
    return merged.platform === prev.platform && merged.rootPx === prev.rootPx && merged.reservedTop === prev.reservedTop
      ? prev
      : { ...merged, mode: "split" };
  }
  // A hidden or detached slot reports 0 x 0: that is no information, so keep the mode.
  if (merged.slotW === 0 && merged.slotH === 0 && merged.platform !== "android") {
    return { ...merged, mode: prev.mode };
  }
  const mode = decideRailMode({
    platform: merged.platform,
    slotW: merged.slotW,
    slotH: merged.slotH,
    rootPx: merged.rootPx,
    // The first real measurement is decided without hysteresis.
    current: prev.measured ? prev.mode : "tree",
    reservedTop: merged.reservedTop,
  });
  return { ...merged, mode };
}

/**
 * Tree or Split for the rail, from the size of `slot` (the dashboard body, under the
 * title bar). The slot is an element held in state (it can mount late), not a ref.
 * Until the observer first fires the mode is Split, today's rail, and the first real
 * measurement is decided without hysteresis.
 */
export function useRailMode(
  slot: HTMLElement | null,
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
      mode: "split",
      measured: false,
    };
  });

  useEffect(() => {
    const el = slot;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1]?.contentRect;
      if (box) setM((prev) => next(prev, { slotW: box.width, slotH: box.height, measured: true }));
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
