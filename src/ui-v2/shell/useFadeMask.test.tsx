import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useFadeMask, type FadeAxis } from "./useFadeMask";

function Scroller({ axis, children }: { axis?: FadeAxis; children?: ReactNode }) {
  const fade = useFadeMask<HTMLDivElement>("k", axis ? { axis } : undefined);
  const { ref, onScroll, style, ...data } = fade;
  return (
    <div data-testid="scroller" ref={ref} onScroll={onScroll} style={style} {...data}>
      {children}
    </div>
  );
}

/** jsdom lays nothing out, so the scroll geometry is set by hand. */
function setGeometry(el: HTMLElement, geometry: Record<string, number>) {
  for (const [name, value] of Object.entries(geometry)) {
    Object.defineProperty(el, name, { configurable: true, value });
  }
}

describe("useFadeMask", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("re-measures when a child changes size without the scroller resizing, as a pill's text does", () => {
    const observed: Element[] = [];
    let notify = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          notify = callback;
        }
        observe(el: Element) {
          observed.push(el);
        }
        unobserve() {}
        disconnect() {}
      },
    );
    render(
      <Scroller axis="x">
        <button type="button">first</button>
        <button type="button">second</button>
      </Scroller>,
    );
    const el = screen.getByTestId("scroller");
    expect(observed).toEqual(expect.arrayContaining([el, ...Array.from(el.children)]));

    setGeometry(el, { scrollWidth: 300, clientWidth: 100, scrollLeft: 0 });
    act(() => notify());
    expect(el.dataset.overflowEnd).toBe("true");
  });

  it("stops observing and listening when it unmounts", () => {
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect = disconnect;
      },
    );
    const removeListener = vi.spyOn(window, "removeEventListener");
    const view = render(<Scroller axis="x" />);
    view.unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledWith("resize", expect.any(Function));
    removeListener.mockRestore();
  });

  it("fades the bottom edge of a vertical list by default", () => {
    render(<Scroller />);
    const el = screen.getByTestId("scroller");
    setGeometry(el, { scrollHeight: 300, clientHeight: 100, scrollTop: 0 });
    fireEvent.scroll(el);
    // jsdom drops "to bottom", the default direction, when it parses the gradient.
    expect(el.style.maskImage).not.toContain("to right");
    expect(el.dataset.overflowBottom).toBe("true");
    expect(el.dataset.overflowTop).toBeUndefined();
  });

  it("fades the inline edges of a horizontal row while there is more past them (R47)", () => {
    render(<Scroller axis="x" />);
    const el = screen.getByTestId("scroller");

    setGeometry(el, { scrollWidth: 300, clientWidth: 100, scrollLeft: 0 });
    fireEvent.scroll(el);
    // jsdom rejects the calc() stops, so only the direction is read from the style.
    expect(el.style.maskImage).toContain("to right");
    expect(el.dataset.overflowEnd).toBe("true");
    expect(el.dataset.overflowStart).toBeUndefined();

    setGeometry(el, { scrollLeft: 200 });
    fireEvent.scroll(el);
    expect(el.dataset.overflowStart).toBe("true");
    expect(el.dataset.overflowEnd).toBeUndefined();
  });
});
