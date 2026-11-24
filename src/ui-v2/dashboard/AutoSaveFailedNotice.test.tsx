import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AutoSaveFailedNotice } from "./AutoSaveFailedNotice";

const SENTENCE = "Auto-save failed. Press Save to keep your progress.";

describe("AutoSaveFailedNotice", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows nothing while the saves work", () => {
    render(<AutoSaveFailedNotice failed={false} failCount={0} />);
    expect(screen.queryByText(SENTENCE)).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("shows the sentence as visible text, and speaks it, while the last save failed", () => {
    const { container } = render(<AutoSaveFailedNotice failed failCount={1} />);
    act(() => void vi.advanceTimersByTime(200));
    expect(container.querySelector("[data-slot=auto-save-failed-notice]")).toHaveTextContent(SENTENCE);
    expect(screen.getByRole("status")).toHaveTextContent(SENTENCE);
  });

  it("clears the spoken text and sets it again on a repeated failure, so it is announced again", () => {
    const { rerender } = render(<AutoSaveFailedNotice failed failCount={1} />);
    act(() => void vi.advanceTimersByTime(200));
    rerender(<AutoSaveFailedNotice failed failCount={2} />);
    expect(screen.getByRole("status")).toHaveTextContent("");
    act(() => void vi.advanceTimersByTime(200));
    expect(screen.getByRole("status")).toHaveTextContent(SENTENCE);
  });

  it("goes away when a save succeeds", () => {
    const { rerender } = render(<AutoSaveFailedNotice failed failCount={1} />);
    rerender(<AutoSaveFailedNotice failed={false} failCount={1} />);
    act(() => void vi.advanceTimersByTime(200));
    expect(screen.queryByText(SENTENCE)).toBeNull();
  });
});
