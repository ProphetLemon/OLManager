import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useMenuBackExit } from "@/hooks/useMenuBackExit";

function Menu({ enabled, exit }: { enabled: boolean; exit: () => Promise<void> }) {
  useMenuBackExit(enabled, exit);
  return <p>menu</p>;
}

/**
 * What React Router does on a Back that changes the route: its bubble-phase `popstate`
 * listener (registered before any screen's) renders the new route in a microtask, which
 * unmounts the screen and removes its listeners before the event reaches them. jsdom runs
 * no microtask checkpoint between listeners, so the test unmounts synchronously instead.
 */
function routerThatLeavesTheMenu(unmount: () => void) {
  const listener = vi.fn(() => unmount());
  window.addEventListener("popstate", listener);
  return listener;
}

describe("useMenuBackExit", () => {
  afterEach(() => vi.restoreAllMocks());

  it("exits even when the pop is a route change that unmounts the menu", () => {
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
