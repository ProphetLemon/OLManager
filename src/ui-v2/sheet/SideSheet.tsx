import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from "react";

import { Button } from "@/ui-v2/components/ui/button";
import { cn } from "@/ui-v2/lib/utils";
import { whenPaletteEntryOff } from "@/ui-v2/palette/paletteHistory";
import { useFadeMask } from "@/ui-v2/shell/useFadeMask";

import { useSheetBack } from "./useSheetBack";

export type SideSheetCloseReason = "dismiss" | "activate";

export interface SideSheetProps {
  open: boolean;
  /**
   * The sheet asks to close: `"dismiss"` for Escape, the backdrop, Close and Back; `"activate"`
   * for `useSideSheet().activate(payload)`. The caller owns `open` and turns it off.
   */
  onClose: (reason: SideSheetCloseReason) => void;
  /** The labelled title; also the dialog's accessible name. */
  title: ReactNode;
  /** The edge it opens from. Default "start". */
  side?: "start" | "end";
  /** Start side only: begin after the rail (`--rail-w-phone`) instead of at the window edge. */
  alignToRail?: boolean;
  /** Where focus lands on open: the title (default) or an element. */
  initialFocus?: RefObject<HTMLElement | null> | "title";
  /** Called on a dismiss; its element gets the focus back, else `#main-content`. Not called on an activation. */
  returnFocus?: () => HTMLElement | null;
  /** Sets `--sheet-vvh` from the visual viewport, so the on-screen keyboard never covers the rows (R29). */
  fitVisualViewport?: boolean;
  /** Runs once after a close by activation has completed and the history entry is off (R37, R87). */
  onActivated?: (payload: unknown) => void;
  /** Between the title and Close (`closePlacement="header"` only). */
  headerExtra?: ReactNode;
  /** The Close button's accessible name. */
  closeLabel: string;
  /**
   * "header" (default): a 48 px row holds the title, `headerExtra` and Close. "body": the sheet
   * renders only the title and the owner places `<SideSheetClose />` (the Go palette puts it
   * beside its input).
   */
  closePlacement?: "header" | "body";
  platform: "android" | "desktop";
  /**
   * The owner's handle on `activate`, for code that lives outside the sheet's children (the Go
   * palette's key handlers). Set while the sheet is mounted.
   */
  activateRef?: MutableRefObject<((payload: unknown) => void) | null>;
  /** The title's id, when the owner's controls name themselves by it (`aria-labelledby`). */
  titleId?: string;
  /**
   * The owner's key handling on the popup. A sheet with an editable field keeps its own Escape
   * rule here: call `preventBaseUIHandler` and `stopPropagation` to take the key from Base UI.
   */
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement> & { preventBaseUIHandler?: () => void }) => void;
  children: ReactNode;
  /** The popup's `data-slot`; its backdrop is `<slot>-backdrop`. Default "side-sheet". */
  "data-slot"?: string;
}

interface SideSheetApi {
  activate: (payload?: unknown) => void;
  closeLabel: string;
}

const SideSheetContext = createContext<SideSheetApi | null>(null);

/** For the sheet's children: `activate(payload)` closes it with reason `"activate"`, then `onActivated(payload)` runs. */
export function useSideSheet(): SideSheetApi {
  const api = useContext(SideSheetContext);
  if (!api) throw new Error("useSideSheet must be used inside a SideSheet");
  return api;
}

/** Close as a real `--hit` square button named by `closeLabel`. */
export function SideSheetClose({ className }: { className?: string }) {
  const { closeLabel } = useSideSheet();
  return (
    <Dialog.Close
      render={<Button type="button" variant="ghost" size="icon-touch" aria-label={closeLabel} className={className} />}
    >
      <X aria-hidden="true" className="size-[var(--nav-icon)]" />
    </Dialog.Close>
  );
}

/** The scrolling body, with the fade cue while it overflows (`fade` false turns it off). */
export function SideSheetBody({
  children,
  className,
  fade = true,
  fadeKey = 0,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  fade?: boolean;
  /** Re-measures the fade when the content changes. */
  fadeKey?: string | number;
  "data-slot"?: string;
}) {
  const mask = useFadeMask<HTMLDivElement>(fadeKey);
  return (
    <div
      {...rest}
      ref={mask.ref}
      onScroll={fade ? mask.onScroll : undefined}
      style={fade ? mask.style : undefined}
      data-overflow-top={fade ? mask["data-overflow-top"] : undefined}
      data-overflow-bottom={fade ? mask["data-overflow-bottom"] : undefined}
      className={cn("scrollbar-v2 min-h-0 flex-1 overflow-y-auto", className)}
    >
      {children}
    </div>
  );
}

const TITLE_CLASS = "font-heading text-section font-bold uppercase leading-tight text-foreground outline-none";

/**
 * A modal side sheet on Base UI `Dialog` (spec §7): the Go palette's Android popup, made
 * reusable. Back, focus and the on-screen keyboard follow the contract the palette proved on a
 * device (R27, R29, R37, R79, R87); see `useSheetBack` for Back.
 */
