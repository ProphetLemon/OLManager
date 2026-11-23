import { render } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { useMenuBackExit } from "@/hooks/useMenuBackExit";
import { useDashboardBackHold } from "@/ui-v2/dashboard/useDashboardBackHold";
import { forgetPaletteEntry, pushPaletteEntry, nativeBackRegistered, registerBackDismisser, releasePaletteEntry } from "@/ui-v2/palette/paletteHistory";

import { BACK_IN_FLIGHT_TIMEOUT_MS, BACK_RESTORE_TIMEOUT_MS, handleNativeBack, installBackGuard, registerNativeBack, resetBackGuardForTests, setBackMeaning } from "./backGuard";

/**
 * Tauri's `back-button` event: with a JS listener registered the native side neither traverses
 * the history nor closes the app, it only reports `{ canGoBack }`, so `handleNativeBack` owns
 * what the press does. The slot decides first: `canGoBack` may be stale by the time it runs.
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

describe("native back button", () => {
  let back: ReturnType<typeof vi.spyOn>;
  let forward: ReturnType<typeof vi.spyOn>;
  let exitApp: Mock<() => Promise<void>>;
  let view: ReturnType<typeof render> | undefined;

  beforeAll(() => installBackGuard());
  beforeEach(() => {
    back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    forward = vi.spyOn(window.history, "forward").mockImplementation(() => {});
    exitApp = vi.fn<() => Promise<void>>(() => Promise.resolve());
  });
  afterEach(() => {
    view?.unmount();
    view = undefined;
    forgetPaletteEntry();
    resetBackGuardForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("the palette's entry", () => {
    it("is taken off with one history.back() while it is pushed, whatever canGoBack says", () => {
      pushPaletteEntry();
      handleNativeBack({ canGoBack: false }, exitApp);
      expect(back).toHaveBeenCalledTimes(1);
      expect(exitApp).not.toHaveBeenCalled();
    });

    it("is left alone while it is being released", () => {
      pushPaletteEntry();
      releasePaletteEntry(); // its own history.back()
      back.mockClear();
      handleNativeBack({ canGoBack: true }, exitApp);
      expect(back).not.toHaveBeenCalled();
      expect(exitApp).not.toHaveBeenCalled();
      pop(); // the release's own pop arrives and the palette forgets the entry
    });
  });

  describe("hold", () => {
    it("does nothing at all, even when canGoBack is false", () => {
      view = render(<Dashboard />);
      handleNativeBack({ canGoBack: false }, exitApp);
      handleNativeBack({ canGoBack: true }, exitApp);
      expect(back).not.toHaveBeenCalled();
      expect(forward).not.toHaveBeenCalled();
      expect(exitApp).not.toHaveBeenCalled();
    });
  });

  describe("exit", () => {
    it("calls the menu's exit once and no history method, even when canGoBack is true", () => {
      const exit = vi.fn(() => Promise.resolve());
      view = render(<Menu exit={exit} />);
      handleNativeBack({ canGoBack: true }, exitApp);
      expect(exit).toHaveBeenCalledTimes(1);
      expect(back).not.toHaveBeenCalled();
      expect(exitApp).not.toHaveBeenCalled();
    });

    it("logs a rejected exit and retries on the next press", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const exit = vi.fn(() => Promise.reject(new Error("no exit")));
      view = render(<Menu exit={exit} />);
      handleNativeBack({ canGoBack: false }, exitApp);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(error).toHaveBeenCalled();
      handleNativeBack({ canGoBack: false }, exitApp);
      expect(exit).toHaveBeenCalledTimes(2);
    });
  });

  describe("nothing set", () => {
    it("goes back once when the WebView can", () => {
      handleNativeBack({ canGoBack: true }, exitApp);
      expect(back).toHaveBeenCalledTimes(1);
      expect(exitApp).not.toHaveBeenCalled();
    });

    it("closes the app once when it cannot", () => {
      handleNativeBack({ canGoBack: false }, exitApp);
      expect(exitApp).toHaveBeenCalledTimes(1);
      expect(back).not.toHaveBeenCalled();
    });

    it("logs a rejected app exit", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      exitApp.mockRejectedValue(new Error("no exit"));
      handleNativeBack({ canGoBack: false }, exitApp);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(error).toHaveBeenCalled();
    });
  });

  describe("interplay with the popstate guard", () => {
    it("lets the pop of a go-back press through when nothing is set when it lands", () => {
      const router = vi.fn();
      window.addEventListener("popstate", router);
      handleNativeBack({ canGoBack: true }, exitApp);
      pop();
      window.removeEventListener("popstate", router);
      expect(router).toHaveBeenCalledTimes(1);
      expect(forward).not.toHaveBeenCalled();
    });

    it("exits through the guard when the pop of the first press lands on a menu that mounted since (the second press is ignored)", () => {
      const exit = vi.fn(() => Promise.resolve());
      const router = vi.fn();
      window.addEventListener("popstate", router);
      handleNativeBack({ canGoBack: true }, exitApp); // press 1 on Settings
      view = render(<Menu exit={exit} />); // the menu mounted before the second traversal's pop
      handleNativeBack({ canGoBack: true }, exitApp); // press 2: a back is in flight, ignored
      expect(exit).not.toHaveBeenCalled();
      pop(); // the pop lands on the menu: the guard exits once
      window.removeEventListener("popstate", router);
      expect(exit).toHaveBeenCalledTimes(1);
    });

    it("holds a pop that lands on the dashboard: the entry is taken back, the screen stays", () => {
      const router = vi.fn();
      window.addEventListener("popstate", router);
      handleNativeBack({ canGoBack: true }, exitApp); // press on Settings
      view = render(<Dashboard />); // the dashboard is showing when the pop lands
      pop();
      window.removeEventListener("popstate", router);
      expect(forward).toHaveBeenCalledTimes(1);
      expect(router).not.toHaveBeenCalled();
    });

    it("leaves the pop of a palette press to the palette and the router", () => {
      const router = vi.fn();
      window.addEventListener("popstate", router);
      view = render(<Dashboard />);
      pushPaletteEntry();
      handleNativeBack({ canGoBack: true }, exitApp);
      pop();
      window.removeEventListener("popstate", router);
      expect(forward).not.toHaveBeenCalled();
      expect(router).toHaveBeenCalledTimes(1);
    });
  });

  describe("one traversal at a time", () => {
    it("ignores a second press while the palette's entry is coming off", () => {
      pushPaletteEntry();
      handleNativeBack({ canGoBack: true }, exitApp);
      handleNativeBack({ canGoBack: true }, exitApp);
      expect(back).toHaveBeenCalledTimes(1);
      pop(); // the entry's pop arrives and the palette forgets it
    });

    it("walks one step and never exits on presses before the pop, even with canGoBack false", () => {
      handleNativeBack({ canGoBack: true }, exitApp);
      handleNativeBack({ canGoBack: true }, exitApp);
      handleNativeBack({ canGoBack: false }, exitApp);
      expect(back).toHaveBeenCalledTimes(1);
      expect(exitApp).not.toHaveBeenCalled();
    });

    it("decides afresh once the pop has arrived", () => {
      handleNativeBack({ canGoBack: true }, exitApp);
      pop();
      handleNativeBack({ canGoBack: true }, exitApp);
      expect(back).toHaveBeenCalledTimes(2);
      pop();
      view = render(<Dashboard />);
      handleNativeBack({ canGoBack: true }, exitApp); // hold: nothing
      expect(back).toHaveBeenCalledTimes(2);
      expect(exitApp).not.toHaveBeenCalled();
    });

    it("keeps a traversal in flight past the restore timeout while its pop is still on the way", () => {
      vi.useFakeTimers();
      handleNativeBack({ canGoBack: true }, exitApp);
      vi.advanceTimersByTime(BACK_RESTORE_TIMEOUT_MS + 1000);
      handleNativeBack({ canGoBack: true }, exitApp);
      expect(back).toHaveBeenCalledTimes(1);
      pop(); // the pop lands: cleared by it
      handleNativeBack({ canGoBack: true }, exitApp);
      expect(back).toHaveBeenCalledTimes(2);
    });

    it("forgets a traversal whose pop never comes after the long safety timeout", () => {
      vi.useFakeTimers();
      handleNativeBack({ canGoBack: true }, exitApp);
      handleNativeBack({ canGoBack: true }, exitApp);
      expect(back).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(BACK_IN_FLIGHT_TIMEOUT_MS);
      handleNativeBack({ canGoBack: true }, exitApp);
      expect(back).toHaveBeenCalledTimes(2);
    });

    it("lets a registered dismisser win over an in-flight traversal and everything else", () => {
      const dismiss = vi.fn();
      const unregister = registerBackDismisser(dismiss);
      handleNativeBack({ canGoBack: true }, exitApp);
      expect(dismiss).toHaveBeenCalledTimes(1);
      expect(back).not.toHaveBeenCalled();
      unregister();
      handleNativeBack({ canGoBack: true }, exitApp);
      expect(back).toHaveBeenCalledTimes(1);
    });

    it("dismisses the most recently registered overlay", () => {
      const first = vi.fn();
      const second = vi.fn();
      registerBackDismisser(first);
      registerBackDismisser(second);
      handleNativeBack({ canGoBack: true }, exitApp);
      expect(second).toHaveBeenCalledTimes(1);
      expect(first).not.toHaveBeenCalled();
    });

    it("ignores a press while the guard's own restore is pending", () => {
      const exit = vi.fn(() => Promise.resolve());
      view = render(<Menu exit={exit} />);
      pop(); // the fallback path: the guard exits and restores with forward()
      expect(exit).toHaveBeenCalledTimes(1);
      handleNativeBack({ canGoBack: true }, exitApp);
      expect(exit).toHaveBeenCalledTimes(1);
      expect(back).not.toHaveBeenCalled();
    });
  });

  describe("the meaning is set in the commit that shows the screen", () => {
    function Probe({ exitApp: app }: { exitApp: () => Promise<void> }) {
      // Runs in the same layout phase as the screen before it, ahead of any passive effect.
      useLayoutEffect(() => {
        handleNativeBack({ canGoBack: true }, app);
      });
      return null;
    }

    it("is already the menu's when a press is handled in the commit that mounts it", () => {
      const exit = vi.fn(() => Promise.resolve());
      view = render(
        <>
          <Menu exit={exit} />
          <Probe exitApp={exitApp} />
        </>,
      );
      expect(exit).toHaveBeenCalledTimes(1);
      expect(back).not.toHaveBeenCalled();
    });

    it("is already the dashboard's when a press is handled in the commit that mounts it", () => {
      view = render(
        <>
          <Dashboard />
          <Probe exitApp={exitApp} />
        </>,
      );
      expect(back).not.toHaveBeenCalled();
      expect(exitApp).not.toHaveBeenCalled();
    });

    it("is the new screen's when one screen replaces another in one commit", () => {
      const exit = vi.fn(() => Promise.resolve());
      view = render(<Dashboard />);
      view.rerender(
        <>
          <Menu exit={exit} />
          <Probe exitApp={exitApp} />
        </>,
      );
      expect(exit).toHaveBeenCalledTimes(1);
      expect(back).not.toHaveBeenCalled();
    });
  });

  describe("registerNativeBack", () => {
    it("registers a handler that routes the payload to handleNativeBack", async () => {
      const register = vi.fn((handler: (payload: { canGoBack: boolean }) => void) => {
        handler({ canGoBack: true });
        return Promise.resolve({});
      });
      await registerNativeBack(register, exitApp);
      expect(register).toHaveBeenCalledTimes(1);
      expect(back).toHaveBeenCalledTimes(1);
    });

    it("marks the native listener registered only once the registration resolved", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      await registerNativeBack(() => Promise.reject(new Error("denied")), exitApp);
      expect(nativeBackRegistered()).toBe(false);
      await registerNativeBack(() => Promise.resolve({}), exitApp);
      expect(nativeBackRegistered()).toBe(true);
    });

    it("reports a rejected registration and leaves the popstate guard as the fallback", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      await registerNativeBack(() => Promise.reject(new Error("denied")), exitApp);
      expect(error).toHaveBeenCalledWith(expect.stringContaining("back-button"), expect.any(Error));
      view = render(<Dashboard />);
      pop();
      expect(forward).toHaveBeenCalledTimes(1);
    });
  });

  it("keeps the slot's compare-before-clear for meanings set around a press", () => {
    const clear = setBackMeaning({ kind: "hold" });
    handleNativeBack({ canGoBack: true }, exitApp);
    expect(back).not.toHaveBeenCalled();
    clear();
    handleNativeBack({ canGoBack: true }, exitApp);
    expect(back).toHaveBeenCalledTimes(1);
  });
});
