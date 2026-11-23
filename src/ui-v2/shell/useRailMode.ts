import { useEffect, useLayoutEffect, useState } from "react";
import { useSettingsStore } from "@/store/settingsStore";
import { decideRailMode, railNeed, type RailMode, type RailPlatform } from "./railMode";

export interface RailModeState {
  mode: RailMode;
  /** Content box of the observed element, CSS px (0 until the observer first fires). */
  slotW: number;
  slotH: number;
  /** Height the tree needs at the current root size. */
  need: number;
  /** The root font size the decision used, px. */
  rootPx: number;
  platform: RailPlatform;
}

/** Height pinned above the tree: px, or px for a root size (the Go row scales with the root). */
export type RailReserve = number | ((rootPx: number) => number);

interface Measured {
  slotW: number;
  slotH: number;
  rootPx: number;
  platform: RailPlatform;
  reservedTop: RailReserve;
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

const KEYS = ["mode", "slotW", "slotH", "rootPx", "platform", "reservedTop", "measured"] as const;

/** The reserve in px at the measured root size. */
const reserveOf = (m: Pick<Measured, "reservedTop" | "rootPx">): number =>
  typeof m.reservedTop === "function" ? m.reservedTop(m.rootPx) : m.reservedTop;
const same = (a: Measured, b: Measured) => KEYS.every((k) => a[k] === b[k]);

/** Pure step: change some inputs and re-decide the mode, with the old mode as `current`. */
function next(prev: Measured, patch: Partial<Omit<Measured, "mode">>): Measured {
  const merged = { ...prev, ...patch };
  const keep = (candidate: Measured) => (same(prev, candidate) ? prev : candidate);
  // A 0 x 0 slot (hidden, detached, not laid out yet) is no information: it never marks
  // the slot measured, and after a real measurement it keeps the mode.
  if (merged.slotW === 0 && merged.slotH === 0) {
    return keep({ ...merged, measured: prev.measured, mode: prev.measured ? prev.mode : "split" });
  }
  if (!merged.measured) return keep({ ...merged, mode: "split" });
  const mode = decideRailMode({
    platform: merged.platform,
    slotW: merged.slotW,
    slotH: merged.slotH,
    rootPx: merged.rootPx,
    // The first real measurement is decided without hysteresis.
    current: prev.measured ? prev.mode : "tree",
    reservedTop: reserveOf(merged),
  });
  return keep({ ...merged, mode });
}

/**
 * Tree or Split for the rail, from the size of `slot` (the dashboard body, under the
 * title bar). The slot is an element held in state (it can mount late), not a ref.
 * The element is measured synchronously in a layout effect, so the first painted frame
 * already has the right mode; while it has no size the mode is Split, today's rail. The
 * first real measurement is decided without hysteresis.
 */
export function useRailMode(
  slot: HTMLElement | null,
  { reservedTop = 0 }: { reservedTop?: RailReserve } = {},
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

  useLayoutEffect(() => {
    if (!slot) return;
    const box = slot.getBoundingClientRect();
    setM((prev) =>
      next(prev, {
        slotW: box.width,
        slotH: box.height,
        measured: true,
        rootPx: readRootPx(),
        platform: readPlatform(),
      }),
    );
  }, [slot]);

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

  return { mode: m.mode, slotW: m.slotW, slotH: m.slotH, need: railNeed(m.rootPx, reserveOf(m)), rootPx: m.rootPx, platform: m.platform };
}
