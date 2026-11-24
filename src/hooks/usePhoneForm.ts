import { isAndroidUserAgent } from "@/ui-v2/uiScale";

/**
 * Whether the app runs as a phone: the same predicate `AppV2` uses to set `data-form="phone"` on
 * <html>. It reads the user agent while rendering instead of the attribute, because the
 * attribute is set in an effect: a screen that mounts first (the main menu) would otherwise
 * paint its desktop layout once before the phone one. It holds no state, so nothing re-renders.
 *
 * Desktop is always false, which is what keeps every phone branch away from it.
 */
export function usePhoneForm(): boolean {
  return isAndroidUserAgent(navigator.userAgent);
}
