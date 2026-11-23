import { render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { useMenuBackExit } from "@/hooks/useMenuBackExit";
import { installBackGuard, resetBackGuardForTests } from "@/lib/backGuard";

function Menu({ enabled, exit }: { enabled: boolean; exit: () => Promise<void> }) {
  useMenuBackExit(enabled, exit);
  return <p>menu</p>;
}

/**
 * What React Router does on a Back that changes the route: its `popstate` listener
 * (registered before any screen's) renders the new route in a microtask, which unmounts
 * the screen and removes its listeners before a later listener runs. jsdom runs no
 * microtask checkpoint between listeners, so the test unmounts synchronously instead. The
 * Back guard (`lib/backGuard.ts`) is registered before it, as `main.tsx` does, and these
 * tests show that it, being first, keeps the later listener from running. The install order
 * itself is pinned by `mainBackGuard.guard.test.ts` and was checked in a real browser.
 */
function routerThatLeavesTheMenu(unmount: () => void) {
  const listener = vi.fn(() => unmount());
  window.addEventListener("popstate", listener);
  return listener;
}

describe("useMenuBackExit", () => {
  beforeAll(() => installBackGuard());
  afterEach(() => {
    resetBackGuardForTests();
    vi.restoreAllMocks();
  });

  it("exits even when the pop is a route change that unmounts the menu", () => {
    vi.spyOn(window.history, "forward").mockImplementation(() => {});
    const exit = vi.fn(() => Promise.resolve());
    let unmount = () => {};
    const router = routerThatLeavesTheMenu(() => unmount());
    ({ unmount } = render(<Menu enabled exit={exit} />));

    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(exit).toHaveBeenCalledTimes(1);
    // The router never renders the stale route underneath while the app is closing.
    expect(router).not.toHaveBeenCalled();
    window.removeEventListener("popstate", router);
  });

  it("does nothing when disabled", () => {
    const exit = vi.fn(() => Promise.resolve());
    const router = vi.fn();
    window.addEventListener("popstate", router);
    render(<Menu enabled={false} exit={exit} />);

    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(exit).not.toHaveBeenCalled();
    expect(router).toHaveBeenCalledTimes(1);
    window.removeEventListener("popstate", router);
  });

  it("logs a failed exit and leaves the menu on screen", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(window.history, "forward").mockImplementation(() => {});
    const exit = vi.fn(() => Promise.reject(new Error("no exit")));
    const view = render(<Menu enabled exit={exit} />);

    window.dispatchEvent(new PopStateEvent("popstate"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(error).toHaveBeenCalled();
    expect(view.getByText("menu")).toBeTruthy();
  });

  it("stops listening once the menu is gone", () => {
    const exit = vi.fn(() => Promise.resolve());
    const view = render(<Menu enabled exit={exit} />);
    view.unmount();

    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(exit).not.toHaveBeenCalled();
  });
});
