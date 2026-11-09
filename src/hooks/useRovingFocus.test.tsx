import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRovingFocus } from "./useRovingFocus";

const labels = ["Alpha", "Bravo", "Charlie", "Delta"];

function key(k: string) {
  return { key: k, preventDefault: vi.fn() } as unknown as React.KeyboardEvent;
}

function setup(opts: Partial<Parameters<typeof useRovingFocus>[0]> = {}) {
  return renderHook((p: Partial<Parameters<typeof useRovingFocus>[0]>) =>
    useRovingFocus({ itemCount: 4, getItemLabel: (i) => labels[i], ...opts, ...p }),
  );
}

afterEach(() => vi.useRealTimers());

describe("useRovingFocus", () => {
  it("moves with arrows, Home and End, looping by default", () => {
    const { result } = setup();
    act(() => result.current.handleKeyDown(key("ArrowDown")));
    expect(result.current.activeIndex).toBe(1);
    act(() => result.current.handleKeyDown(key("End")));
    expect(result.current.activeIndex).toBe(3);
    act(() => result.current.handleKeyDown(key("ArrowRight")));
    expect(result.current.activeIndex).toBe(0);
    act(() => result.current.handleKeyDown(key("ArrowUp")));
    expect(result.current.activeIndex).toBe(3);
    act(() => result.current.handleKeyDown(key("Home")));
    expect(result.current.activeIndex).toBe(0);
    expect(result.current.getTabIndex(0)).toBe(0);
    expect(result.current.getTabIndex(1)).toBe(-1);
  });

  it("clamps and calls edge callbacks when loop is off", () => {
    const onEdgeUp = vi.fn();
    const onEdgeDown = vi.fn();
    const { result } = setup({ loop: false, onEdgeUp, onEdgeDown });
    act(() => result.current.handleKeyDown(key("ArrowUp")));
    expect(onEdgeUp).toHaveBeenCalledTimes(1);
    expect(result.current.activeIndex).toBe(0);
    act(() => result.current.handleKeyDown(key("End")));
    act(() => result.current.handleKeyDown(key("ArrowDown")));
    expect(onEdgeDown).toHaveBeenCalledTimes(1);
    expect(result.current.activeIndex).toBe(3);
  });

  it("moves by columns vertically", () => {
    const { result } = setup({ columns: 2 });
    act(() => result.current.handleKeyDown(key("ArrowDown")));
    expect(result.current.activeIndex).toBe(2);
  });

  it("ignores Up/Down when horizontal", () => {
    const { result } = setup({ orientation: "horizontal" });
    const down = key("ArrowDown");
    act(() => result.current.handleKeyDown(down));
    expect(result.current.activeIndex).toBe(0);
    expect(down.preventDefault).not.toHaveBeenCalled();
    act(() => result.current.handleKeyDown(key("ArrowRight")));
    expect(result.current.activeIndex).toBe(1);
    act(() => result.current.handleKeyDown(key("ArrowLeft")));
    expect(result.current.activeIndex).toBe(0);
  });

  it("selects with Enter and Space", () => {
    const onSelect = vi.fn();
    const { result } = setup({ onSelect, initialIndex: 2 });
    act(() => result.current.handleKeyDown(key("Enter")));
    act(() => result.current.handleKeyDown(key(" ")));
    expect(onSelect).toHaveBeenNthCalledWith(1, 2);
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it("jumps to the next label starting with the typed letter", () => {
    vi.useFakeTimers();
    const { result } = setup();
    act(() => result.current.handleKeyDown(key("d")));
    expect(result.current.activeIndex).toBe(3);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    act(() => result.current.handleKeyDown(key("b")));
    expect(result.current.activeIndex).toBe(1);
  });

  it("follows a controlled index and still moves locally", () => {
    const { result, rerender } = setup({ index: 1 });
    expect(result.current.activeIndex).toBe(1);
    rerender({ index: 3 });
    expect(result.current.activeIndex).toBe(3);
    act(() => result.current.handleKeyDown(key("ArrowLeft")));
    expect(result.current.activeIndex).toBe(2);
    rerender({ index: 3 });
    expect(result.current.activeIndex).toBe(2);
  });

  it("does not request focus on mount when focusOnMount is false", () => {
    const quiet = setup({ focusOnMount: false });
    expect(quiet.result.current.shouldFocus).toBe(false);
    act(() => quiet.result.current.handleKeyDown(key("ArrowDown")));
    expect(quiet.result.current.shouldFocus).toBe(true);
    expect(setup().result.current.shouldFocus).toBe(true);
  });

  it("does not move DOM focus on its own when mounted by a consumer", () => {
    function List() {
      const { activeIndex, shouldFocus, getTabIndex, handleKeyDown } = useRovingFocus({
        itemCount: 2,
        focusOnMount: false,
      });
      return (
        <div onKeyDown={handleKeyDown}>
          {[0, 1].map((i) => (
            <button
              key={i}
              tabIndex={getTabIndex(i)}
              ref={(el) => {
                if (el && shouldFocus && i === activeIndex) el.focus();
              }}
            >
              item {i}
            </button>
          ))}
        </div>
      );
    }
    render(<List />);
    expect(document.body).toHaveFocus();
    screen.getByText("item 0").focus();
    fireEvent.keyDown(screen.getByText("item 0"), { key: "ArrowDown" });
    expect(screen.getByText("item 1")).toHaveFocus();
  });
});
