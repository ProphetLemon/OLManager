import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useNavMemoryStore } from "@/store/navMemoryStore";

vi.mock("@/ui-v2/_legacy/components/dashboard/ReportBugModal", () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="Bug report">
      <button type="button" onClick={onClose}>
        Close bug report
      </button>
    </div>
  ),
}));

import { DashboardSidebarV2 } from "./DashboardSidebarV2";
import { RAIL_CLUSTER_CELLS } from "@/ui-v2/shell/railMode";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (key: string, opts?: Record<string, unknown>) => {
      const count = opts?.count as number | undefined;
      const text =
        (count === 1 ? (opts?.defaultValue_one as string | undefined) : (opts?.defaultValue_other as string | undefined)) ??
        (opts?.defaultValue as string | undefined) ??
        key;
      return text.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(opts?.[name] ?? ""));
    },
  }),
}));

type Props = React.ComponentProps<typeof DashboardSidebarV2>;

function setup(overrides: Partial<Props> = {}) {
  const props: Props = {
    activeTab: "Home",
    onNavClick: vi.fn(),
    unreadMessagesCount: 0,
    managerName: "Boss",
    teamName: "Team",
    teamLogo: null,
    isUnemployed: false,
    onNavigateSettings: vi.fn(),
    onExitClick: vi.fn(),
    railMode: "split",
    ...overrides,
  };
  const view = render(<DashboardSidebarV2 {...props} />);
  const rerender = (next: Partial<Props>) => view.rerender(<DashboardSidebarV2 {...props} {...next} />);
  return { props, rerender };
}

