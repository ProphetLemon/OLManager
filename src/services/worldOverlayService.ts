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

/** Download a newer roster overlay (if any); rejects with the backend message. */
export async function updateWorldOverlay(): Promise<WorldOverlayInfo> {
  return invoke<WorldOverlayInfo>("update_world_overlay");
}
