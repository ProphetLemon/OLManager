import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ICON_TIP_HOVER_DELAY_MS,
  ICON_TIP_LEAVE_GRACE_MS,
  ICON_TIP_LONG_PRESS_MS,
  ICON_TIP_TOUCH_HIDE_MS,
  IconTip,
} from "./icon-tip";

const tip = () => screen.queryByRole("tooltip");
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

function setup(onParentClick = vi.fn()) {
  const { unmount } = render(
    <button type="button" onClick={onParentClick}>
      <IconTip label="Abyssal Mask" data-testid="icon">
        <i />
      </IconTip>
    </button>,
  );
  return { icon: screen.getByTestId("icon"), onParentClick, unmount };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("hover (mouse and pen)", () => {
  it("shows the label after the delay, not before", () => {
    const { icon } = setup();
    fireEvent.pointerEnter(icon, { pointerType: "mouse" });
    advance(ICON_TIP_HOVER_DELAY_MS - 1);
    expect(tip()).toBeNull();
    advance(1);
    expect(tip()).toHaveTextContent("Abyssal Mask");
  });

  it("hides when the pointer leaves, and never opens if it leaves first", () => {
    const { icon } = setup();
    fireEvent.pointerEnter(icon, { pointerType: "mouse" });
    fireEvent.pointerLeave(icon, { pointerType: "mouse" });
    advance(ICON_TIP_HOVER_DELAY_MS * 2);
    expect(tip()).toBeNull();

    fireEvent.pointerEnter(icon, { pointerType: "mouse" });
    advance(ICON_TIP_HOVER_DELAY_MS);
    expect(tip()).not.toBeNull();
    fireEvent.pointerLeave(icon, { pointerType: "mouse" });
    advance(ICON_TIP_LEAVE_GRACE_MS);
    expect(tip()).toBeNull();
  });

  it("stays open through a short grace after the pointer leaves the trigger (WCAG 1.4.13)", () => {
    const { icon } = setup();
    fireEvent.pointerEnter(icon, { pointerType: "mouse" });
    advance(ICON_TIP_HOVER_DELAY_MS);
    fireEvent.pointerLeave(icon, { pointerType: "mouse" });
    advance(ICON_TIP_LEAVE_GRACE_MS - 1);
    expect(tip()).not.toBeNull();
    advance(1);
    expect(tip()).toBeNull();
  });

  it("is hoverable: moving onto the tip keeps it open, leaving the tip closes it after the grace", () => {
    const { icon } = setup();
    fireEvent.pointerEnter(icon, { pointerType: "mouse" });
    advance(ICON_TIP_HOVER_DELAY_MS);
    fireEvent.pointerLeave(icon, { pointerType: "mouse" });
    fireEvent.pointerEnter(tip()!, { pointerType: "mouse" });
    advance(ICON_TIP_LEAVE_GRACE_MS * 3);
    expect(tip()).not.toBeNull();
    expect(tip()!.className).not.toContain("pointer-events-none");
    fireEvent.pointerLeave(tip()!, { pointerType: "mouse" });
    advance(ICON_TIP_LEAVE_GRACE_MS);
    expect(tip()).toBeNull();
  });

  it("coming back to the trigger within the grace cancels the close", () => {
    const { icon } = setup();
    fireEvent.pointerEnter(icon, { pointerType: "mouse" });
    advance(ICON_TIP_HOVER_DELAY_MS);
    fireEvent.pointerLeave(icon, { pointerType: "mouse" });
    advance(ICON_TIP_LEAVE_GRACE_MS - 10);
    fireEvent.pointerEnter(icon, { pointerType: "mouse" });
    advance(ICON_TIP_LEAVE_GRACE_MS * 3);
    expect(tip()).not.toBeNull();
  });

  it("is not a native title and is not focusable", () => {
    const { icon } = setup();
    expect(icon).not.toHaveAttribute("title");
    expect(icon).not.toHaveAttribute("tabindex");
  });

  it("closes on Escape", () => {
    const { icon } = setup();
    fireEvent.pointerEnter(icon, { pointerType: "mouse" });
    advance(ICON_TIP_HOVER_DELAY_MS);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(tip()).toBeNull();
  });
});

describe("touch long press", () => {
  it("does not open on the emulated hover of a touch", () => {
    const { icon } = setup();
    fireEvent.pointerEnter(icon, { pointerType: "touch" });
    advance(ICON_TIP_HOVER_DELAY_MS * 2);
    expect(tip()).toBeNull();
  });

  it("opens once the press has lasted long enough", () => {
    const { icon } = setup();
    fireEvent.pointerDown(icon, { pointerType: "touch" });
    advance(ICON_TIP_LONG_PRESS_MS - 1);
    expect(tip()).toBeNull();
    advance(1);
    expect(tip()).toHaveTextContent("Abyssal Mask");
  });

  it("swallows the click that ends a long press, so the parent does not act", () => {
    const { icon, onParentClick } = setup();
    fireEvent.pointerDown(icon, { pointerType: "touch" });
    advance(ICON_TIP_LONG_PRESS_MS);
    fireEvent.pointerUp(icon, { pointerType: "touch" });
    fireEvent.click(icon);
    expect(onParentClick).not.toHaveBeenCalled();
    // Only that one click: the next tap acts again.
    fireEvent.click(icon);
    expect(onParentClick).toHaveBeenCalledTimes(1);
  });

  it("swallows that click even when the finger slid off the icon and it lands on the parent", () => {
    const { icon, onParentClick } = setup();
    fireEvent.pointerDown(icon, { pointerType: "touch" });
    advance(ICON_TIP_LONG_PRESS_MS);
    fireEvent.click(screen.getByRole("button"));
    expect(onParentClick).not.toHaveBeenCalled();
  });

  it("leaves a plain tap alone: no tip, and the parent gets its click", () => {
    const { icon, onParentClick } = setup();
    fireEvent.pointerDown(icon, { pointerType: "touch" });
    advance(100);
    fireEvent.pointerUp(icon, { pointerType: "touch" });
    advance(ICON_TIP_LONG_PRESS_MS * 2);
    fireEvent.click(icon);
    expect(tip()).toBeNull();
    expect(onParentClick).toHaveBeenCalledTimes(1);
  });

  it("does not open when the touch is cancelled by a scroll gesture", () => {
    const { icon } = setup();
    fireEvent.pointerDown(icon, { pointerType: "touch" });
    fireEvent.pointerCancel(icon, { pointerType: "touch" });
    advance(ICON_TIP_LONG_PRESS_MS * 2);
    expect(tip()).toBeNull();
  });

  it("closes after a few seconds", () => {
    const { icon } = setup();
    fireEvent.pointerDown(icon, { pointerType: "touch" });
    advance(ICON_TIP_LONG_PRESS_MS);
    expect(tip()).not.toBeNull();
    advance(ICON_TIP_TOUCH_HIDE_MS);
    expect(tip()).toBeNull();
  });

  it("closes on the next press anywhere", () => {
    const { icon } = setup();
    fireEvent.pointerDown(icon, { pointerType: "touch" });
    advance(ICON_TIP_LONG_PRESS_MS);
    fireEvent.pointerDown(document.body, { pointerType: "touch" });
    expect(tip()).toBeNull();
  });

  it("closes on scroll", () => {
    const { icon } = setup();
    fireEvent.pointerDown(icon, { pointerType: "touch" });
    advance(ICON_TIP_LONG_PRESS_MS);
    fireEvent.scroll(window);
    expect(tip()).toBeNull();
  });

  it("closes on Escape", () => {
    const { icon } = setup();
    fireEvent.pointerDown(icon, { pointerType: "touch" });
    advance(ICON_TIP_LONG_PRESS_MS);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(tip()).toBeNull();
  });

  it("does not open the system context menu on a long press", () => {
    const { icon } = setup();
    expect(fireEvent.contextMenu(icon)).toBe(false);
  });
});

describe("cleanup", () => {
  it("leaves no plate, timer or listener behind when it unmounts", () => {
    const { icon, unmount } = setup();
    fireEvent.pointerDown(icon, { pointerType: "touch" });
    advance(ICON_TIP_LONG_PRESS_MS);
    expect(tip()).not.toBeNull();
    unmount();
    expect(tip()).toBeNull();
    // The hide timer is cleared; only the one-shot click swallow timer may remain.
    expect(vi.getTimerCount()).toBeLessThanOrEqual(1);
  });
});

describe("keyboard focus of the parent (followFocus)", () => {
  function focusSetup() {
    render(
      <button type="button">
        <IconTip label="Settings" followFocus data-testid="icon">
          <i />
        </IconTip>
      </button>,
    );
    return screen.getByRole("button");
  }

  it("shows the label as soon as the parent button takes focus, and hides it on blur", () => {
    const button = focusSetup();
    act(() => button.focus());
    expect(tip()).toHaveTextContent("Settings");
    act(() => button.blur());
    expect(tip()).toBeNull();
  });

  it("closes on Escape while the parent keeps focus", () => {
    const button = focusSetup();
    act(() => button.focus());
    expect(tip()).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(tip()).toBeNull();
    expect(button).toHaveFocus();
  });

  describe("with :focus-visible support", () => {
    // jsdom has no :focus-visible; stand in for a browser that decides it.
    let visible = true;
    beforeEach(() => {
      visible = true;
      vi.stubGlobal("CSS", { supports: () => true });
      const real = Element.prototype.matches;
      vi.spyOn(Element.prototype, "matches").mockImplementation(function (this: Element, selector: string) {
        return selector === ":focus-visible" ? visible : real.call(this, selector);
      });
    });
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it("opens when the browser calls the focus keyboard focus", () => {
      const button = focusSetup();
      act(() => button.focus());
      expect(tip()).toHaveTextContent("Settings");
    });

    it("opens nothing for a pointer press followed by focus, a tap included", () => {
      const button = focusSetup();
      visible = false;
      fireEvent.pointerDown(button, { pointerType: "touch" });
      fireEvent.pointerUp(button, { pointerType: "touch" });
      act(() => button.focus()); // the compat mousedown focus of a tap
      expect(tip()).toBeNull();
    });
  });

  it("closes on blur at once, without the hover grace", () => {
    const button = focusSetup();
    act(() => button.focus());
    act(() => button.blur());
    expect(tip()).toBeNull();
  });

  it("does nothing on focus without the prop", () => {
    const { icon } = setup();
    act(() => icon.parentElement!.focus());
    expect(tip()).toBeNull();
  });
});

describe("an icon inside a button (followFocus)", () => {
  function cell() {
    render(
      <button type="button">
        <IconTip label="Settings" followFocus data-testid="icon">
          <i />
        </IconTip>
      </button>,
    );
    return screen.getByRole("button");
  }
  const rect = (top: number, height: number) =>
    ({ top, height, bottom: top + height, left: 0, right: 40, width: 40, x: 0, y: top, toJSON() {} }) as DOMRect;

  it("opens when the pointer is anywhere over the button, not only over the 18 px icon", () => {
    const button = cell();
    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    advance(ICON_TIP_HOVER_DELAY_MS);
    expect(tip()).toHaveTextContent("Settings");
    fireEvent.pointerLeave(button, { pointerType: "mouse" });
    advance(ICON_TIP_LEAVE_GRACE_MS);
    expect(tip()).toBeNull();
  });

  it("keeps the tip hoverable when it is entered from the button", () => {
    const button = cell();
    fireEvent.pointerEnter(button, { pointerType: "mouse" });
    advance(ICON_TIP_HOVER_DELAY_MS);
    fireEvent.pointerLeave(button, { pointerType: "mouse" });
    fireEvent.pointerEnter(tip()!, { pointerType: "mouse" });
    advance(ICON_TIP_LEAVE_GRACE_MS * 3);
    expect(tip()).not.toBeNull();
  });

  it("sits above the button, not above the icon, so it never covers the focus ring (WCAG 2.4.11)", () => {
    const button = cell();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.matches('[role="tooltip"]')) return rect(0, 20);
      if (this.tagName === "BUTTON") return rect(100, 36); // the cell
      return rect(109, 18); // the icon, 9 px inside the cell
    });
    act(() => button.focus());
    // 100 (button top) - 20 (plate) - 6 (gap) = 74; anchored to the icon it would be 83 and reach into the ring.
    expect(tip()!.style.top).toBe("74px");
    vi.restoreAllMocks();
  });

  it("still sits above the icon for a tip that is not in a button", () => {
    const { icon } = setup();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.matches('[role="tooltip"]') ? rect(0, 20) : rect(109, 18);
    });
    fireEvent.pointerEnter(icon, { pointerType: "mouse" });
    advance(ICON_TIP_HOVER_DELAY_MS);
    expect(tip()!.style.top).toBe("83px");
    vi.restoreAllMocks();
  });
});
