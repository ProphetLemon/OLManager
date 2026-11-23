import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useResetOnChange } from "./useResetOnChange";

describe("useResetOnChange", () => {
  it("does not reset on mount, so a restored page survives", () => {
    const reset = vi.fn();
    renderHook(() => useResetOnChange(["mid", null], reset));
    expect(reset).not.toHaveBeenCalled();
  });

  it("resets once when a dependency changes, and not on a plain re-render", () => {
    const reset = vi.fn();
    const { rerender } = renderHook(({ q }) => useResetOnChange([q], reset), {
      initialProps: { q: "a" },
    });
    rerender({ q: "a" });
    expect(reset).not.toHaveBeenCalled();
    rerender({ q: "ab" });
    expect(reset).toHaveBeenCalledTimes(1);
    rerender({ q: "ab" });
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
