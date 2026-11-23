import { render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { useMenuBackExit } from "@/hooks/useMenuBackExit";
import { DASHBOARD_RESTORE_TIMEOUT_MS, useDashboardBackHold } from "@/ui-v2/dashboard/useDashboardBackHold";
import { forgetPaletteEntry, PALETTE_ENTRY_POP_TIMEOUT_MS, pushPaletteEntry, releasePaletteEntry } from "@/ui-v2/palette/paletteHistory";

import { BACK_RESTORE_TIMEOUT_MS, installBackGuard, resetBackGuardForTests, setBackMeaning } from "./backGuard";

/**
 * Chromium runs `popstate` listeners on `window` in registration order, whatever their
 * capture flag, and a microtask queued by one runs before the next (react-dom renders a
 * popstate-caused route change in such a microtask). jsdom runs capture listeners first, so
 * the stub router below registers with `capture: true` BEFORE the screen mounts and unmounts
 * the screen synchronously: that is the order in which a screen's own listener never acts.
 */
function Menu({ exit }: { exit: () => Promise<void> }) {
  useMenuBackExit(true, exit);
  return <p>menu</p>;
}
function Dashboard() {
  useDashboardBackHold(true, vi.fn());
  return <p>dashboard</p>;
}

const pop = () => window.dispatchEvent(new PopStateEvent("popstate"));

describe("back guard", () => {
  let router: Mock<() => void>;
  let view: ReturnType<typeof render> | undefined;
  let forward: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    // Installed first, like main.tsx does before the router renders; the router comes after.
    installBackGuard();
  });
  beforeEach(() => {
    forward = vi.spyOn(window.history, "forward").mockImplementation(() => {});
    router = vi.fn<() => void>(() => view?.unmount());
    window.addEventListener("popstate", router, true);
  });
  afterEach(() => {
    window.removeEventListener("popstate", router, true);
    view?.unmount();
    view = undefined;
    forgetPaletteEntry();
    resetBackGuardForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("installs once however many times it is asked", () => {
    const add = vi.spyOn(window, "addEventListener");
    installBackGuard();
    installBackGuard();
    expect(add).not.toHaveBeenCalled();
  });

  describe("hold", () => {
    it("takes every Back and its restoring pop away from the router, however many follow", () => {
      view = render(<Dashboard />);
      for (let back = 1; back <= 3; back += 1) {
        pop(); // the Back
        pop(); // the pop that history.forward() raises
        expect(forward).toHaveBeenCalledTimes(back);
      }
      expect(router).not.toHaveBeenCalled();
      expect(view.getByText("dashboard")).toBeTruthy();
    });

    it("forgets a restoring pop that never comes, so the next Back is still held", () => {
      vi.useFakeTimers();
      view = render(<Dashboard />);
      pop();
      vi.advanceTimersByTime(DASHBOARD_RESTORE_TIMEOUT_MS);
      pop();
      expect(forward).toHaveBeenCalledTimes(2);
      expect(router).not.toHaveBeenCalled();
    });

    it("swallows the restoring pop whichever screen is mounted when it lands", () => {
      view = render(<Dashboard />);
      pop();
      view.unmount();
      pop();
      expect(router).not.toHaveBeenCalled();
    });

    it("leaves a pop that took the palette's entry off to the palette and the router", () => {
      view = render(<Dashboard />);
      pushPaletteEntry();
      pop();
      expect(forward).not.toHaveBeenCalled();
      expect(router).toHaveBeenCalledTimes(1);
    });
  });

  describe("hold, edge cases", () => {
    it("leaves the pop of a palette entry that is coming off to the palette and the router", () => {
      vi.spyOn(window.history, "back").mockImplementation(() => {});
      view = render(<Dashboard />);
      pushPaletteEntry();
      releasePaletteEntry(); // the palette's own history.back(): releasing, its pop not yet arrived
      pop();
      expect(forward).not.toHaveBeenCalled();
      expect(router).toHaveBeenCalledTimes(1);
    });

    it("reads a release pop that arrives after the palette's fallback as an ordinary Back", () => {
      vi.useFakeTimers();
      vi.spyOn(window.history, "back").mockImplementation(() => {});
      view = render(<Dashboard />);
      pushPaletteEntry();
      releasePaletteEntry();
      vi.advanceTimersByTime(PALETTE_ENTRY_POP_TIMEOUT_MS);
      pop();
      expect(forward).toHaveBeenCalledTimes(1);
      expect(router).not.toHaveBeenCalled();
    });

    it("takes a second Back during a pending restore as the restore pop, then holds the real restore pop as a Back", () => {
      vi.useFakeTimers();
      view = render(<Dashboard />);
      pop(); // Back 1: forward() #1, restore pending
      pop(); // Back 2 arrives first: swallowed as the restore pop
      expect(forward).toHaveBeenCalledTimes(1);
      pop(); // the real restore pop of forward() #1 now reads as a Back: forward() #2
      expect(forward).toHaveBeenCalledTimes(2);
      expect(router).not.toHaveBeenCalled();
      vi.advanceTimersByTime(BACK_RESTORE_TIMEOUT_MS);
      pop(); // nothing stays pending after the timeout: still a Back
      expect(forward).toHaveBeenCalledTimes(3);
      expect(router).not.toHaveBeenCalled();
    });
  });

  describe("exit", () => {
    it("calls exit once per Back, restore pops in between (accepted: a Back after a failed exit retries it)", () => {
      const exit = vi.fn(() => Promise.resolve());
      view = render(<Menu exit={exit} />);
      pop(); // Back 1
      pop(); // its restore pop
      pop(); // Back 2
      pop(); // its restore pop
      expect(exit).toHaveBeenCalledTimes(2);
      expect(forward).toHaveBeenCalledTimes(2);
      expect(router).not.toHaveBeenCalled();
    });

    it("exits once and the router never renders the stale route", () => {
      const exit = vi.fn(() => Promise.resolve());
      view = render(<Menu exit={exit} />);
      pop();
      expect(exit).toHaveBeenCalledTimes(1);
      expect(router).not.toHaveBeenCalled();
    });

    it("restores the entry, so a rejected exit leaves the URL and the router in agreement", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const exit = vi.fn(() => Promise.reject(new Error("no exit")));
      view = render(<Menu exit={exit} />);
      pop();
      pop(); // the restoring pop
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(forward).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalled();
      pop(); // the next Back tries again
      expect(exit).toHaveBeenCalledTimes(2);
      expect(router).not.toHaveBeenCalled();
    });

    it("does not exit for a menu that mounts after a Back from another screen", () => {
      const exit = vi.fn(() => Promise.resolve());
      const arrive = vi.fn<() => void>(() => {
        view = render(<Menu exit={exit} />);
      });
      window.addEventListener("popstate", arrive);
      pop(); // Back from Settings: nothing is set yet
      window.removeEventListener("popstate", arrive);
      expect(exit).not.toHaveBeenCalled();
      expect(router).toHaveBeenCalledTimes(1);
      pop(); // the next Back is on the menu
      expect(exit).toHaveBeenCalledTimes(1);
    });

    it("leaves a palette entry's pop alone", () => {
      const exit = vi.fn(() => Promise.resolve());
      view = render(<Menu exit={exit} />);
      pushPaletteEntry();
      pop();
      expect(exit).not.toHaveBeenCalled();
      expect(router).toHaveBeenCalledTimes(1);
    });
  });

  describe("no meaning", () => {
    it("does not touch the event", () => {
      pop();
      expect(router).toHaveBeenCalledTimes(1);
      expect(forward).not.toHaveBeenCalled();
    });
  });

  describe("the slot", () => {
    it("does not wipe a meaning another screen has set since", () => {
      const clearFirst = setBackMeaning({ kind: "hold" });
      const clearSecond = setBackMeaning({ kind: "exit", exit: () => Promise.resolve() });
      clearFirst();
      pop();
      expect(router).not.toHaveBeenCalled();
      clearSecond();
    });

    it("exports the restore timeout the dashboard reuses", () => {
      expect(DASHBOARD_RESTORE_TIMEOUT_MS).toBe(BACK_RESTORE_TIMEOUT_MS);
    });
  });
});
