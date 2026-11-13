import type { ReactNode } from "react";

import { ArenaMapContext } from "./arenaMapContext";
import type { FrameBus } from "./frameBus";
import type { LiveFrame } from "./useLiveSession";

/** Gives layers the map size and the bus without measuring anything, for tests. */
export function ArenaHarness({
  sizePx = 540,
  bus,
  children,
}: {
  sizePx?: number;
  bus: FrameBus<LiveFrame>;
  children: ReactNode;
}) {
  return <ArenaMapContext.Provider value={{ sizePx, bus }}>{children}</ArenaMapContext.Provider>;
}
