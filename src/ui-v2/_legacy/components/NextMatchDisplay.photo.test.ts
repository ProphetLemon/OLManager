import { describe, expect, it } from "vitest";

import { playerPhotoUrl } from "@/ui-v2/_legacy/components/NextMatchDisplay";

describe("playerPhotoUrl", () => {
  it("honours the linked profile image for non lec-player ids", () => {
    const url = playerPhotoUrl("player-abc", "Abc", "/custom/abc.webp" as string);
    expect(url).toContain("/custom/abc.webp");
  });

  it("falls back to the default silhouette instead of no photo", () => {
    expect(playerPhotoUrl("unknown-id", "Nobody")).toContain("defaultplayer");
  });
});
