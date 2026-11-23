import { render, screen } from "@testing-library/react";
import { Mail } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { ACTIVE_ROW_CLASS, BADGE_CAP, RailActiveBar, badgeText, withBadge } from "./railActive";
import { RailItem } from "./RailItem";
import { RailRow } from "./RailRow";

describe("the shared active-row style", () => {
  it("tints with a token, not an inline colour-mix", () => {
    expect(ACTIVE_ROW_CLASS).toContain("bg-[var(--row-wash)]");
    expect(ACTIVE_ROW_CLASS).not.toContain("color-mix");
    expect(ACTIVE_ROW_CLASS).toContain("[[data-contrast=high]_&]:data-[active=true]:outline-club-text");
  });

  it("is what both RailItem and RailRow wear when active", () => {
    render(
      <>
        <RailItem icon={Mail} label="Inbox" active onClick={vi.fn()} />
        <RailRow kind="child" navId="tab:Squad" label="Squad" active onClick={vi.fn()} />
      </>,
    );
    for (const name of ["Inbox", "Squad"]) {
      const button = screen.getByRole("button", { name });
      for (const cls of ACTIVE_ROW_CLASS.split(" ")) expect(button.className, `${name} ${cls}`).toContain(cls);
      expect(button.querySelector('[data-slot="rail-item-bar"]')).not.toBeNull();
    }
  });

  it("draws the bar in two sizes from one component", () => {
    const { container } = render(
      <>
        <RailActiveBar size="stop" />
        <RailActiveBar size="row" />
      </>,
    );
    const bars = container.querySelectorAll('[data-slot="rail-item-bar"]');
    expect(bars).toHaveLength(2);
    expect(bars[0].className).toContain("h-8");
    expect(bars[1].className).toContain("h-4");
    for (const bar of bars) expect(bar.className).toContain("bg-club-text");
  });

  it("keeps the bar in forced colours, where backgrounds are dropped (R97)", () => {
    const { container } = render(
      <>
        <RailActiveBar size="stop" />
        <RailActiveBar size="row" />
      </>,
    );
    for (const bar of container.querySelectorAll('[data-slot="rail-item-bar"]')) {
      expect(bar.className).toContain("forced-color-adjust-none");
      expect(bar.className).toContain("forced-colors:bg-[Highlight]");
    }
  });

  it("caps a badge at 99+ in one place", () => {
    expect(BADGE_CAP).toBe(99);
    expect(badgeText(7)).toBe("7");
    expect(badgeText(250)).toBe("99+");
    expect(withBadge("Inbox", 250)).toBe("Inbox (99+)");
    expect(withBadge("Inbox", 0)).toBe("Inbox");
  });
});
