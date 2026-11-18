import { useCallback, useEffect, useRef, useState } from "react";

/** How long the announcer waits for quiet before it speaks; the last message of a burst wins. */
export const ROUTE_ANNOUNCE_DEBOUNCE_MS = 300;

/** A "route" message names a place; a "status" one (R42, "N to resolve") does not. */
export type AnnouncementKind = "route" | "status";

/**
 * The route announcer's message (R46). `announce` posts after a short quiet
 * spell, so a quick run of moves speaks only where it ended. The same text
 * twice in a row gets a trailing no-break space, so the region's content
 * changes and a screen reader speaks it again. `clearRoute` is for a move that
 * says nothing (R51): it cancels and empties a route message, so the region
 * never names a place the user has already left, and leaves a status message.
 */
export function useRouteAnnouncer() {
  const [message, setMessage] = useState("");
  const timer = useRef<number | undefined>(undefined);
  // The kind of the message the region holds or has queued.
  const kind = useRef<AnnouncementKind>("route");

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const announce = useCallback((text: string, as: AnnouncementKind = "route") => {
    window.clearTimeout(timer.current);
    kind.current = as;
    timer.current = window.setTimeout(() => {
      setMessage((prev) => (prev === text ? `${text} ` : text));
    }, ROUTE_ANNOUNCE_DEBOUNCE_MS);
  }, []);

  const clearRoute = useCallback(() => {
    if (kind.current !== "route") return;
    window.clearTimeout(timer.current);
    setMessage("");
  }, []);

  return { message, announce, clearRoute };
}

/** The one polite live region for route changes, mounted once by the dashboard. */
export function RouteAnnouncer({ message }: { message: string }) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-slot="route-announcer">
      {message}
    </div>
  );
}
