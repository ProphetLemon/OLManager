import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSaveLoadFailure } from "./useSaveLoadFailure";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key} ${JSON.stringify(opts)}` : key),
  }),
}));

function setup(onRefresh = vi.fn().mockResolvedValue(undefined)) {
  const view = renderHook(() => useSaveLoadFailure(onRefresh));
  return { onRefresh, ...view };
}

describe("useSaveLoadFailure", () => {
  it("explains a save from another version with its format and refreshes the list", async () => {
    const { result, onRefresh } = setup();

    await act(() =>
      result.current.report("save_incompatible: the save was written with format 4; this version reads 3"),
    );

    expect(result.current.notice).toEqual({
      tone: "error",
      text: 'menu.saveStatus.otherVersionReason {"found":4}',
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("explains an unreadable save and refreshes the list", async () => {
    const { result, onRefresh } = setup();

    await act(() => result.current.report("save_unreadable: Failed to read version"));

    expect(result.current.notice).toEqual({ tone: "error", text: "menu.saveStatus.unreadableReason" });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("falls back to a generic message with the error for anything else", async () => {
    const { result } = setup();

    await act(() => result.current.report("Lock error: poisoned"));

    expect(result.current.notice).toEqual({
      tone: "error",
      text: 'menu.loadFailed {"error":"Lock error: poisoned"}',
    });
  });

  it("still shows the message when refreshing the list fails", async () => {
    const { result } = setup(vi.fn().mockRejectedValue(new Error("offline")));

    await act(() => result.current.report("save_unreadable: x"));

    expect(result.current.notice?.text).toBe("menu.saveStatus.unreadableReason");
  });

  it("clears the message", async () => {
    const { result } = setup();
    await act(() => result.current.report("save_unreadable: x"));

    act(() => result.current.clear());

    expect(result.current.notice).toBeNull();
  });
});
