import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SectionStripV2 } from "@/ui-v2/shell/SectionStripV2";
import type { ShellBadges } from "@/ui-v2/shell/shellTypes";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_k: string, o?: { defaultValue?: string; group?: string }) =>
      (o?.defaultValue ?? _k).replace("{{group}}", o?.group ?? ""),
  }),
}));

const badges: ShellBadges = { unread: 0, offers: 3, players: 0, teams: 0, staff: 0 };
const scrollIntoView = vi.fn();

beforeEach(() => {
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
});

function setup(activeTab = "Market") {
  const onNavClick = vi.fn();
  render(
    <SectionStripV2 group="market" activeTab={activeTab} onNavClick={onNavClick} badges={badges} label="Market" />,
  );
  return { onNavClick };
}

describe("SectionStripV2", () => {
  it("labels the navigation with the group name", () => {
    setup();
    expect(screen.getByRole("navigation", { name: "Market sections" })).toBeInTheDocument();
  });

  it("shows the group as a muted, non-focusable label before the tabs", () => {
    setup();
    const group = document.querySelector('[data-slot="section-strip-group"]') as HTMLElement;
    expect(group).toHaveTextContent("Market");
    expect(group.tagName).toBe("SPAN");
    expect(group).not.toHaveAttribute("tabindex");
    expect(screen.getAllByRole("button").every((b) => !group.contains(b))).toBe(true);
    expect(group.nextElementSibling?.tagName).toBe("BUTTON");
  });

  it("underlines the active tab in the club colour and adds an outline in high contrast", () => {
    setup("Transfers");
    const active = screen.getByRole("button", { name: /Transfers/ });
    expect(active.className).toContain("border-club");
    expect(active.className).toContain("font-bold");
    expect(active.className).toContain("[[data-contrast=high]_&]:outline-2");
    expect(screen.getByRole("button", { name: /Market/ }).className).not.toContain("border-club");
  });

  it("draws a solid outline (not just a width) on the active tab in high contrast", () => {
    setup("Transfers");
    const active = screen.getByRole("button", { name: /Transfers/ });
    expect(active.className).toContain("[[data-contrast=high]_&]:outline-solid");
    expect(active.className).toContain("[[data-contrast=high]_&]:outline-2");
    expect(screen.getByRole("button", { name: /Market/ }).className).not.toContain("outline-solid");
  });

  it("shows the group label at full strength in high contrast", () => {
    setup("Transfers");
    const group = document.querySelector('[data-slot="section-strip-group"]');
    expect(group?.className).toContain("[[data-contrast=high]_&]:text-foreground");
  });

  it("marks only the active tab with aria-current", () => {
    setup("Transfers");
    expect(screen.getByRole("button", { name: /Transfers/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: /Market/ })).not.toHaveAttribute("aria-current");
  });

  it("shows the badge count of the tab that owns it", () => {
    setup();
    expect(screen.getByRole("button", { name: /Transfers/ })).toHaveTextContent("3");
    expect(screen.getByRole("button", { name: /Market/ })).not.toHaveTextContent("3");
  });

  it("keeps a single tab stop on the active tab", () => {
    setup("Transfers");
    expect(screen.getByRole("button", { name: /Transfers/ })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("button", { name: /Market/ })).toHaveAttribute("tabindex", "-1");
  });

  it("moves focus with Left/Right/Home/End and opens with Enter", () => {
    const { onNavClick } = setup("Market");
    const market = screen.getByRole("button", { name: /Market/ });
    const transfers = screen.getByRole("button", { name: /Transfers/ });
    market.focus();
    fireEvent.keyDown(market, { key: "ArrowRight" });
    expect(transfers).toHaveFocus();
    expect(onNavClick).not.toHaveBeenCalled();
    fireEvent.keyDown(transfers, { key: "Enter" });
    expect(onNavClick).toHaveBeenCalledWith("Transfers");
    fireEvent.keyDown(transfers, { key: "Home" });
    expect(market).toHaveFocus();
    fireEvent.keyDown(market, { key: "End" });
    expect(transfers).toHaveFocus();
  });

  it("scrolls the focused tab into view", () => {
    setup("Market");
    scrollIntoView.mockClear();
    fireEvent.focus(screen.getByRole("button", { name: /Transfers/ }));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
  });

  it("navigates on click", () => {
    const { onNavClick } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Transfers/ }));
    expect(onNavClick).toHaveBeenCalledWith("Transfers");
  });
});
