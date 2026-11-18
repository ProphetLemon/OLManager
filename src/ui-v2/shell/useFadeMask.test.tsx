import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useFadeMask, type FadeAxis } from "./useFadeMask";

function Scroller({ axis }: { axis?: FadeAxis }) {
  const fade = useFadeMask<HTMLDivElement>("k", axis ? { axis } : undefined);
  const { ref, onScroll, style, ...data } = fade;
  return <div data-testid="scroller" ref={ref} onScroll={onScroll} style={style} {...data} />;
}

/** jsdom lays nothing out, so the scroll geometry is set by hand. */
function setGeometry(el: HTMLElement, geometry: Record<string, number>) {
  for (const [name, value] of Object.entries(geometry)) {
    Object.defineProperty(el, name, { configurable: true, value });
  }
}

describe("useFadeMask", () => {
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
