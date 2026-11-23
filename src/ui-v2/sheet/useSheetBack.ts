import { useEffect, useRef } from "react";

import {
  forgetPaletteEntry,
  paletteEntryPop,
  pushPaletteEntry,
  releasePaletteEntry,
} from "@/ui-v2/palette/paletteHistory";
import { useBackDismisser } from "@/ui-v2/palette/useBackDismisser";

export interface UseSheetBackOptions {
  open: boolean;
  /** Only Android takes a history entry or registers a dismisser; desktop makes no history call. */
  android: boolean;
  /** What Back does: close the sheet. Read through a ref, so a new function never re-registers. */
  onBack: () => void;
  /**
   * Also close on any `popstate` while open when `android` is false. The Go palette needs it on
   * desktop (DashboardV2's handler asks `paletteEntryPop` about the same event); the More menu
   * does not. Default false.
   */
  listenWithoutEntry?: boolean;
}

/**
 * The Back contract of a modal overlay (R79, R87, R95), shared by the Go palette and the More
 * menu and, later, every side sheet.
 *
 * wry 0.55.1 raises `popstate` for the back gesture only when the webview can go back, so on
 * Android an open overlay pushes the shared history entry (`paletteHistory`) and the gesture
 * pops it; a close by any other path takes the entry off. While the native `back-button`
 * listener is registered no entry is held: Back reaches `onBack` through a dismisser. The late
 * pop of an entry a close already took off (`"release"`) is not a Back for a reopened overlay.
 *
 * The effects run in this order, and the dismisser is declared after the entry effect.
 */
export function useSheetBack({ open, android, onBack, listenWithoutEntry = false }: UseSheetBackOptions): void {
  // Latest `onBack`, so an inline function never re-adds the popstate listener (its order
  // among the capture listeners is part of the contract).
  const latest = useRef(onBack);
  latest.current = onBack;
  const back = useRef(() => latest.current()).current;
  useEffect(() => {
    if (!android) return;
    if (open) pushPaletteEntry();
    else releasePaletteEntry();
  }, [open, android]);
  useEffect(() => {
    if (!android) return;
    return () => forgetPaletteEntry();
  }, [android]);
  // With the native back-button listener registered the overlay holds no entry: Back closes it.
  useBackDismisser(open && android, back);

  const listen = android || listenWithoutEntry;
  useEffect(() => {
    if (!open || !listen) return;
    const onPopState = (event: PopStateEvent) => {
      // The late pop of an entry a close already took off is not a Back for this opening.
      if (paletteEntryPop(event) === "release") return;
      back();
    };
    window.addEventListener("popstate", onPopState, true);
    return () => window.removeEventListener("popstate", onPopState, true);
  }, [open, listen, back]);
}
