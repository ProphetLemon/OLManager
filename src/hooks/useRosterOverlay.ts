import { useCallback, useEffect, useRef, useState } from "react";

import {
  getWorldOverlayInfo,
  updateWorldOverlay,
  type WorldOverlayInfo,
} from "@/services/worldOverlayService";

export type RosterOverlayStatus = "idle" | "updating" | "updated" | "upToDate" | "error";

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}

/**
 * Tracks the roster overlay a new game will use and the "Update rosters"
 * action. Failures are reported through `error`; they never block the screen.
 */
export function useRosterOverlay() {
  const [info, setInfo] = useState<WorldOverlayInfo | null>(null);
  const [status, setStatus] = useState<RosterOverlayStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    getWorldOverlayInfo()
      .then((result) => {
        if (mounted.current && result) setInfo(result);
      })
      .catch((err) => console.warn("[RosterOverlay] could not read overlay info:", err));
    return () => {
      mounted.current = false;
    };
  }, []);

  const update = useCallback(async () => {
    setStatus("updating");
    setError(null);
    try {
      const result = await updateWorldOverlay();
      if (!mounted.current) return;
      setInfo(result);
      setStatus(result.updated ? "updated" : "upToDate");
    } catch (err) {
      if (!mounted.current) return;
      setError(errorText(err));
      setStatus("error");
    }
  }, []);

  return { info, status, error, update };
}
