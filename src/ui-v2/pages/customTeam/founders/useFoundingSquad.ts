import { useCallback, useEffect, useRef, useState } from "react";

import {
  MAX_REROLLS,
  isEmptyOverrides,
  newFoundingSeed,
  parseFounderError,
  previewFoundingSquad,
} from "@/lib/customTeam/founders";
import type {
  FounderError,
  FounderOverrides,
  FoundingSquadSummary,
} from "@/lib/customTeam/founders";

export type SquadStatus = "idle" | "loading" | "ready" | "error";

export interface UseFoundingSquadInput {
  /** The squad is only fetched while the squad step is on screen. */
  enabled: boolean;
  competitionId: string;
  replacedTeamId: string | null;
  /** Normalized short name, exactly as the create spec will send it. */
  shortName: string;
}

export interface FoundingSquadState {
  status: SquadStatus;
  /** Last successful preview; always the squad the create spec reproduces when `inSync`. */
  squad: FoundingSquadSummary | null;
  /** The same seed without identity edits: the reference edits are diffed against. */
  generated: FoundingSquadSummary | null;
  /** Raw rejection of the last failed fetch. */
  error: string | null;
  seed: number;
  overrides: FounderOverrides;
  rerollsLeft: number;
  /** An identity edit made on a previous preview no longer fit and was dropped. */
  editsDropped: boolean;
  /** `squad` was produced by exactly the current inputs, so Create club may be used. */
  inSync: boolean;
  reroll: () => void;
  retry: () => void;
  /**
   * Validates `next` by previewing it. Resolves with the backend's field error,
   * or `null` once the overrides are kept.
   */
  applyOverrides: (next: FounderOverrides) => Promise<FounderError | null>;
}

const inputsKey = (
  competitionId: string,
  replacedTeamId: string | null,
  shortName: string,
  seed: number,
  overrides: FounderOverrides,
) => JSON.stringify([competitionId, replacedTeamId, shortName, seed, overrides]);

/**
 * State of the wizard's founding squad: the seed, the rerolls left, the identity
 * edits and the last successful `preview_founding_squad`. The create spec must
 * carry the same seed, short name and overrides as that preview, which is what
 * `inSync` reports.
 */
export function useFoundingSquad({
  enabled,
  competitionId,
  replacedTeamId,
  shortName,
}: UseFoundingSquadInput): FoundingSquadState {
  const [seed, setSeed] = useState(() => newFoundingSeed());
  const [rerollsUsed, setRerollsUsed] = useState(0);
  const [overrides, setOverrides] = useState<FounderOverrides>({});
  const [squad, setSquad] = useState<FoundingSquadSummary | null>(null);
  const [generated, setGenerated] = useState<FoundingSquadSummary | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [status, setStatus] = useState<SquadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [editsDropped, setEditsDropped] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const requestId = useRef(0);

  const currentKey = inputsKey(competitionId, replacedTeamId, shortName, seed, overrides);

  // Fetch whenever the inputs change while the step is on screen. The id guards
  // against a slow response overwriting a newer one.
  useEffect(() => {
    if (!enabled || !replacedTeamId) return;
    if (previewKey === currentKey && status === "ready") return;
    const id = ++requestId.current;
    const base = { competitionId, replacedTeamId, shortName, seed };
    setStatus("loading");
    setError(null);
    void (async () => {
      try {
        // The generated squad is always fetched: edits are diffed against it.
        const plain = await previewFoundingSquad({ ...base, founderOverrides: {} });
        if (id !== requestId.current) return;
        let shown = plain;
        let kept = overrides;
        if (!isEmptyOverrides(overrides)) {
          try {
            shown = await previewFoundingSquad({ ...base, founderOverrides: overrides });
          } catch (caught) {
            if (id !== requestId.current) return;
            if (parseFounderError(String(caught))?.kind !== "invalid_field") throw caught;
            // The club or short name changed under the edits: restore the
            // generated squad rather than keep edits that no longer fit.
            kept = {};
            setEditsDropped(true);
            setOverrides({});
          }
          if (id !== requestId.current) return;
        }
        setGenerated(plain);
        setSquad(shown);
        setPreviewKey(inputsKey(competitionId, replacedTeamId, shortName, seed, kept));
        setStatus("ready");
      } catch (caught) {
        if (id !== requestId.current) return;
        setError(String(caught));
        setStatus("error");
      }
    })();
    // `currentKey` already encodes every other input; `status` and `previewKey`
    // are only read to skip a fetch that would repeat the shown squad.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, currentKey, retryTick]);

  const reroll = useCallback(() => {
    if (rerollsUsed >= MAX_REROLLS) return;
    setRerollsUsed((used) => used + 1);
    setSeed(newFoundingSeed());
    setOverrides({});
    setEditsDropped(false);
  }, [rerollsUsed]);

  const retry = useCallback(() => setRetryTick((tick) => tick + 1), []);

  const applyOverrides = useCallback(
    async (next: FounderOverrides): Promise<FounderError | null> => {
      if (!replacedTeamId) return null;
      const id = ++requestId.current;
      try {
        const result = await previewFoundingSquad({
          competitionId,
          replacedTeamId,
          shortName,
          seed,
          founderOverrides: next,
        });
        if (id !== requestId.current) return null;
        setSquad(result);
        setOverrides(next);
        setPreviewKey(inputsKey(competitionId, replacedTeamId, shortName, seed, next));
        setStatus("ready");
        setError(null);
        setEditsDropped(false);
        return null;
      } catch (caught) {
        // A rejected candidate leaves the shown squad and the kept edits alone.
        const founderError = parseFounderError(String(caught));
        if (founderError) return founderError;
        throw caught;
      }
    },
    [competitionId, replacedTeamId, shortName, seed],
  );

  return {
    status,
    squad,
    generated,
    error,
    seed,
    overrides,
    rerollsLeft: MAX_REROLLS - rerollsUsed,
    editsDropped,
    inSync: status === "ready" && previewKey === currentKey && squad !== null,
    reroll,
    retry,
    applyOverrides,
  };
}
