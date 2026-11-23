import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { usePhoneForm } from "@/hooks/usePhoneForm";

const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; CPH2449) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
const DESKTOP_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function withUserAgent(userAgent: string) {
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(userAgent);
}

describe("usePhoneForm", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is true on an Android user agent, the predicate AppV2 uses to set data-form", () => {
    withUserAgent(ANDROID_UA);
    expect(renderHook(() => usePhoneForm()).result.current).toBe(true);
  });

  it("is false on a desktop user agent", () => {
    withUserAgent(DESKTOP_UA);
    expect(renderHook(() => usePhoneForm()).result.current).toBe(false);
  });

  it("reads the user agent when it renders, so it is right on the first paint", () => {
    withUserAgent(DESKTOP_UA);
    const hook = renderHook(() => usePhoneForm());
    expect(hook.result.current).toBe(false);

    withUserAgent(ANDROID_UA);
    hook.rerender();
    expect(hook.result.current).toBe(true);
  });
});
