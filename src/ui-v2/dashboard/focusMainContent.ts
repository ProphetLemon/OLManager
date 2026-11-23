/** The dashboard's main region: the target of Skip to main content and of the in-page Backs. */
export const MAIN_CONTENT_ID = "main-content";

/**
 * Moves focus to the main region. Without it focus would drop to the body and
 * nothing would say why, so a development build warns instead (CR4).
 */
export function focusMainContent(): void {
  const main = document.getElementById(MAIN_CONTENT_ID);
  if (main) {
    main.focus();
    return;
  }
  if (import.meta.env.DEV) {
    console.warn(`[dashboard] #${MAIN_CONTENT_ID} is missing, so focus was not moved to the main region.`);
  }
}
