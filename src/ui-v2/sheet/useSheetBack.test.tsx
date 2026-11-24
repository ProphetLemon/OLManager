import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dismissOverlayWithBack, resetNativeBackOverlaysForTests, setNativeBackRegistered } from "@/ui-v2/palette/paletteHistory";

import { useSheetBack, type UseSheetBackOptions } from "./useSheetBack";

const onBack = vi.fn();

function Probe(props: Omit<UseSheetBackOptions, "onBack">) {
  useSheetBack({ ...props, onBack });
  return null;
}

const later = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));
const popstate = () => act(() => window.dispatchEvent(new PopStateEvent("popstate")));

describe("useSheetBack", () => {
  let mark = 0;
  let before: Record<string, unknown>;
  beforeEach(() => {
    before = { idx: 0, key: `sheet-${++mark}` };
    window.history.replaceState(before, "");
    onBack.mockReset();
    resetNativeBackOverlaysForTests();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetNativeBackOverlaysForTests();
  });

  it("makes no history call and ignores a pop on desktop, open or closed", async () => {
    const spies = (["pushState", "replaceState", "back", "go", "forward"] as const).map((m) =>
      vi.spyOn(window.history, m),
    );
    const { rerender, unmount } = render(<Probe open android={false} />);
    popstate();
    rerender(<Probe open={false} android={false} />);
    unmount();
    expect(onBack).not.toHaveBeenCalled();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("closes on a pop on desktop only when the caller asks for it", () => {
    render(<Probe open android={false} listenWithoutEntry />);
    popstate();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("pushes one entry when it opens on Android and calls onBack when Back pops it", async () => {
    const push = vi.spyOn(window.history, "pushState");
    render(<Probe open android />);
    expect(push).toHaveBeenCalledTimes(1);
    expect(window.history.state).toEqual({ ...before, olmPalette: true });
    act(() => window.history.back());
    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1));
    await later(20);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(window.history.state).toEqual(before);
  });

  it("takes its entry off, without calling onBack, when it closes by another path", async () => {
    const { rerender } = render(<Probe open android />);
    rerender(<Probe open={false} android />);
    await waitFor(() => expect(window.history.state).toEqual(before));
    await later(20);
    expect(onBack).not.toHaveBeenCalled();
  });

  it("does not close a reopened sheet on the late pop of the entry a close took off", async () => {
    const { rerender } = render(<Probe open android />);
    rerender(<Probe open={false} android />); // history.back() is on its way
    rerender(<Probe open android />); // reopened before that pop arrived
    await later(50);
    expect(onBack).not.toHaveBeenCalled();
    // The reopened sheet still closes on a Back of its own.
    await waitFor(() => expect(window.history.state).toEqual({ ...before, olmPalette: true }));
    act(() => window.history.back());
    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1));
  });

  it("takes its entry off when it unmounts while open", async () => {
    const { unmount } = render(<Probe open android />);
    expect(window.history.state).toEqual({ ...before, olmPalette: true });
    unmount();
    await waitFor(() => expect(window.history.state).toEqual(before));
    expect(onBack).not.toHaveBeenCalled();
  });

  it("holds no entry while the native back listener is registered: Back reaches onBack through the dismisser", () => {
    setNativeBackRegistered(true);
    const push = vi.spyOn(window.history, "pushState");
    const back = vi.spyOn(window.history, "back");
    const { rerender } = render(<Probe open android />);
    expect(push).not.toHaveBeenCalled();
    expect(dismissOverlayWithBack()).toBe(true);
    expect(onBack).toHaveBeenCalledTimes(1);
    rerender(<Probe open={false} android />);
    expect(back).not.toHaveBeenCalled();
    expect(dismissOverlayWithBack()).toBe(false);
  });

  it("registers no dismisser on desktop or while closed", () => {
    setNativeBackRegistered(true);
    const { rerender } = render(<Probe open android={false} />);
    expect(dismissOverlayWithBack()).toBe(false);
    rerender(<Probe open={false} android />);
    expect(dismissOverlayWithBack()).toBe(false);
  });

  describe("two sheets on the entry path", () => {
    // Each sheet is its own mount of the hook; the history entry is one shared slot.
    // Unmounting takes the entry off with history.back(): let that settle before the next test.
    afterEach(async () => {
      cleanup();
      await later(50);
    });
    function Pair({ a, b, showB = true }: { a: boolean; b: boolean; showB?: boolean }) {
      return (
        <>
          <Probe open={a} android />
          {showB && <Probe open={b} android />}
        </>
      );
    }

    it("a sheet that mounts closed leaves the entry another open sheet holds", async () => {
      const back = vi.spyOn(window.history, "back");
      render(<Pair a b={false} />);
      await later(20);
      expect(back).not.toHaveBeenCalled();
      expect(window.history.state).toEqual({ ...before, olmPalette: true });
    });

    it("a sheet that opened on another's entry does not take it off when it closes", async () => {
      const back = vi.spyOn(window.history, "back");
      const { rerender } = render(<Pair a b={false} />);
      rerender(<Pair a b />);
      rerender(<Pair a b={false} />);
      await later(20);
      expect(back).not.toHaveBeenCalled();
      expect(window.history.state).toEqual({ ...before, olmPalette: true });
    });

    it("a closed sheet that unmounts leaves the entry of an open one", async () => {
      const back = vi.spyOn(window.history, "back");
      const view = render(<Pair a b={false} />);
      view.rerender(<Pair a b={false} showB={false} />);
      await later(20);
      expect(back).not.toHaveBeenCalled();
      expect(window.history.state).toEqual({ ...before, olmPalette: true });
    });

    it("the sheet that pushed the entry still takes it off when it closes", async () => {
      const { rerender } = render(<Pair a b={false} />);
      rerender(<Pair a={false} b={false} />);
      await waitFor(() => expect(window.history.state).toEqual(before));
    });
  });

  it("calls the latest onBack, not the one from the opening", () => {
    setNativeBackRegistered(true);
    const first = vi.fn();
    const second = vi.fn();
    function Swap({ cb }: { cb: () => void }) {
      useSheetBack({ open: true, android: true, onBack: cb });
      return null;
    }
    const { rerender } = render(<Swap cb={first} />);
    rerender(<Swap cb={second} />);
    dismissOverlayWithBack();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
