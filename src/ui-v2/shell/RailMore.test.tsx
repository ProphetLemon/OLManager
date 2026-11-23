import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Settings } from "lucide-react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RailMore } from "./RailMore";

const onSelect = vi.fn();

function Harness({ android }: { android: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <RailMore
        label="More"
        android={android}
        open={open}
        onOpenChange={setOpen}
        items={[{ id: "settings", label: "Settings", icon: Settings, onSelect }]}
      />
      <output data-testid="state">{open ? "open" : "closed"}</output>
    </>
  );
}

const state = () => screen.getByTestId("state").textContent;
const later = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

describe("RailMore and the back gesture (R95)", () => {
  let mark = 0;
  let before: Record<string, unknown>;
  beforeEach(() => {
    before = { idx: 0, key: `more-${++mark}` };
    window.history.replaceState(before, "");
    onSelect.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("makes no history call on desktop, open or closed", async () => {
    const spies = (["pushState", "replaceState", "back", "go", "forward"] as const).map((m) =>
      vi.spyOn(window.history, m),
    );
    render(<Harness android={false} />);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    await screen.findByRole("menu");
    act(() => window.dispatchEvent(new PopStateEvent("popstate")));
    expect(state()).toBe("open");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(state()).toBe("closed"));
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("pushes one entry on Android and closes on Back, which pops it", async () => {
    render(<Harness android />);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    await screen.findByRole("menu");
    expect(window.history.state).toEqual({ ...before, olmPalette: true });
    act(() => window.history.back());
    await waitFor(() => expect(state()).toBe("closed"));
    await waitFor(() => expect(window.history.state).toEqual(before));
    await later(20);
    expect(window.history.state).toEqual(before);
  });

  it("takes its entry off when Escape closes it", async () => {
    render(<Harness android />);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    await screen.findByRole("menu");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(state()).toBe("closed"));
    await waitFor(() => expect(window.history.state).toEqual(before));
  });

  it("runs a chosen item only once its entry is off, so a route it pushes stays", async () => {
    let stateAtRun: unknown = "not run";
    onSelect.mockImplementation(() => {
      stateAtRun = window.history.state;
      window.history.pushState({ idx: 1, key: "more-route" }, "");
    });
    render(<Harness android />);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Settings" }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    expect(stateAtRun).toEqual(before);
    await later(20);
    expect(window.history.state).toEqual({ idx: 1, key: "more-route" });
  });

  it("takes its entry off when it unmounts while open", async () => {
    const { unmount } = render(<Harness android />);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    await screen.findByRole("menu");
    unmount();
    await waitFor(() => expect(window.history.state).toEqual(before));
  });
});
