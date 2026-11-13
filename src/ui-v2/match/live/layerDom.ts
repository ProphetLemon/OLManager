import { useCallback, useRef } from "react";

import type { LinkEndpoints } from "@/lib/match/live/linkGeometry";

/**
 * What the layers that move on the frame path share: a registry of the elements to move, by key,
 * and the writers that put a position on them. Nothing here renders.
 */

/** Remembers the elements the frame path has to move, by a key, without a render. */
export function useElementRegistry() {
  const elements = useRef(new Map<string, Element>());
  const callbacks = useRef(new Map<string, (element: Element | null) => void>());
  const refFor = useCallback((key: string) => {
    let callback = callbacks.current.get(key);
    if (!callback) {
      callback = (element) => {
        if (element) elements.current.set(key, element);
        else elements.current.delete(key);
      };
      callbacks.current.set(key, callback);
    }
    return callback;
  }, []);
  return { elements, refFor };
}

export const keyOf = (part: string, id: string) => `${part}:${id}`;

export function writeLine(element: Element | undefined, endpoints: Pick<LinkEndpoints, "x1" | "y1" | "x2" | "y2">) {
  if (!element) return;
  element.setAttribute("x1", endpoints.x1.toFixed(1));
  element.setAttribute("y1", endpoints.y1.toFixed(1));
  element.setAttribute("x2", endpoints.x2.toFixed(1));
  element.setAttribute("y2", endpoints.y2.toFixed(1));
}

export function writeDot(element: Element | undefined, x: number, y: number) {
  if (!element) return;
  element.setAttribute("cx", x.toFixed(1));
  element.setAttribute("cy", y.toFixed(1));
}
