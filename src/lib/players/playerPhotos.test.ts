import { afterEach, describe, expect, it, vi } from "vitest";

import { resolvePlayerPhoto } from "./playerPhotos";

describe("resolvePlayerPhoto", () => {
  it("prefers imported match-name photos over generated player-id guesses", () => {
    // "Selenex" exists in the imported player data, so the resolver must return
    // that imported photo rather than the player-id-based guess. The exact hash
    // is data-dependent, so assert the contract instead of a literal filename.
    const resolved = resolvePlayerPhoto("player-randomid", "Selenex", null);
    expect(resolved).not.toBe("/player-photos/player-randomid.webp");
    expect(resolved).toMatch(/^\/player-photos\/.+\.(webp|png)$/);
  });

  it("keeps explicit profile image urls as the highest priority", () => {
    expect(resolvePlayerPhoto("player-randomid", "Selenex", "/custom/photo.webp")).toBe(
      "/custom/photo.webp",
    );
  });
});

describe("the default silhouette", () => {
  it("is used when neither the id nor the name matches a photo", () => {
    expect(resolvePlayerPhoto("unknown-id", "Nobody")).toContain("defaultplayer");
  });
});

describe("the default silhouette", () => {
  it("is used when neither the id nor the name matches a photo", () => {
    expect(resolvePlayerPhoto("unknown-id", "Nobody")).toContain("defaultplayer");
  });
});

describe("a photo stored inside the save", () => {
  // The form `prepare_custom_portrait` produces and a founder keeps in `profile_image_url`.
  const STORED = "data:image/png;base64,iVBORw0KGgo=";

  afterEach(() => vi.unstubAllGlobals());

  it("is shown as it is, over the id and name guesses", () => {
    expect(resolvePlayerPhoto("gen-ray-mid-1", "Selenex", STORED)).toBe(STORED);
  });

  it("is not rewritten into an olm-asset url in the desktop app", () => {
    vi.stubGlobal("window", Object.assign(Object.create(window), { __TAURI_INTERNALS__: {} }));

    expect(resolvePlayerPhoto("gen-ray-mid-1", "Selenex", STORED)).toBe(STORED);
  });

  it("is ignored when blank, so the default avatar still applies", () => {
    expect(resolvePlayerPhoto("gen-ray-mid-1", "NoSuchNick", "  ")).toBe("/default/defaultplayer.webp");
  });
});
