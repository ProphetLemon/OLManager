import { createContext, useContext } from "react";

import type { FrameBus } from "./frameBus";
import type { LiveFrame } from "./useLiveSession";

/**
 * What every layer of the arena shares: the side of the square map in pixels, measured once
 * by the map host, and the frame bus the frame path listens to.
 */
export interface ArenaMapContextValue {
  sizePx: number;
  bus: FrameBus<LiveFrame>;
}

export const ArenaMapContext = createContext<ArenaMapContextValue | null>(null);

function useArenaMapContext(): ArenaMapContextValue {
  const value = useContext(ArenaMapContext);
  if (!value) throw new Error("Arena layers must render inside ArenaMap");
  return value;
}

/** Side of the map in pixels. It changes only when the map is resized. */
export function useMapSize(): number {
  return useArenaMapContext().sizePx;
}

/** The bus that publishes the interpolated state on every animation frame. */
export function useArenaBus(): FrameBus<LiveFrame> {
  return useArenaMapContext().bus;
}
