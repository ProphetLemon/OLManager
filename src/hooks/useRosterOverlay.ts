import { useCallback, useEffect, useRef, useState } from "react";

import {
  getWorldOverlayInfo,
  updateWorldOverlay,
  type WorldOverlayInfo,
} from "@/services/worldOverlayService";

/**
 * `checking` is the automatic check made when the new-game screen opens;
 * `updating` is a manual "Update rosters" press. `checkFailed` is the quiet
 * outcome of a failed automatic check (`error` is the loud manual one).
 */
export type RosterOverlayStatus =
  | "idle"
  | "checking"
  | "updating"
  | "updated"
  | "upToDate"
  | "error"
  | "checkFailed";

type AutoCheckOutcome =
  | { kind: "info"; info: WorldOverlayInfo }
  | { kind: "failed" };

/**
 * One automatic check per app session: the screen can be reopened without
 * downloading again. While it is still running, a reopened screen follows it.
 */
let autoCheckRun: { settled: boolean; promise: Promise<AutoCheckOutcome> } | null = null;

function startAutoCheck(): NonNullable<typeof autoCheckRun> {
  const run = {
    settled: false,
    promise: updateWorldOverlay({ automatic: true }).then(
      (info): AutoCheckOutcome => ({ kind: "info", info }),
      (err): AutoCheckOutcome => {
        console.warn("[RosterOverlay] automatic roster check failed:", err);
        return { kind: "failed" };
      },
    ),
  };
  void run.promise.then(() => {
    run.settled = true;
  });
  return run;
}

/** Test helper: forget that the automatic check already ran this session. */
export function resetRosterAutoCheckForTests(): void {
  autoCheckRun = null;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}

/**
 * Tracks the roster overlay a new game will use and the "Update rosters"
 * action. Failures are reported through `error`; they never block the screen.
 */
export function useRosterOverlay({ autoCheck = false }: { autoCheck?: boolean } = {}) {
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

  useEffect(() => {
    if (!autoCheck) return;
    if (autoCheckRun === null) autoCheckRun = startAutoCheck();
    const run = autoCheckRun;
    if (run.settled) return;
    setStatus("checking");
    void run.promise.then((outcome) => {
      if (!mounted.current) return;
      if (outcome.kind === "failed") {
        setStatus("checkFailed");
        return;
      }
      setInfo(outcome.info);
      // An up-to-date result is deliberately silent.
      setStatus(outcome.info.updated ? "updated" : "idle");
    });
  }, [autoCheck]);

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
