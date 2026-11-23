import { getCurrentWindow } from "@tauri-apps/api/window";
import { exit } from "@tauri-apps/plugin-process";
import { isAndroidUserAgent } from "@/ui-v2/uiScale";

/**
 * Closes the app. Android has no window to destroy, so the process itself is
 * ended there; desktop leaves fullscreen and destroys the window. Errors
 * propagate so the caller can log them.
 */
export async function exitApp(userAgent: string = navigator.userAgent): Promise<void> {
  if (isAndroidUserAgent(userAgent)) {
    await exit(0);
    return;
  }
  if (document.fullscreenElement) {
    await document.exitFullscreen();
  }
  await getCurrentWindow().destroy();
}
