import type { CallItem } from "./needsYourCall";
import type { DashboardNavigateContext, NavIntent } from "./profileNavigation";

/**
 * Where acting on a call goes, the same from Home, the lane and the palette:
 * a contract with a player opens that profile on the renewal flow, and
 * anything else opens its tab with its context.
 */
export function callAction(item: CallItem): NavIntent {
  const playerId = item.target.context?.playerId;
  if (item.kind === "contract" && typeof playerId === "string") {
    return { kind: "player", id: playerId, openRenewal: true };
  }
  return {
    kind: "tab",
    tab: item.target.tab,
    context: item.target.context as DashboardNavigateContext | undefined,
  };
}
