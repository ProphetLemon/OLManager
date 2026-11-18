import { useCallback, useEffect, useRef, useState } from "react";

/** How long the announcer waits for quiet before it speaks; the last message of a burst wins. */
export const ROUTE_ANNOUNCE_DEBOUNCE_MS = 300;

/**
 * The route announcer's message (R46). `announce` posts after a short quiet
 * spell, so a quick run of moves speaks only where it ended. The same text
 * twice in a row gets a trailing no-break space, so the region's content
 * changes and a screen reader speaks it again.
 */
export function useRouteAnnouncer() {
  const [message, setMessage] = useState("");
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const announce = useCallback((text: string) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setMessage((prev) => (prev === text ? `${text} ` : text));
    }, ROUTE_ANNOUNCE_DEBOUNCE_MS);
  }, []);

  return { message, announce };
}

/** The one polite live region for route changes, mounted once by the dashboard. */
export function RouteAnnouncer({ message }: { message: string }) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-slot="route-announcer">
      {message}
    </div>
  );
}
