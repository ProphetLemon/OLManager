import { describe, expect, it } from "vitest";

import { resolveDraftTipPlayerImage } from "@/ui-v2/_legacy/components/match/ChampionDraft";

describe("resolveDraftTipPlayerImage", () => {
  it("prefers the linked profile image", () => {
    expect(
      resolveDraftTipPlayerImage({ id: "player-1", name: "X", profile_image_url: "/custom/x.webp" }),
    ).toContain("/custom/x.webp");
  });

  it("falls back to the shared default instead of a nonexistent id path", () => {
    const url = resolveDraftTipPlayerImage({ id: "weird-id", name: "Nobody" });
    expect(url).toContain("defaultplayer");
  });
});
