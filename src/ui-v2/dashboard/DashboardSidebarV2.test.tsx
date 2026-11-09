import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/ui-v2/_legacy/components/dashboard/FloatingBugButton", () => ({
  default: () => (
    <div>
      <button type="button">Report bug</button>
      <textarea aria-label="Bug description" />
    </div>
  ),
}));

import { DashboardSidebarV2 } from "./DashboardSidebarV2";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
}));

function setup(overrides: Partial<React.ComponentProps<typeof DashboardSidebarV2>> = {}) {
  const props = {
    activeTab: "Home",
    onNavClick: vi.fn(),
    unreadMessagesCount: 0,
    managerName: "Boss",
    teamName: "Team",
    teamLogo: null,
    isUnemployed: false,
    onNavigateSettings: vi.fn(),
    onExitClick: vi.fn(),
    ...overrides,
  };
  const view = render(<DashboardSidebarV2 {...props} />);
  const rerender = (next: Partial<typeof props>) =>
    view.rerender(<DashboardSidebarV2 {...props} {...next} />);
  return { props, rerender };
}

const nav = () => screen.getByRole("navigation", { name: "Main navigation" });
const stop = (name: RegExp | string) => screen.getByRole("button", { name });

describe("DashboardSidebarV2 rail", () => {
  it("renders a labelled nav with direct stops and group launchers", () => {
    setup();
    expect(nav()).toBeInTheDocument();
    for (const name of ["Home", "Inbox", "News", "Social", "Schedule", "Club", "Market", "World"]) {
      expect(stop(new RegExp(`^${name}`))).toBeInTheDocument();
    }
  });

  it("does not steal focus on mount", () => {
    setup({ activeTab: "Squad" });
    expect(document.body).toHaveFocus();
  });

  it("makes exactly one stop tabbable, the one for the active tab", () => {
    setup({ activeTab: "Squad" });
    const tabbable = screen.getAllByRole("button").filter((b) => b.getAttribute("tabindex") === "0");
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveAccessibleName("Club");
  });

  it("keeps the first stop tabbable when no stop owns the tab", () => {
    setup({ activeTab: "Tournaments" });
    const tabbable = screen.getAllByRole("button").filter((b) => b.getAttribute("tabindex") === "0");
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveAccessibleName("Home");
  });

  it("marks the group launcher current for any tab inside the group", () => {
    setup({ activeTab: "Transfers" });
    expect(stop(/^Market/)).toHaveAttribute("aria-current", "page");
    expect(stop(/^Club/)).not.toHaveAttribute("aria-current");
  });

  it("follows external tab changes without moving focus", () => {
    const { rerender } = setup({ activeTab: "Home" });
    expect(stop(/^Home/)).toHaveAttribute("aria-current", "page");
    rerender({ activeTab: "Schedule" });
    expect(stop(/^Schedule/)).toHaveAttribute("aria-current", "page");
    expect(stop(/^Home/)).not.toHaveAttribute("aria-current");
    expect(stop(/^Schedule/)).toHaveAttribute("tabindex", "0");
    expect(document.body).toHaveFocus();
  });

  it("moves with arrows, focuses the target and activates it with Enter", () => {
    const { props } = setup({ activeTab: "Home" });
    stop(/^Home/).focus();
    fireEvent.keyDown(stop(/^Home/), { key: "ArrowDown" });
    expect(stop(/^Inbox/)).toHaveFocus();
    expect(stop(/^Inbox/)).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(stop(/^Inbox/), { key: "Enter" });
    expect(props.onNavClick).toHaveBeenCalledWith("Inbox");
  });

  it("Home and End jump to the first and last stop", () => {
    setup({ activeTab: "Home" });
    stop(/^Home/).focus();
    fireEvent.keyDown(stop(/^Home/), { key: "End" });
    expect(stop(/^Boss|Manager profile/)).toHaveFocus();
    fireEvent.keyDown(document.activeElement as Element, { key: "Home" });
    expect(stop(/^Home/)).toHaveFocus();
  });

  it("remembers the last visited tab of a group when its launcher is used", () => {
    const { props, rerender } = setup({ activeTab: "Squad" });
    rerender({ activeTab: "Finances" });
    rerender({ activeTab: "Home" });
    fireEvent.click(stop(/^Club/));
    expect(props.onNavClick).toHaveBeenLastCalledWith("Finances");
  });

  it("falls back to the group's first tab when never visited", () => {
    const { props } = setup({ activeTab: "Home" });
    fireEvent.click(stop(/^World/));
    expect(props.onNavClick).toHaveBeenLastCalledWith("Competitions");
    fireEvent.click(stop(/^Market/));
    expect(props.onNavClick).toHaveBeenLastCalledWith("Market");
  });

  it("hides the Club launcher when unemployed", () => {
    setup({ isUnemployed: true });
    expect(screen.queryByRole("button", { name: /^Club/ })).toBeNull();
    expect(stop(/^Market/)).toBeInTheDocument();
  });

  it("shows the inbox unread count in the stop name", () => {
    setup({ unreadMessagesCount: 4 });
    expect(stop(/^Inbox/)).toHaveAccessibleName("Inbox, 4");
  });

  it("wires the pinned settings, exit and manager buttons", () => {
    const { props } = setup();
    fireEvent.click(stop(/^Settings/));
    fireEvent.click(stop(/^Exit/));
    fireEvent.click(stop(/^Manager profile/));
    expect(props.onNavigateSettings).toHaveBeenCalledTimes(1);
    expect(props.onExitClick).toHaveBeenCalledTimes(1);
    expect(props.onNavClick).toHaveBeenCalledWith("Manager");
  });

  it("marks the manager avatar current on the Manager tab", () => {
    setup({ activeTab: "Manager" });
    expect(stop(/^Manager profile/)).toHaveAttribute("aria-current", "page");
    expect(stop(/^Manager profile/)).toHaveAttribute("tabindex", "0");
  });

  it("keeps stops scrollable while the pinned block is separate", () => {
    setup();
    const scroller = nav().querySelector('[data-slot="rail-stops"]') as HTMLElement;
    const pinned = nav().querySelector('[data-slot="rail-pinned"]') as HTMLElement;
    expect(scroller.className).toContain("overflow-y-auto");
    expect(scroller.contains(stop(/^Settings/))).toBe(false);
    expect(pinned.contains(stop(/^Settings/))).toBe(true);
  });

  it("leaves keys from the bug button and its dialog alone", () => {
    const { props } = setup({ activeTab: "Home" });
    const bug = screen.getByRole("button", { name: "Report bug" });
    expect(fireEvent.keyDown(bug, { key: "Enter" })).toBe(true);
    expect(props.onNavClick).not.toHaveBeenCalled();
    const field = screen.getByRole("textbox", { name: "Bug description" });
    expect(fireEvent.keyDown(field, { key: "m" })).toBe(true);
    expect(fireEvent.keyDown(field, { key: " " })).toBe(true);
    expect(stop(/^Home/)).toHaveAttribute("tabindex", "0");
  });

  it("does not pull focus back into the rail when callbacks change identity", () => {
    const { props, rerender } = setup({ activeTab: "Home" });
    stop(/^Home/).focus();
    fireEvent.keyDown(stop(/^Home/), { key: "ArrowDown" });
    expect(stop(/^Inbox/)).toHaveFocus();
    const outside = document.createElement("input");
    document.body.appendChild(outside);
    outside.focus();
    rerender({ onNavClick: vi.fn(), onNavigateSettings: vi.fn(), onExitClick: vi.fn() });
    expect(outside).toHaveFocus();
    // Enter still uses the latest callback.
    const latest = vi.fn();
    rerender({ onNavClick: latest });
    stop(/^Inbox/).focus();
    fireEvent.keyDown(stop(/^Inbox/), { key: "Enter" });
    expect(latest).toHaveBeenCalledWith("Inbox");
    expect(props.onNavClick).not.toHaveBeenCalled();
    outside.remove();
  });
});