const navId = (id: string) => document.querySelector<HTMLElement>(`[data-nav-id="${id}"]`)!;
const panel = () => screen.queryByRole("group", { name: /sections$/ });
const focus = (el: HTMLElement) => act(() => el.focus());
const press = (el: HTMLElement, key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(el, { key, ...init });

beforeEach(() => useNavMemoryStore.getState().resetNavMemory());

describe("Split rail structure", () => {
  it("is one nav landmark, flagged as split, with the eight stops in order", () => {
    setup();
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
    expect(screen.getByRole("complementary")).toHaveAttribute("data-rail-mode", "split");
    const stops = [...document.querySelectorAll<HTMLElement>('[data-slot="rail-item"]')].map((e) => e.dataset.navId);
    expect(stops).toEqual([
      "tab:Home", "tab:Inbox", "tab:News", "tab:Social", "tab:Schedule",
      "group:club", "group:market", "group:world",
    ]);
  });

  it("docks a panel for the active group inside the same nav, headed by the group and its count", () => {
    setup({ activeTab: "Squad" });
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    const group = within(nav).getByRole("group", { name: "Club sections" });
    expect(within(group).getAllByRole("button")).toHaveLength(10);
    expect(within(group).getByText("Club")).toBeInTheDocument();
    expect(within(group).getByText("10")).toBeInTheDocument();
  });

  it("marks the group stop and the panel child current, in different lists", () => {
    setup({ activeTab: "Tactics" });
    expect(navId("group:club")).toHaveAttribute("aria-current", "page");
    expect(navId("tab:Tactics")).toHaveAttribute("aria-current", "page");
    expect(navId("tab:Squad")).not.toHaveAttribute("aria-current");
    expect(panel()!.contains(navId("tab:Tactics"))).toBe(true);
    expect(panel()!.contains(navId("group:club"))).toBe(false);
  });

  it("follows the active group: another group's tab swaps the panel", () => {
    const { rerender } = setup({ activeTab: "Squad" });
    rerender({ activeTab: "Transfers" });
    expect(screen.getByRole("group", { name: "Market sections" })).toBeInTheDocument();
    expect(within(panel()!).getAllByRole("button")).toHaveLength(2);
  });

  it("hides the panel on a direct stop and gives its width back", () => {
    setup({ activeTab: "Inbox" });
    expect(panel()).toBeNull();
    expect(document.querySelector('[data-slot="rail-panel"]')).toBeNull();
  });

  it("renders no panel when compact, and keeps the labels for assistive tech only", () => {
    setup({ activeTab: "Squad", compact: true });
    expect(panel()).toBeNull();
    expect(navId("tab:Home")).toHaveAccessibleName("Home");
    expect(navId("tab:Home").querySelector(".sr-only")).not.toBeNull();
  });

  it("shows no panel for the Club group while unemployed", () => {
    setup({ activeTab: "Squad", isUnemployed: true });
    expect(panel()).toBeNull();
    expect(navId("group:club")).toBeNull();
  });

  it("navigates a group stop to the group's last tab", () => {
    const { props } = setup({ activeTab: "Home" });
    act(() => {
      useNavMemoryStore.getState().rememberTab("Finances");
      useNavMemoryStore.getState().rememberTab("Home");
    });
    fireEvent.click(navId("group:club"));
    expect(props.onNavClick).toHaveBeenLastCalledWith("Finances");
  });

  it("navigates from a panel row and maps Academy to Youth", () => {
    const { props } = setup({ activeTab: "Squad" });
    fireEvent.click(navId("tab:Youth"));
    expect(props.onNavClick).toHaveBeenLastCalledWith("Youth");
  });
});

describe("Split sizes and text (R12)", () => {
  it("sets stop labels to wrap in two balanced lines instead of clipping, and hyphenate", () => {
    setup();
    const label = navId("tab:Inbox").querySelector("span[aria-hidden]:not([data-slot])") as HTMLElement;
    for (const cls of ["line-clamp-2", "text-balance", "hyphens-auto", "wrap-break-word", "text-nav"]) {
      expect(label.className, cls).toContain(cls);
    }
    expect(label.className).not.toContain("truncate");
  });

  it("uses the icon and badge tokens, never under 18 px and 10 px", () => {
    setup({ unreadMessagesCount: 21 });
    const stop = navId("tab:Inbox");
    expect(stop.querySelector("svg")!.getAttribute("class")).toContain("size-[var(--nav-icon)]");
    const badge = stop.querySelector('[data-slot="rail-item-badge"]')!;
    expect(badge.className).toContain("text-nav");
    expect(badge.className).not.toContain("text-xs");
  });

  it("widens the rail by token: split, panel and compact", () => {
    const { rerender } = setup({ activeTab: "Squad" });
    expect(document.querySelector('[data-slot="rail-column"]')!.className).toContain("w-[var(--rail-w-split)]");
    expect(panel()!.className).toContain("w-[var(--nav-panel-w)]");
    rerender({ compact: true });
    expect(document.querySelector('[data-slot="rail-column"]')!.className).toContain("w-[var(--rail-w-compact)]");
  });
});

describe("Split utility cells (R12)", () => {
  const cells = () => [...document.querySelectorAll<HTMLElement>('[data-slot="rail-cluster"] [data-nav-id]')];

  it("are four icon-only cells stacked in one column, each with an aria-label", () => {
    setup();
    const cluster = document.querySelector<HTMLElement>('[data-slot="rail-cluster"]')!;
    expect(cells().map((c) => c.dataset.navId)).toEqual(["util:bug", "util:settings", "util:exit", "util:manager"]);
    expect(cells()).toHaveLength(RAIL_CLUSTER_CELLS);
    expect(cluster.style.gridTemplateColumns).toBe("repeat(1, minmax(0, 1fr))");
    expect(cells().map((c) => c.getAttribute("aria-label"))).toEqual([
      "Reportar Bug",
      "Settings",
      "Exit",
      "Manager profile, Boss",
    ]);
    for (const c of cells()) expect(c.className).toContain("h-[var(--nav-cell)]");
  });

  it("show their label in an IconTip on keyboard focus", () => {
    setup();
    focus(navId("util:settings"));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Settings");
  });

  it("keep the bug cell in the roving widget and open its report on Enter", () => {
    setup();
    focus(navId("group:world"));
    press(navId("group:world"), "ArrowDown");
    expect(navId("util:bug")).toHaveFocus();
    press(navId("util:bug"), "Enter");
    expect(screen.getByRole("dialog", { name: "Bug report" })).toBeInTheDocument();
  });
});

describe("Split keyboard", () => {
  it("Right on the active group stop enters the panel at the active child, Left returns", () => {
    setup({ activeTab: "Tactics" });
    focus(navId("group:club"));
    press(navId("group:club"), "ArrowRight");
    expect(navId("tab:Tactics")).toHaveFocus();
    press(navId("tab:Tactics"), "ArrowLeft");
    expect(navId("group:club")).toHaveFocus();
  });

  it("Escape in the panel returns to the owning stop", () => {
    setup({ activeTab: "Squad" });
    focus(navId("group:club"));
    press(navId("group:club"), "ArrowRight");
    press(navId("tab:Squad"), "ArrowDown");
    expect(navId("tab:Tactics")).toHaveFocus();
    press(navId("tab:Tactics"), "Escape");
    expect(navId("group:club")).toHaveFocus();
  });

  it("does nothing on Right from a stop without a panel, and never moves focus sideways", () => {
    setup({ activeTab: "Squad" });
    focus(navId("tab:Home"));
    expect(press(navId("tab:Home"), "ArrowRight")).toBe(false);
    expect(navId("tab:Home")).toHaveFocus();
    focus(navId("group:market"));
    press(navId("group:market"), "ArrowRight");
    expect(navId("group:market")).toHaveFocus();
  });

  it("walks the rail column with Down and wraps, never entering the panel", () => {
    setup({ activeTab: "Squad" });
    focus(navId("util:manager"));
    press(navId("util:manager"), "ArrowDown");
    expect(navId("tab:Home")).toHaveFocus();
    press(navId("tab:Home"), "End");
    expect(navId("util:manager")).toHaveFocus();
  });

  it("walks the panel with Down, Home and End inside the panel", () => {
    setup({ activeTab: "Squad" });
    focus(navId("tab:Squad"));
    press(navId("tab:Squad"), "End");
    expect(navId("tab:Finances")).toHaveFocus();
    press(navId("tab:Finances"), "ArrowDown");
    expect(navId("tab:Squad")).toHaveFocus();
  });

  it("makes exactly one row tabbable", () => {
    setup({ activeTab: "Tactics" });
    const tabbable = [...document.querySelectorAll("nav button")].filter((b) => b.getAttribute("tabindex") === "0");
    expect(tabbable).toHaveLength(1);
  });

  it("leaves Alt, Ctrl and Meta combinations to the browser", () => {
    setup({ activeTab: "Squad" });
    focus(navId("group:club"));
    for (const mod of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
      expect(press(navId("group:club"), "ArrowLeft", mod)).toBe(true);
      expect(press(navId("group:club"), "ArrowRight", mod)).toBe(true);
      expect(navId("group:club")).toHaveFocus();
    }
  });
});

describe("Tree and Split flip keeps focus by id", () => {
  const tree = { railMode: "tree" as const };

  it("keeps a direct row focused", () => {
    const { rerender } = setup({ ...tree, activeTab: "Squad" });
    focus(navId("tab:Inbox"));
    rerender({ railMode: "split" });
    expect(navId("tab:Inbox")).toHaveFocus();
    rerender(tree);
    expect(navId("tab:Inbox")).toHaveFocus();
  });

  it("keeps a group header, which is a stop in Split", () => {
    const { rerender } = setup({ ...tree, activeTab: "Squad" });
    focus(navId("group:club"));
    rerender({ railMode: "split" });
    expect(navId("group:club")).toHaveFocus();
  });

  it("keeps the active tab's row: a Tree child becomes the panel row", () => {
    const { rerender } = setup({ ...tree, activeTab: "Squad" });
    focus(navId("tab:Squad"));
    rerender({ railMode: "split" });
    expect(navId("tab:Squad")).toHaveFocus();
    expect(panel()!.contains(navId("tab:Squad"))).toBe(true);
  });

  it("moves a Tree child whose group has no panel to its group stop", () => {
    const { rerender } = setup({ ...tree, activeTab: "Home" });
    focus(navId("tab:Tactics"));
    rerender({ railMode: "split" });
    expect(navId("group:club")).toHaveFocus();
  });

  it("keeps a utility cell", () => {
    const { rerender } = setup({ ...tree, activeTab: "Home" });
    focus(navId("util:settings"));
    rerender({ railMode: "split" });
    expect(navId("util:settings")).toHaveFocus();
  });

  it("does not steal focus when it was outside the rail", () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    const { rerender } = setup({ ...tree, activeTab: "Squad" });
    focus(navId("tab:Inbox"));
    focus(outside);
    rerender({ railMode: "split" });
    expect(outside).toHaveFocus();
    outside.remove();
  });

  it("does not steal focus after a pointer press outside the rail", () => {
    const { rerender } = setup({ ...tree, activeTab: "Squad" });
    focus(navId("tab:Inbox"));
    fireEvent.pointerDown(document.body);
    act(() => (document.activeElement as HTMLElement).blur());
    rerender({ railMode: "split" });
    expect(document.body).toHaveFocus();
  });
});
