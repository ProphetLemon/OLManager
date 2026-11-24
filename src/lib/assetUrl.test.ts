import { afterEach, describe, expect, it, vi } from "vitest";

import { assetUrl } from "./assetUrl";

const UA = {
  android: "Mozilla/5.0 (Linux; Android 14; CPH2449) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/126.0",
  linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15",
};

function inTauri(userAgent: string) {
  vi.stubGlobal("__TAURI_INTERNALS__", {});
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("assetUrl", () => {
  it("uses the http form on Android and Windows, where the scheme form does not load", () => {
    inTauri(UA.android);
    expect(assetUrl("/player-photos/a b.webp")).toBe("http://olm-asset.localhost/player-photos/a%20b.webp");
    inTauri(UA.windows);
    expect(assetUrl("/default/defaultplayer.webp")).toBe("http://olm-asset.localhost/default/defaultplayer.webp");
  });

  it("uses the scheme form on Linux", () => {
    inTauri(UA.linux);
    expect(assetUrl("/player-photos/x.webp")).toBe("olm-asset://localhost/player-photos/x.webp");
  });

  it("leaves a path alone outside Tauri, and anything that is not root-relative", () => {
    expect(assetUrl("/player-photos/x.webp")).toBe("/player-photos/x.webp");
    inTauri(UA.android);
    expect(assetUrl("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
    expect(assetUrl(null)).toBeNull();
  });
});
