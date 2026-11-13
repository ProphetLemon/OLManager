import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ICON_TIP_HOVER_DELAY_MS,
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
    expect(tip()).toBeNull();
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