export function SideSheet({
  open,
  onClose,
  title,
  side = "start",
  alignToRail = false,
  initialFocus = "title",
  returnFocus,
  fitVisualViewport = false,
  onActivated,
  headerExtra,
  closeLabel,
  closePlacement = "header",
  platform,
  activateRef,
  titleId: titleIdProp,
  onKeyDown,
  children,
  "data-slot": slot = "side-sheet",
}: SideSheetProps) {
  const ownTitleId = useId();
  const titleId = titleIdProp ?? ownTitleId;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const android = platform === "android";
  const rail = alignToRail && side === "start";

  const latest = useRef({ onClose, onActivated, returnFocus });
  latest.current = { onClose, onActivated, returnFocus };

  // R37: an activation closes the sheet and runs only once the close completes.
  const closeReason = useRef<SideSheetCloseReason>("dismiss");
  const pending = useRef<{ payload: unknown } | null>(null);
  // The payload of the last close by activation; a fresh object per activation.
  const [activated, setActivated] = useState<{ payload: unknown } | null>(null);
  const ranActivation = useRef<{ payload: unknown } | null>(null);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);

  useSheetBack({
    open,
    android,
    onBack: () => {
      closeReason.current = "dismiss";
      latest.current.onClose("dismiss");
    },
  });

  // The sheet follows the visual viewport, so the soft keyboard never covers its rows (R29).
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!open || !fitVisualViewport || !viewport) return;
    const update = () => setViewportHeight(viewport.height);
    update();
    viewport.addEventListener("resize", update);
    return () => viewport.removeEventListener("resize", update);
  }, [open, fitVisualViewport]);

  // Base UI asks for the final focus after the close completes, so the reason is reset on
  // the next open. An activation whose close a reopening interrupted is dropped there too.
  useEffect(() => {
    if (!open) return;
    closeReason.current = "dismiss";
    pending.current = null;
  }, [open]);

  const activate = useCallback((payload?: unknown) => {
    pending.current = { payload };
    closeReason.current = "activate";
    latest.current.onClose("activate");
  }, []);
  useEffect(() => {
    if (!activateRef) return;
    activateRef.current = activate;
    return () => {
      activateRef.current = null;
    };
  }, [activateRef, activate]);

  const handleOpenChange = (next: boolean) => {
    if (!next) latest.current.onClose("dismiss");
  };

  const handleOpenChangeComplete = (isOpen: boolean) => {
    if (isOpen || closeReason.current !== "activate") return;
    const entry = pending.current;
    pending.current = null;
    if (entry) setActivated(entry);
  };

  // R37: run the activation from an effect, after the commit that unmounts the popup. Base UI
  // may report the close complete while the background is still `aria-hidden` (at once when
  // nothing animates), and focus or an announcement there would be lost. On Android it also
  // waits for the sheet's history entry to come off (R87), so a route it pushes is not undone
  // by that pop.
  useEffect(() => {
    if (!activated || ranActivation.current === activated) return;
    return whenPaletteEntryOff(() => {
      ranActivation.current = activated;
      latest.current.onActivated?.(activated.payload);
    });
  }, [activated]);

  // R27/R37: Escape, Close, the backdrop and Back return focus to the owner's element (else
  // main); an activation returns it nowhere, since the owner moves it after the close.
  const finalFocus = useCallback(() => {
    if (closeReason.current === "activate") return false;
    return latest.current.returnFocus?.() ?? document.getElementById("main-content");
  }, []);

  const api = useMemo<SideSheetApi>(() => ({ activate, closeLabel }), [activate, closeLabel]);
  const popupStyle =
    fitVisualViewport && viewportHeight !== null
      ? ({ "--sheet-vvh": `${viewportHeight}px` } as CSSProperties)
      : undefined;

  const heading = (
    <Dialog.Title
      id={titleId}
      ref={titleRef}
      tabIndex={-1}
      className={cn(TITLE_CLASS, closePlacement === "header" ? "min-w-0 flex-1" : "px-4 pt-3")}
    >
      {title}
    </Dialog.Title>
  );

  return (
    <SideSheetContext.Provider value={api}>
      <Dialog.Root open={open} onOpenChange={handleOpenChange} onOpenChangeComplete={handleOpenChangeComplete}>
        <Dialog.Portal>
          <Dialog.Backdrop data-slot={`${slot}-backdrop`} className="fixed inset-0 z-50 bg-background/70" />
          <Dialog.Popup
            aria-modal="true"
            aria-labelledby={titleId}
            initialFocus={initialFocus === "title" ? titleRef : initialFocus}
            finalFocus={finalFocus}
            onKeyDown={onKeyDown}
            data-slot={slot}
            data-platform={platform}
            data-side={side}
            data-align-to-rail={rail ? "true" : undefined}
            style={popupStyle}
            className={cn(
              "fixed z-50 flex flex-col overflow-hidden border-line bg-popover text-popover-foreground shadow-lg outline-none",
              "h-[var(--sheet-vvh,100dvh)] w-[var(--sheet-w)] max-w-full pt-[var(--safe-top)] pb-[var(--safe-bottom)]",
              side === "end"
                ? "inset-y-0 end-0 border-s pe-[var(--safe-right)]"
                : rail
                  ? "inset-y-0 start-[calc(var(--safe-left)+var(--rail-w-phone,0px))] border-e"
                  : "inset-y-0 start-0 border-e ps-[var(--safe-left)]",
            )}
          >
            {closePlacement === "header" ? (
              <div className="flex min-h-[var(--hit)] shrink-0 items-center gap-2 ps-4 pe-1">
                {heading}
                {headerExtra}
                <SideSheetClose />
              </div>
            ) : (
              heading
            )}
            {children}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </SideSheetContext.Provider>
  );
}
