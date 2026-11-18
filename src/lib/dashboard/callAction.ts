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

/**
 * Whether the renewal dialog takes focus and speaks for itself. The legacy modal
 * frame (`DashboardModalFrame`) has no dialog role, initial focus, trap or focus
 * return, so it does not, and a renewal hands off like any other move (R69).
 * Porting the frame to a Base UI Dialog turns this on again.
 */
const RENEWAL_DIALOG_TAKES_FOCUS = false;

/**
 * Whether a move opens UI that takes focus and speaks for itself. Its caller then
 * skips the focus on main and the route announcement (R37 for the palette, R57
 * for the lane), which would pull focus off that UI. No move does while the
 * renewal dialog is the legacy frame (R69).
 */
export function opensOwnFocus(intent: NavIntent): boolean {
  return RENEWAL_DIALOG_TAKES_FOCUS && intent.kind === "player" && intent.openRenewal === true;
}
