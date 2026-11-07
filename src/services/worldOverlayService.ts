import { invoke } from "@tauri-apps/api/core";

export interface WorldOverlaySource {
  name: string;
  url: string;
  license: string;
  license_url: string;
  attribution: string;
}

export interface WorldOverlayInfo {
  /** Date (YYYY-MM-DD) the rosters are accurate for. */
  as_of: string;
  origin: "downloaded" | "bundled";
  source: WorldOverlaySource;
  player_ops: number;
  staff_ops: number;
  /** True only when an update call replaced the overlay with a newer one. */
  updated: boolean;
}

/** The roster overlay a new game would use right now. */
export async function getWorldOverlayInfo(): Promise<WorldOverlayInfo> {
  return invoke<WorldOverlayInfo>("get_world_overlay_info");
}

/**
 * Download a newer roster overlay (if any); rejects with the backend message.
 * `automatic` marks the background check made when the new-game screen opens,
 * which the backend gives a shorter timeout than a manual update.
 */
export async function updateWorldOverlay(
  options: { automatic?: boolean } = {},
): Promise<WorldOverlayInfo> {
  if (options.automatic) {
    return invoke<WorldOverlayInfo>("update_world_overlay", { automatic: true });
  }
  return invoke<WorldOverlayInfo>("update_world_overlay");
}
