import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/ui-v2/_legacy/components/dashboard/ReportBugModal", () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="Bug report">
      <button type="button" onClick={onClose}>Close bug report</button>
    </div>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? _k,
  }),
}));

import { PhoneMoreMenu } from "./PhoneMoreMenu";

const handlers = () => ({ onNavClick: vi.fn(), onNavigateSettings: vi.fn(), onExitClick: vi.fn() });
const trigger = () => screen.getByRole("button", { name: "More" });

describe("PhoneMoreMenu", () => {
  beforeEach(() => window.history.replaceState({ idx: 0, key: "pmm" }, ""));
  afterEach(() => vi.restoreAllMocks());

  it("is one 'More' button that opens the six destinations the rail has no room for", async () => {
    render(<PhoneMoreMenu activeTab="Squad" {...handlers()} />);
    expect(trigger()).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger());
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual([
      "News", "Social", "Settings", "Report bug", "Exit", "Manager profile",
    ]);
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
  });

  it("runs the chosen item and closes", async () => {
    const h = handlers();
    render(<PhoneMoreMenu activeTab="Squad" {...h} />);
    fireEvent.click(trigger());
    fireEvent.click(await screen.findByRole("menuitem", { name: "Settings" }));
    await waitFor(() => expect(h.onNavigateSettings).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("opens the bug report from its own item", async () => {
    render(<PhoneMoreMenu activeTab="Squad" {...handlers()} />);
    fireEvent.click(trigger());
    fireEvent.click(await screen.findByRole("menuitem", { name: "Report bug" }));
    expect(await screen.findByRole("dialog", { name: "Bug report" })).toBeInTheDocument();
  });

  it("returns focus to the trigger when Escape closes it", async () => {
    render(<PhoneMoreMenu activeTab="Squad" {...handlers()} />);
    act(() => trigger().focus());
    fireEvent.click(trigger());
    fireEvent.keyDown(await screen.findByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await waitFor(() => expect(trigger()).toHaveFocus());
  });

  it("marks the trigger as the current page while News, Social or Manager is open, and only then", () => {
    const { rerender } = render(<PhoneMoreMenu activeTab="News" {...handlers()} />);
    expect(trigger()).toHaveAttribute("aria-current", "page");
    rerender(<PhoneMoreMenu activeTab="Manager" {...handlers()} />);
    expect(trigger()).toHaveAttribute("aria-current", "page");
    rerender(<PhoneMoreMenu activeTab="Squad" {...handlers()} />);
    expect(trigger()).not.toHaveAttribute("aria-current");
  });
});
