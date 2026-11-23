import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Mod = typeof import("./paletteHistory");

/** The module keeps its state at module level, so each test gets a fresh copy. */
async function load(): Promise<Mod> {
  vi.resetModules();
  return import("./paletteHistory");
}

function pop(mod: Mod): ReturnType<Mod["paletteEntryPop"]> {
  const event = new PopStateEvent("popstate");
  window.dispatchEvent(event);
  return mod.paletteEntryPop(event);
}

describe("paletteHistory fallbacks", () => {
  let push: ReturnType<typeof vi.spyOn>;
  let back: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    push = vi.spyOn(window.history, "pushState").mockImplementation(() => {});
    back = vi.spyOn(window.history, "back").mockImplementation(() => {});
  });
  afterEach(() => {
    push.mockRestore();
    back.mockRestore();
    vi.useRealTimers();
  });

  it("forgets a released entry whose pop never comes, so the next open pushes again", async () => {
    const mod = await load();
    mod.pushPaletteEntry();
    mod.releasePaletteEntry();
    expect(push).toHaveBeenCalledTimes(1);
    expect(back).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(mod.PALETTE_ENTRY_POP_TIMEOUT_MS);
    mod.pushPaletteEntry();
    expect(push).toHaveBeenCalledTimes(2);
  });

  it("pushes after the fallback when the palette reopened while the pop was missing", async () => {
    const mod = await load();
    mod.pushPaletteEntry();
    mod.releasePaletteEntry();
    mod.pushPaletteEntry();
    expect(push).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(mod.PALETTE_ENTRY_POP_TIMEOUT_MS);
    expect(push).toHaveBeenCalledTimes(2);
    // Back now pops the new entry as the back gesture.
    expect(pop(mod)).toBe("back");
  });

  it("does not run the fallback once the pop has arrived", async () => {
    const mod = await load();
    mod.pushPaletteEntry();
    mod.releasePaletteEntry();
    expect(pop(mod)).toBe("release");

    // A palette that opened after the pop owns an entry the old timer must not touch.
    mod.pushPaletteEntry();
    expect(push).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(mod.PALETTE_ENTRY_POP_TIMEOUT_MS * 2);
    mod.pushPaletteEntry();
    expect(push).toHaveBeenCalledTimes(2);
    expect(pop(mod)).toBe("back");
  });

  it("gives a reopen its own full wait, not what was left of the release's", async () => {
    const mod = await load();
    mod.pushPaletteEntry();
    mod.releasePaletteEntry();
    vi.advanceTimersByTime(mod.PALETTE_ENTRY_POP_TIMEOUT_MS - 100);
    mod.pushPaletteEntry();
    // The pop arrives late but inside the reopen's wait: it is still read as the release.
    vi.advanceTimersByTime(50);
    expect(pop(mod)).toBe("release");
    expect(push).toHaveBeenCalledTimes(2);
  });

  it("reads a pop that arrives after the fallback as an ordinary pop (null)", async () => {
    // DashboardV2 then navigates to /dashboard with replace for it. That is accepted: the
    // fallback only fires when the WebView dropped the pop, and a late one is rare.
    const mod = await load();
    mod.pushPaletteEntry();
    mod.releasePaletteEntry();
    vi.advanceTimersByTime(mod.PALETTE_ENTRY_POP_TIMEOUT_MS);
    expect(pop(mod)).toBeNull();
  });

  it("forgets an entry taken off by an unmount whose pop never comes", async () => {
    const mod = await load();
    mod.pushPaletteEntry();
    window.history.replaceState({ olmPalette: true }, "");
    mod.forgetPaletteEntry();
    expect(back).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(mod.PALETTE_ENTRY_POP_TIMEOUT_MS);
    mod.pushPaletteEntry();
    expect(push).toHaveBeenCalledTimes(2);
  });
});
