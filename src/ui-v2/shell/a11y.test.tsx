import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardHeaderV2 } from "@/ui-v2/dashboard/DashboardHeaderV2";
import { DashboardSidebarV2 } from "@/ui-v2/dashboard/DashboardSidebarV2";
import { SectionStripV2 } from "@/ui-v2/shell/SectionStripV2";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (_k: string, o?: { defaultValue?: string; count?: number; group?: string }) =>
      (o?.defaultValue ?? _k).replace("{{count}}", String(o?.count ?? "")).replace("{{group}}", o?.group ?? ""),
  }),
}));

vi.mock("@/ui-v2/_legacy/components/dashboard/FloatingBugButton", () => ({
  default: () => (
    <button type="button" aria-label="Report bug">
      <svg aria-hidden="true" />
    </button>
  ),
}));

const BADGES = { unread: 2, offers: 1, players: 20, teams: 12, staff: 5 };

function renderShell() {
  return render(
    <div>
      <DashboardSidebarV2
        activeTab="Squad"
        onNavClick={vi.fn()}
        unreadMessagesCount={2}
        pendingOffersCount={1}
        managerName="Boss"
        teamName="Night Owls"
        teamLogo={null}
        isUnemployed={false}
        onNavigateSettings={vi.fn()}
        onExitClick={vi.fn()}
      />
      <DashboardHeaderV2
        activeTabLabel="Squad"
        currentDate="12 Jan"
        hasProfileHistory={false}
        isAdvancing={false}
        isSaving={false}
        saveFlash={false}
        hasMatchToday={false}
        dayPhase="Morning"
        alerts={[]}
        onBack={vi.fn()}
        onSave={vi.fn()}
        onContinue={vi.fn()}
        onSkipToMatchDay={vi.fn()}
        onSkipToNextDay={vi.fn()}
        onNavigate={vi.fn()}
        teamName="Night Owls"
        activeTab="Squad"
        onNavClick={vi.fn()}
        badges={BADGES}
        callCount={2}
        onShowCalls={vi.fn()}
      />
    </div>,
  );
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  document.documentElement.removeAttribute("data-contrast");
});

describe.each(["off", "high"])("shell accessibility, contrast %s", (mode) => {
  beforeEach(() => {
    if (mode === "high") document.documentElement.setAttribute("data-contrast", "high");
  });

  it("gives every control an accessible name", () => {
    const { container } = renderShell();
    const controls = container.querySelectorAll("button, a[href], [role=tab], input, select");
    expect(controls.length).toBeGreaterThan(10);
    for (const el of controls) {
      const name = el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "";
      expect(name, el.outerHTML).not.toBe("");
    }
  });

  it("labels every navigation landmark uniquely", () => {
    renderShell();
    const labels = screen.getAllByRole("navigation").map((n) => n.getAttribute("aria-label"));
    expect(labels.every(Boolean)).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("marks one current rail stop and one current strip tab, never by colour alone", () => {
    renderShell();
    const rail = screen.getByRole("navigation", { name: "Main navigation" });
    const current = rail.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName(/^Club/);
    const strip = screen.getByRole("navigation", { name: /Club/i, hidden: false });
    expect(strip).not.toBe(rail);
    const active = within(strip).getAllByRole("button").filter((b) => b.hasAttribute("aria-current"));
    expect(active).toHaveLength(1);
  });

  it("uses no positive tabindex and one tab stop per roving widget", () => {
    const { container } = renderShell();
    expect(container.querySelector('[tabindex]:not([tabindex="0"]):not([tabindex="-1"])')).toBeNull();
    const rail = screen.getByRole("navigation", { name: "Main navigation" });
    const stops = rail.querySelectorAll('[data-slot="rail-stops"] button[tabindex="0"], [data-slot="rail-pinned"] button[tabindex="0"]');
    expect(stops).toHaveLength(1);
  });

  it("has no duplicate ids and no hidden focusable controls", () => {
    const { container } = renderShell();
    const ids = [...container.querySelectorAll("[id]")].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(container.querySelector('[aria-hidden="true"] button, [aria-hidden="true"] a[href]')).toBeNull();
  });
});

describe("section strip keyboard", () => {
  it("moves with arrows without wrapping and opens with Enter", () => {
    const onNavClick = vi.fn();
    render(<SectionStripV2 group="club" activeTab="Squad" onNavClick={onNavClick} badges={BADGES} label="Club" />);
    const tabs = screen.getAllByRole("button");
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: "ArrowLeft" });
    expect(tabs.filter((t) => t.getAttribute("tabindex") === "0")).toHaveLength(1);
    fireEvent.keyDown(document.activeElement as Element, { key: "End" });
    const last = document.activeElement as HTMLElement;
    fireEvent.keyDown(last, { key: "ArrowRight" });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: "Enter" });
    expect(onNavClick).toHaveBeenCalledTimes(1);
  });
});
