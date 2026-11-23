import { useEffect, useRef } from "react";

/**
 * Runs `reset` after a commit in which any of `deps` changed, but never on
 * mount. A tab that remounts with its stored filters keeps its stored page,
 * while changing a filter afterwards still sends the page back to the first.
 */
export function useResetOnChange(deps: readonly unknown[], reset: () => void): void {
  const previous = useRef(deps);
  useEffect(() => {
    const before = previous.current;
    previous.current = deps;
    const same = before.length === deps.length && before.every((value, i) => Object.is(value, deps[i]));
    if (!same) reset();
  });
}
