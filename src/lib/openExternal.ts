export const GITHUB_URL = "https://github.com/ProphetLemon/OLManager";
export const LATEST_RELEASE_URL = `${GITHUB_URL}/releases/latest`;

/** Opens a URL in the system browser (Tauri opener, which also works on Android), or a new tab on the web. */
export function openExternal(url: string): void {
  const isTauri =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  if (isTauri) {
    void import("@tauri-apps/plugin-opener")
      .then((m) => m.openUrl(url))
      .catch(() => window.open(url, "_blank", "noopener,noreferrer"));
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
