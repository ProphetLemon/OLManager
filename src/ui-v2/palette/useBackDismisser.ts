import { useEffect, useRef } from "react";

import { paletteEntryPhase, registerBackDismisser } from "./paletteHistory";

/**
 * While `active`, a native Back press runs `dismiss` (the same close a tap outside uses).
 * Registered only for an opening that holds no history entry of its own: an opening that
 * pushed one before the native listener was registered keeps the entry path, so Back pops
 * it. Declare it after the effect that pushes the entry. Clears on close and on unmount, so a
 * stale dismisser never swallows a Back that belongs to the screen behind.
 */
export function useBackDismisser(active: boolean, dismiss: () => void): void {
  const latest = useRef(dismiss);
  latest.current = dismiss;
  useEffect(() => {
    if (!active || paletteEntryPhase() !== "none") return;
    return registerBackDismisser(() => latest.current());
  }, [active]);
}
