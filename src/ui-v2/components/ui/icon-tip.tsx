import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/ui-v2/lib/utils";

export const ICON_TIP_HOVER_DELAY_MS = 350;
export const ICON_TIP_LONG_PRESS_MS = 450;
export const ICON_TIP_TOUCH_HIDE_MS = 2500;
/** After a long press ends, the click the browser still sends is swallowed for this long. */
const CLICK_SWALLOW_MS = 600;
const VIEWPORT_MARGIN = 6;
const GAP = 6;

export interface IconTipProps extends Omit<HTMLAttributes<HTMLSpanElement>, "title"> {
  /** The text of the tip. Also what a pointer user reads; screen readers get it elsewhere. */
  label: string;
  children?: ReactNode;
}

interface Placement {
  left: number;
  top: number;
}

/**
 * A tip for an icon that sits inside a button, so it cannot be focusable or a button itself.
 * Mouse and pen: hover opens it after a short delay and leaving closes it. Touch: a long press
 * opens it and swallows the click that press would otherwise send to the parent, so a plain
 * tap still does what the parent does. It closes on the next press anywhere, on scroll, on
 * Escape and after a couple of seconds.
 *
 * Nothing is rendered or listened to while closed; the plate is portalled only while open, so a
 * screen with many icons carries no extra tree. The names should also reach assistive
 * technology through the parent's description, because the plate is not announced.
 */
export function IconTip({ label, className, children, ...rest }: IconTipProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const pressTimer = useRef<number | undefined>(undefined);
  const hideTimer = useRef<number | undefined>(undefined);

  const clearTimers = useCallback(() => {
    window.clearTimeout(hoverTimer.current);
    window.clearTimeout(pressTimer.current);
    window.clearTimeout(hideTimer.current);
  }, []);

  const close = useCallback(() => {
    clearTimers();
    setOpen(false);
  }, [clearTimers]);

  useEffect(() => clearTimers, [clearTimers]);

  // Listeners exist only while the tip is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onPress = (event: Event) => {
      if (event instanceof PointerEvent && event.pointerType === "mouse") return;
      close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPress, true);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPress, true);
      window.removeEventListener("scroll", close, true);
    };
  }, [open, close]);

  const swallowNextClick = () => {
    const swallow = (event: Event) => {
      event.stopPropagation();
      event.preventDefault();
      window.removeEventListener("click", swallow, true);
    };
    window.addEventListener("click", swallow, true);
    window.setTimeout(() => window.removeEventListener("click", swallow, true), CLICK_SWALLOW_MS);
  };

  const onPointerEnter = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (event.pointerType === "touch") return;
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setOpen(true), ICON_TIP_HOVER_DELAY_MS);
  };

  const onPointerLeave = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (event.pointerType === "touch") return;
    close();
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (event.pointerType !== "touch") return;
    window.clearTimeout(pressTimer.current);
    pressTimer.current = window.setTimeout(() => {
      swallowNextClick();
      setOpen(true);
      hideTimer.current = window.setTimeout(close, ICON_TIP_TOUCH_HIDE_MS);
    }, ICON_TIP_LONG_PRESS_MS);
  };

  const cancelPress = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (event.pointerType === "touch") window.clearTimeout(pressTimer.current);
  };

  return (
    <span
      {...rest}
      ref={triggerRef}
      className={className}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerDown={onPointerDown}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
      onContextMenu={(event) => event.preventDefault()}
    >
      {children}
      {open ? <IconTipPlate label={label} anchor={triggerRef} /> : null}
    </span>
  );
}

function IconTipPlate({ label, anchor }: { label: string; anchor: React.RefObject<HTMLSpanElement | null> }) {
  const plateRef = useRef<HTMLSpanElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

  useLayoutEffect(() => {
    const trigger = anchor.current;
    const plate = plateRef.current;
    if (!trigger || !plate) return;
    const a = trigger.getBoundingClientRect();
    const p = plate.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const centred = a.left + a.width / 2 - p.width / 2;
    const left = Math.min(Math.max(centred, VIEWPORT_MARGIN), Math.max(VIEWPORT_MARGIN, vw - p.width - VIEWPORT_MARGIN));
    const above = a.top - p.height - GAP;
    setPlacement({ left, top: above >= VIEWPORT_MARGIN ? above : a.bottom + GAP });
  }, [anchor, label]);

  return createPortal(
    <span
      ref={plateRef}
      role="tooltip"
      data-slot="icon-tip"
      className={cn(
        "pointer-events-none fixed z-50 w-max max-w-[min(16rem,calc(100vw-1rem))] rounded border border-line bg-popover px-2 py-1",
        "font-heading text-caption font-semibold leading-tight text-popover-foreground shadow-md",
        "motion-safe:animate-in motion-safe:fade-in-0",
      )}
      style={{ left: placement?.left ?? 0, top: placement?.top ?? 0, visibility: placement ? "visible" : "hidden" }}
    >
      {label}
    </span>,
    document.body,
  );
}
