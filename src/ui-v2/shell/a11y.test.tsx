import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardHeaderV2 } from "@/ui-v2/dashboard/DashboardHeaderV2";
import { DashboardSidebarV2 } from "@/ui-v2/dashboard/DashboardSidebarV2";

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
        teamName="Night Owls"
        activeTab="Squad"
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

  it("has exactly one navigation landmark in the whole dashboard: the rail", () => {
    renderShell();
    const navs = screen.getAllByRole("navigation");
    expect(navs).toHaveLength(1);
    expect(navs[0]).toHaveAccessibleName("Main navigation");
    // The group's sections are a labelled group inside that nav, not a second landmark.
    expect(within(navs[0]).getByRole("group", { name: /Club/i })).toBeInTheDocument();
    // And no complementary landmark wraps the navigation.
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("labels every navigation landmark uniquely", () => {
    renderShell();
    const labels = screen.getAllByRole("navigation").map((n) => n.getAttribute("aria-label"));
    expect(labels.every(Boolean)).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("marks the current launcher and its panel tab, one per list, never by colour alone", () => {
    renderShell();
    const rail = screen.getByRole("navigation", { name: "Main navigation" });
    const panel = within(rail).getByRole("group", { name: /Club/i });
    const inPanel = panel.querySelectorAll('[aria-current="page"]');
    expect(inPanel).toHaveLength(1);
    expect(inPanel[0]).toHaveAccessibleName("Squad");
    const outside = [...rail.querySelectorAll('[aria-current="page"]')].filter((el) => !panel.contains(el));
    expect(outside).toHaveLength(1);
    expect(outside[0]).toHaveAccessibleName(/^Club/);
    expect(inPanel[0].querySelector('[data-slot="rail-item-bar"]')).not.toBeNull();
  });

  it("uses no positive tabindex and one tab stop per roving widget (the rail and its panel)", () => {
    const { container } = renderShell();
    expect(container.querySelector('[tabindex]:not([tabindex="0"]):not([tabindex="-1"])')).toBeNull();
    const rail = screen.getByRole("navigation", { name: "Main navigation" });
    // Two widgets, one Tab stop each (R15): the rail's current stop and the panel's current row.
    const stops = rail.querySelectorAll('button[tabindex="0"]');
    expect(stops).toHaveLength(2);
    const panel = within(rail).getByRole("group", { name: /Club/i });
    expect([...stops].filter((s) => panel.contains(s))).toHaveLength(1);
  });

  it("has no duplicate ids and no hidden focusable controls", () => {
    const { container } = renderShell();
    const ids = [...container.querySelectorAll("[id]")].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(container.querySelector('[aria-hidden="true"] button, [aria-hidden="true"] a[href]')).toBeNull();
  });
});

describe("compact (the end-of-season screen)", () => {
  it("renders one landmark, no panel and a rail that still navigates", () => {
    const onNavClick = vi.fn();
    render(
      <DashboardSidebarV2
        activeTab="Squad"
        onNavClick={onNavClick}
        unreadMessagesCount={0}
        managerName="Boss"
        teamName="Night Owls"
        teamLogo={null}
        isUnemployed={false}
        onNavigateSettings={vi.fn()}
        onExitClick={vi.fn()}
        compact
      />,
    );
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
    expect(screen.queryByRole("group", { name: /sections/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Inbox" }));
    expect(onNavClick).toHaveBeenCalledWith("Inbox");
  });
});
