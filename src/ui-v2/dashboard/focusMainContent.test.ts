import { afterEach, describe, expect, it, vi } from "vitest";

import { MAIN_CONTENT_ID, focusMainContent } from "./focusMainContent";

describe("focusMainContent (CR4)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("moves focus to the main region", () => {
    document.body.innerHTML = `<button>elsewhere</button><main id="${MAIN_CONTENT_ID}" tabindex="-1"></main>`;
    document.querySelector("button")!.focus();
    focusMainContent();
    expect(document.activeElement).toBe(document.getElementById(MAIN_CONTENT_ID));
  });

  it("warns in development instead of failing silently when the main region is missing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    document.body.innerHTML = "<button>elsewhere</button>";
    expect(() => focusMainContent()).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`#${MAIN_CONTENT_ID}`));
  });
});
