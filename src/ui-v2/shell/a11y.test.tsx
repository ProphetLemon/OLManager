import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { TFunction } from "i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardHeaderV2 } from "@/ui-v2/dashboard/DashboardHeaderV2";
import { DashboardSidebarV2 } from "@/ui-v2/dashboard/DashboardSidebarV2";
import { AttentionLaneV2 } from "@/ui-v2/dashboard/AttentionLaneV2";
import type { LanePill } from "@/lib/dashboard/attentionLane";
import { usePaletteStore } from "@/store/paletteStore";
import { translateFromEnglish } from "@/test-i18n";
import { GoPalette } from "@/ui-v2/palette/GoPalette";
import { buildPaletteIndex, type PaletteIndexInput } from "@/ui-v2/palette/paletteIndex";

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

/** Two decisions in the lane, then its pinned "All 2 on Home". */
const LANE_PILLS: LanePill[] = [
  {
    kind: "call",
    id: "blocker:incomplete_lineup",
    item: {
      id: "blocker:incomplete_lineup",
      kind: "blocker",
      severity: "hard",
      tagKey: "onAir.tags.blocker",
      tagTone: "negative",
      headline: "Starting five is incomplete",
      actionLabelKey: "onAir.calls.actions.fixLineup",
      target: { tab: "Squad" },
    },
  },
  {
    kind: "call",
    id: "contract:p1",
    item: {
      id: "contract:p1",
      kind: "contract",
      severity: "soft",
      tagKey: "onAir.tags.contract",
      tagTone: "warning",
      headline: "Faker's contract ends in 20 days",
      actionLabelKey: "onAir.calls.actions.renew",
      target: { tab: "Squad", context: { playerId: "p1" } },
    },
  },
  { kind: "home", id: "lane:home", count: 2 },
];

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
        title="Squad"
        currentDate="12 Jan"
        backTo={null}
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
      <AttentionLaneV2 pills={LANE_PILLS} platform="desktop" onNavigate={vi.fn()} onShowAll={vi.fn()} />
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

  it("adds the lane as one named region and one Tab stop, with no live region of its own (R24, R47)", () => {
    renderShell();
    const region = screen.getByRole("region", { name: "Before you continue" });
    // Spoken once: the toolbar inside takes no name of its own.
    expect(within(region).getByRole("toolbar")).not.toHaveAttribute("aria-labelledby");
    expect(region.querySelectorAll('button[tabindex="0"]')).toHaveLength(1);
    expect(region.querySelectorAll("button")).toHaveLength(3);
    expect(region.querySelector('[aria-live], [role="status"], [role="alert"]')).toBeNull();
    // It is not a second navigation landmark.
    expect(region.closest("nav")).toBeNull();
    for (const pill of region.querySelectorAll("button")) expect(pill).toHaveAccessibleName();
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

describe.each(["off", "high"])("the Go palette, open, contrast %s (NR2.8, R25, R44, R45, R48)", (mode) => {
  const home = { tab: "Home", playerId: null, teamId: null, staffId: null, championKey: null };
  const entries = buildPaletteIndex({
    callState: { decisionItems: LANE_PILLS.flatMap((p) => (p.kind === "call" ? [p.item] : [])) },
    recent: [{ ...home, tab: "Inbox" }],
    current: home,
    unemployed: false,
    scheduleCalendar: true,
    selectedCompetitionId: null,
    game: {
      manager: { team_id: "team-1" },
      user_competition_id: null,
      leagues: [],
      players: [],
      teams: [{ id: "team-1", name: "Night Owls" }],
      staff: [],
    } as unknown as PaletteIndexInput["game"],
    t: translateFromEnglish as unknown as TFunction,
  });

  beforeEach(() => {
    if (mode === "high") document.documentElement.setAttribute("data-contrast", "high");
    usePaletteStore.getState().reset();
  });

  async function renderOpen() {
    const view = renderShell();
    render(<GoPalette entries={entries} callCount={2} platform="desktop" onActivate={vi.fn()} />);
    act(() => usePaletteStore.getState().openPalette(null));
    const dialog = await screen.findByRole("dialog", { name: "Go to" });
    return { ...view, dialog };
  }

  it("is one named modal dialog that takes the shell out of the accessibility tree", async () => {
    const { dialog } = await renderOpen();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("region", { name: "Before you continue" })).toBeNull();
  });

  it("names every control and gives the combobox the states it requires", async () => {
    const { dialog } = await renderOpen();
    for (const el of dialog.querySelectorAll("button, input")) expect(el).toHaveAccessibleName();
    const input = within(dialog).getByRole("combobox");
    expect(input).toHaveAttribute("aria-expanded", "true");
    const list = document.getElementById(input.getAttribute("aria-controls") ?? "");
    expect(list).toHaveAttribute("role", "listbox");
    const active = document.getElementById(input.getAttribute("aria-activedescendant") ?? "");
    expect(active).toHaveAttribute("role", "option");
    expect(list!.contains(active)).toBe(true);
  });

  it("nests only named groups of options in the listbox, one of them selected", async () => {
    const { dialog } = await renderOpen();
    const list = within(dialog).getByRole("listbox");
    for (const child of list.children) expect(child).toHaveAttribute("role", "group");
    for (const group of within(list).getAllByRole("group")) {
      expect(group).toHaveAccessibleName();
      for (const child of group.children) expect(["option", "presentation"]).toContain(child.getAttribute("role"));
    }
    const options = within(list).getAllByRole("option");
    expect(options.every((o) => o.hasAttribute("aria-selected"))).toBe(true);
    expect(options.filter((o) => o.getAttribute("aria-selected") === "true")).toHaveLength(1);
  });

  it("has one live region, no title, no positive or option tabindex, and no duplicate id", async () => {
    const { dialog } = await renderOpen();
    expect(dialog.querySelectorAll('[aria-live], [role="status"], [role="alert"]')).toHaveLength(1);
    expect(dialog.querySelector("[title]")).toBeNull();
    expect(dialog.querySelector('[tabindex]:not([tabindex="0"]):not([tabindex="-1"])')).toBeNull();
    expect(dialog.querySelector('[role="option"][tabindex]')).toBeNull();
    expect(dialog.querySelector('[aria-hidden="true"] button, [aria-hidden="true"] input')).toBeNull();
    const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
