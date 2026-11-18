import { useCallback, useEffect, useRef, useState } from "react";

/** How long the announcer waits for quiet before it speaks; the last message of a burst wins. */
export const ROUTE_ANNOUNCE_DEBOUNCE_MS = 300;

/** A "route" message names a place; a "status" one (R42, "N to resolve") does not. */
export type AnnouncementKind = "route" | "status";

/**
 * The route announcer's message (R46). `announce` posts after a short quiet
 * spell, so a quick run of moves speaks only where it ended. A status and a
 * route message queued in the same spell are kept apart and posted together as
 * one utterance, "2 to resolve. Now on Squad, Club", so neither is lost (R60).
 * The same text twice in a row gets a trailing no-break space, so the region's
 * content changes and a screen reader speaks it again.
 *
 * `clearRoute` is for a move that says nothing (R51): it drops a queued route
 * message, letting a queued status post alone, and empties a shown message that
 * names a place, a combined one included, so the region never names a place the
 * user has left. `clearStatus` empties a shown status alone, which describes a
 * day that is over once the next advance starts.
 */
export function useRouteAnnouncer() {
  const [message, setMessage] = useState("");
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<Partial<Record<AnnouncementKind, string>>>({});
  // "route" when the shown message names a place, alone or after a status.
  const shownKind = useRef<AnnouncementKind>("route");

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const flush = useCallback(() => {
    const { status, route } = pending.current;
    pending.current = {};
    const text = [status, route].filter(Boolean).join(". ");
    if (!text) return;
    shownKind.current = route ? "route" : "status";
    setMessage((prev) => (prev === text ? `${text}\u00a0` : text));
  }, []);

  const announce = useCallback(
    (text: string, as: AnnouncementKind = "route") => {
      window.clearTimeout(timer.current);
      pending.current[as] = text;
      timer.current = window.setTimeout(flush, ROUTE_ANNOUNCE_DEBOUNCE_MS);
    },
    [flush],
  );

  const clearRoute = useCallback(() => {
    delete pending.current.route;
    if (pending.current.status === undefined) window.clearTimeout(timer.current);
    if (shownKind.current === "route") setMessage("");
  }, []);

  const clearStatus = useCallback(() => {
    if (shownKind.current === "status") setMessage("");
  }, []);

  return { message, announce, clearRoute, clearStatus };
}

/** The one polite live region for route changes, mounted once by the dashboard. */
export function RouteAnnouncer({ message }: { message: string }) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-slot="route-announcer">
      {message}
    </div>
  );
}
