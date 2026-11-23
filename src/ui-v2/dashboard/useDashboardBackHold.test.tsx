import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { pushPaletteEntry } from "@/ui-v2/palette/paletteHistory";

import { DASHBOARD_RESTORE_TIMEOUT_MS, useDashboardBackHold } from "./useDashboardBackHold";

const navigate = vi.fn();

function Dashboard({ android }: { android: boolean }) {
  useDashboardBackHold(android, navigate);
  return <p>dashboard</p>;
}

/**
 * React Router's bubble-phase `popstate` listener, registered before any screen's: on a pop
 * that leaves /dashboard it renders the new route in a microtask that runs between the two
 * listeners, unmounting the dashboard and removing its listener. jsdom runs no microtask
 * checkpoint between listeners, so the stub unmounts synchronously.
 */
function routerThatLeavesTheDashboard(unmount: () => void): Mock<() => void> {
  const listener = vi.fn<() => void>(() => unmount());
  window.addEventListener("popstate", listener);
  return listener;
}

const pop = () => window.dispatchEvent(new PopStateEvent("popstate"));

describe("useDashboardBackHold", () => {
  let forward: ReturnType<typeof vi.spyOn>;
  let router: Mock<() => void>;
  let view: ReturnType<typeof render>;

  function mount(android: boolean) {
    router = routerThatLeavesTheDashboard(() => view.unmount());
    view = render(<Dashboard android={android} />);
  }

  beforeEach(() => {
    navigate.mockClear();
    forward = vi.spyOn(window.history, "forward").mockImplementation(() => {});
  });
  afterEach(() => {
    window.removeEventListener("popstate", router);
    view.unmount();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("on Android", () => {
    it("keeps the player in the game when a Back leaves the route, and the router never sees it", () => {
      mount(true);

      pop();

      expect(forward).toHaveBeenCalledTimes(1);
      expect(router).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
    });

    it("does not read the pop that restores the entry as another Back, however many Backs follow", () => {
      mount(true);

      for (let back = 1; back <= 4; back += 1) {
        pop(); // the Back
        pop(); // the pop that history.forward() raises
        expect(forward).toHaveBeenCalledTimes(back);
      }
      expect(router).not.toHaveBeenCalled();
    });

    it("forgets a restoring pop that never comes, so the next Back is still held", () => {
      vi.useFakeTimers();
      mount(true);

      pop();
      vi.advanceTimersByTime(DASHBOARD_RESTORE_TIMEOUT_MS);
      pop();

      expect(forward).toHaveBeenCalledTimes(2);
    });

    it("leaves a pop that only took the palette's entry off to the palette", () => {
      mount(true);
      pushPaletteEntry();

      pop();

      expect(forward).not.toHaveBeenCalled();
      expect(router).toHaveBeenCalledTimes(1);
    });

    it("does not run once the dashboard is gone", () => {
      mount(true);
      view.unmount();

      pop();

      expect(forward).not.toHaveBeenCalled();
    });
  });

  describe("on desktop", () => {
    it("keeps the previous behaviour: no history call, and a pop that stays on the route is replaced", () => {
      const stay = vi.fn<() => void>();
      router = stay;
      window.addEventListener("popstate", stay);
      view = render(<Dashboard android={false} />);

      pop();

      expect(forward).not.toHaveBeenCalled();
      expect(stay).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith("/dashboard", { replace: true });
    });
  });
});
