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
import { RAIL_CLUSTER_CELLS, splitNeed } from "@/ui-v2/shell/railMode";
import { RAIL_LABEL_CLASS, RAIL_STOP_INSET_REM } from "@/ui-v2/shell/RailItem";

const lang = vi.hoisted(() => ({ value: "en" }));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    i18n: { language: lang.value },
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

beforeEach(() => {
  lang.value = "en";
  useNavMemoryStore.getState().resetNavMemory();
});

describe("Split rail structure", () => {
  it("is one nav landmark, flagged as split, with the eight stops in order", () => {
    setup();
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
    expect(document.querySelector('[data-slot="rail"]')).toHaveAttribute("data-rail-mode", "split");
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
    const label = navId("tab:Inbox").querySelector('[data-slot="rail-item-label"]') as HTMLElement;
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

  it("move the tip with the arrow keys: the focused cell shows its label and the previous one closes", () => {
    setup();
    focus(navId("util:settings"));
    expect(screen.getAllByRole("tooltip")).toHaveLength(1);
    press(navId("util:settings"), "ArrowDown");
    expect(navId("util:exit")).toHaveFocus();
    const tips = screen.getAllByRole("tooltip");
    expect(tips).toHaveLength(1);
    expect(tips[0]).toHaveTextContent("Exit");
    press(navId("util:exit"), "ArrowUp");
    expect(screen.getAllByRole("tooltip")).toHaveLength(1);
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

  it("walks the rail column with Down and wraps to Go, never entering the panel", () => {
    setup({ activeTab: "Squad" });
    focus(navId("util:manager"));
    press(navId("util:manager"), "ArrowDown");
    expect(navId("util:go")).toHaveFocus();
    press(navId("util:go"), "ArrowDown");
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

  it("makes one row per widget tabbable: the rail's and the panel's (R15)", () => {
    setup({ activeTab: "Tactics" });
    const tabbable = [...document.querySelectorAll("nav button")].filter((b) => b.getAttribute("tabindex") === "0");
    expect(tabbable).toHaveLength(2);
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

/** Heights the hidden label measurer reports, per call (jsdom has no layout). */
function measurerHeights(height: () => number) {
  return vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const h = this.closest('[data-slot="rail-measurer"]') && this.tagName === "SPAN" ? height() : 0;
    return { width: 0, height: h, top: 0, left: 0, right: 0, bottom: h, x: 0, y: 0, toJSON() {} } as DOMRect;
  });
}

describe("Split labels that do not fit (R13)", () => {
  const slot = (slotH: number, rootPx: number) => ({ slotW: 960, slotH, need: 622, rootPx });
  const label = (id: string) => navId(id).querySelector('[data-slot="rail-item-label"]');

  it("keeps the labels while the stops fit the rail's height", () => {
    setup({ activeTab: "Squad", railSlot: slot(800, 16) });
    expect(label("tab:Inbox")).not.toBeNull();
    expect(navId("tab:Inbox").className).not.toContain("h-[var(--nav-cell)]");
  });

  it("renders the stops icon-only at --nav-cell when they do not fit, each with an aria-label and an IconTip", () => {
    setup({ activeTab: "Squad", unreadMessagesCount: 21, railSlot: slot(595, 20) });
    for (const id of ["tab:Home", "tab:Inbox", "tab:Schedule", "group:club", "group:market", "group:world"]) {
      expect(label(id), id).toBeNull();
      expect(navId(id).className, id).toContain("h-[var(--nav-cell)]");
      expect(navId(id).getAttribute("aria-label"), id).toBeTruthy();
    }
    expect(navId("tab:Inbox")).toHaveAccessibleName("Inbox, 21");
    focus(navId("tab:Home"));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Home");
    press(navId("tab:Home"), "ArrowDown");
    expect(navId("tab:Inbox")).toHaveFocus();
    expect(screen.getAllByRole("tooltip")).toHaveLength(1);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Inbox");
  });

  it("keeps the current marks, the panel and its labels when the stops go icon-only", () => {
    setup({ activeTab: "Tactics", railSlot: slot(595, 20) });
    expect(navId("group:club")).toHaveAttribute("aria-current", "page");
    expect(navId("group:club").querySelector('[data-slot="rail-item-bar"]')).not.toBeNull();
    expect(navId("tab:Tactics")).toHaveAttribute("aria-current", "page");
    expect(panel()!.contains(navId("tab:Tactics"))).toBe(true);
    expect(navId("tab:Tactics")).toHaveTextContent("Tactics");
  });

  it("goes back to labels only with 16 px to spare", () => {
    const need = splitNeed(16, "labels", 1);
    const { rerender } = setup({ railSlot: slot(need - 1, 16) });
    expect(label("tab:Home")).toBeNull();
    rerender({ railSlot: slot(need + 15, 16) });
    expect(label("tab:Home")).toBeNull();
    rerender({ railSlot: slot(need + 16, 16) });
    expect(label("tab:Home")).not.toBeNull();
  });

  it("counts a shorter rail while the Club group is hidden", () => {
    const need7 = splitNeed(16, "labels", 1, 7);
    setup({ isUnemployed: true, railSlot: slot(need7, 16) });
    expect(label("tab:Home")).not.toBeNull();
  });

  it("measures how many lines the labels wrap to, off-screen, and goes icon-only when two lines would not fit", () => {
    // jsdom has no layout: the hidden measurer reports a two-line label (height 2 x the 16 px line).
    const spy = measurerHeights(() => 32);
    const fitsOneLine = splitNeed(16, "labels", 1);
    expect(fitsOneLine).toBeLessThan(splitNeed(16, "labels", 2));
    setup({ railSlot: slot(fitsOneLine, 16) });
    expect(label("tab:Home")).toBeNull();
    spy.mockRestore();
  });

  it("leaves the Tree and the compact rail alone", () => {
    const { rerender } = setup({ railMode: "tree", railSlot: slot(300, 20) });
    expect(navId("tab:Home").className).toContain("h-[var(--nav-row)]");
    rerender({ railMode: "split", compact: true });
    expect(navId("tab:Home").className).not.toContain("h-[var(--nav-cell)]");
  });
});

describe("Collapsing the group of the focused Tree child", () => {
  it("returns focus to the group's header when a click collapses it without moving focus", () => {
    setup({ railMode: "tree", activeTab: "Tactics" });
    focus(navId("tab:Tactics"));
    // A screen reader's activation: click() on the header, focus stays where it was. The
    // children are hidden, not removed, and the browser only drops their focus a frame later.
    act(() => navId("group:club").click());
    expect(navId("group:club")).toHaveAttribute("aria-expanded", "false");
    expect(navId("group:club")).toHaveFocus();
  });

  it("still restores when the browser reports the loss as a focusout with no relatedTarget", () => {
    setup({ railMode: "tree", activeTab: "Tactics" });
    focus(navId("tab:Tactics"));
    const child = navId("tab:Tactics");
    act(() => navId("group:club").click());
    // The browser reports the hidden row's loss after the DOM changed.
    act(() => {
      child.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
      child.blur();
    });
    expect(navId("group:club")).toHaveFocus();
  });

  it("falls back to the first stop, Go, when the header is gone too", () => {
    const { rerender } = setup({ railMode: "tree", activeTab: "Squad" });
    focus(navId("tab:Squad"));
    rerender({ isUnemployed: true });
    expect(navId("util:go")).toHaveFocus();
  });
});

describe("Focus survives a rail change that is not a Tree/Split flip", () => {
  it("lands on the new active group's launcher when the panel remounts under a route change", () => {
    const { rerender } = setup({ activeTab: "Tactics" });
    focus(navId("tab:Tactics")); // a panel row
    rerender({ activeTab: "Transfers" }); // another group, reached outside the rail
    expect(navId("tab:Tactics")).toBeNull();
    expect(navId("group:market")).toHaveFocus();
  });

  it("falls back to the first stop, Go, when the active group is hidden for an unemployed manager", () => {
    const { rerender } = setup({ activeTab: "Squad" });
    focus(navId("group:club"));
    rerender({ isUnemployed: true });
    expect(navId("group:club")).toBeNull();
    expect(document.activeElement).toBe(navId("util:go"));
  });

  it("does not steal focus back after the window lost focus", () => {
    const { rerender } = setup({ activeTab: "Squad" });
    focus(navId("tab:Squad"));
    fireEvent.blur(window);
    act(() => (document.activeElement as HTMLElement).blur());
    rerender({ activeTab: "Transfers" });
    expect(document.body).toHaveFocus();
  });

  it("does not move focus that is still on a row", () => {
    const { rerender } = setup({ activeTab: "Squad" });
    focus(navId("tab:Inbox"));
    rerender({ activeTab: "Transfers" });
    expect(navId("tab:Inbox")).toHaveFocus();
  });
});

describe("The label measurement (R13)", () => {
  const slot = (slotH: number) => ({ slotW: 960, slotH, need: 622, rootPx: 16 });
  const one = splitNeed(16, "labels", 1);
  const atLabels = one + 20; // fits one line (with the re-entry margin), not two
  const hasLabels = () => document.querySelector('[data-slot="rail-column"] [data-slot="rail-item-label"]') !== null;

  it("re-measures a language change while the rail is icon-only, so a stale line count cannot stick", () => {
    let lines = 2;
    measurerHeights(() => 16 * lines);
    const { rerender } = setup({ railSlot: slot(atLabels) });
    expect(hasLabels()).toBe(false); // two lines do not fit: icon-only
    lines = 1; // a shorter language
    lang.value = "es";
    rerender({});
    expect(hasLabels()).toBe(true);
  });

  it("re-measures when the web fonts finish loading", async () => {
    let resolveFonts!: () => void;
    const ready = new Promise<void>((r) => (resolveFonts = r));
    Object.defineProperty(document, "fonts", { value: { ready }, configurable: true });
    let lines = 1;
    const spy = measurerHeights(() => 16 * lines);
    setup({ railSlot: slot(atLabels) });
    expect(hasLabels()).toBe(true);
    const before = spy.mock.calls.length;
    lines = 2; // the real font is wider than the fallback
    await act(async () => {
      resolveFonts();
      await ready;
    });
    expect(spy.mock.calls.length).toBeGreaterThan(before);
    expect(hasLabels()).toBe(false);
    delete (document as { fonts?: unknown }).fonts;
  });

  it("does not measure again on a re-render that changes nothing it depends on", () => {
    const spy = measurerHeights(() => 16);
    const { rerender } = setup({ railSlot: slot(atLabels) });
    const before = spy.mock.calls.length;
    expect(before).toBeGreaterThan(0);
    rerender({ unreadMessagesCount: 3 });
    rerender({ unreadMessagesCount: 4, activeTab: "Squad" });
    expect(spy.mock.calls.length).toBe(before);
  });
});

describe("Focus restore edge cases", () => {
  it("(a) does not pull focus back after it really left, a blur with no relatedTarget included", () => {
    const { rerender } = setup({ activeTab: "Squad" });
    focus(navId("tab:Inbox"));
    act(() => navId("tab:Inbox").blur()); // focus went to the browser chrome: still connected, relatedTarget null
    rerender({ activeTab: "Transfers" });
    expect(document.body).toHaveFocus();
  });

  it("(b) restores to the group launcher when the window regains focus after its row was removed", () => {
    const { rerender } = setup({ activeTab: "Tactics" });
    focus(navId("tab:Tactics"));
    fireEvent.blur(window); // the window loses focus with the panel row still focused
    rerender({ activeTab: "Transfers" }); // the row goes away meanwhile
    expect(navId("tab:Tactics")).toBeNull();
    expect(document.body).toHaveFocus();
    act(() => void fireEvent.focus(window));
    expect(navId("group:club")).toHaveFocus();
  });

  it("(b) never steals focus that was outside the rail when the window left", () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    const { rerender } = setup({ activeTab: "Tactics" });
    focus(navId("tab:Tactics"));
    focus(outside);
    fireEvent.blur(window);
    rerender({ activeTab: "Transfers" });
    act(() => void fireEvent.focus(window));
    expect(outside).toHaveFocus();
    outside.remove();
  });

  it("(b) leaves focus alone when the browser already put it back", () => {
    setup({ activeTab: "Squad" });
    focus(navId("tab:Inbox"));
    fireEvent.blur(window);
    act(() => void fireEvent.focus(window));
    expect(navId("tab:Inbox")).toHaveFocus();
  });
});

describe("The panel is its own Tab stop (R15)", () => {
  const tabbables = () =>
    [...document.querySelectorAll<HTMLElement>("button")].filter((b) => b.getAttribute("tabindex") === "0");
  /** What Tab reaches next: the following tabbable in document order. */
  const nextTab = (from: HTMLElement) => {
    const list = tabbables();
    return list[list.indexOf(from) + 1] ?? null;
  };

  it("has two Tab stops, the rail's current stop then the panel's active child, in that order", () => {
    setup({ activeTab: "Tactics" });
    const stops = tabbables().map((b) => b.dataset.navId);
    expect(stops).toEqual(["group:club", "tab:Tactics"]);
  });

  it("Tab from the rail stop lands in the panel, and Tab again leaves the rail", () => {
    setup({ activeTab: "Tactics" });
    focus(navId("group:club"));
    const inPanel = nextTab(navId("group:club"));
    expect(inPanel).toBe(navId("tab:Tactics"));
    expect(document.querySelector('[data-slot="rail-panel"]')!.contains(inPanel)).toBe(true);
    expect(nextTab(inPanel!)).toBeNull(); // nothing tabbable after the panel inside the rail
  });

  it("keeps the panel's own roving: arrows move its Tab stop, and the rail keeps its stop", () => {
    setup({ activeTab: "Squad" });
    focus(navId("tab:Squad"));
    press(navId("tab:Squad"), "ArrowDown");
    expect(navId("tab:Tactics")).toHaveFocus();
    expect(tabbables().map((b) => b.dataset.navId)).toEqual(["group:club", "tab:Tactics"]);
  });

  it("Right and Left still cross between the columns", () => {
    setup({ activeTab: "Tactics" });
    focus(navId("group:club"));
    press(navId("group:club"), "ArrowRight");
    expect(navId("tab:Tactics")).toHaveFocus();
    press(navId("tab:Tactics"), "ArrowLeft");
    expect(navId("group:club")).toHaveFocus();
  });

  it("has one Tab stop when there is no panel, and one in Tree", () => {
    const { rerender } = setup({ activeTab: "Inbox" });
    expect(tabbables()).toHaveLength(1);
    rerender({ railMode: "tree", activeTab: "Tactics" });
    expect(tabbables()).toHaveLength(1);
  });

  it("is one stop on Android, which docks no panel", () => {
    setup({ activeTab: "Tactics", platform: "android" });
    expect(tabbables().map((b) => b.dataset.navId)).toEqual(["group:club"]);
  });
});

describe("The Split stops are a list", () => {
  it("wraps the stops in a list of items, with the divider outside the count", () => {
    setup({ activeTab: "Home" });
    const list = document.querySelector('[data-slot="rail-stops"] ul')!;
    expect(list).not.toBeNull();
    expect(list.querySelectorAll(':scope > li:has([data-slot="rail-item"])')).toHaveLength(8);
    for (const child of list.children) expect(child.tagName).toBe("LI");
  });
});

describe("Window focus restore, in the browser's real event order", () => {
  it("restores after the element blur (no relatedTarget) that comes before the window blur", () => {
    const { rerender } = setup({ activeTab: "Tactics" });
    focus(navId("tab:Tactics"));
    // The browser blurs the element first (focusout, relatedTarget null) and the window after;
    // document.activeElement stays on the row throughout.
    fireEvent.focusOut(navId("tab:Tactics"), { relatedTarget: null });
    fireEvent.blur(window);
    rerender({ activeTab: "Transfers" });
    expect(document.body).toHaveFocus();
    act(() => void fireEvent.focus(window));
    expect(navId("group:club")).toHaveFocus();
  });

  it("does not restore when focus was outside the rail as the window blurred", () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    const { rerender } = setup({ activeTab: "Tactics" });
    focus(navId("tab:Tactics"));
    focus(outside);
    fireEvent.blur(window);
    rerender({ activeTab: "Transfers" });
    act(() => void fireEvent.focus(window));
    expect(outside).toHaveFocus();
    outside.remove();
  });

  it("a press outside the rail while the window was away cancels the restore", () => {
    const { rerender } = setup({ activeTab: "Tactics" });
    focus(navId("tab:Tactics"));
    fireEvent.blur(window);
    rerender({ activeTab: "Transfers" });
    fireEvent.pointerDown(document.body); // the click that brings the window back
    act(() => void fireEvent.focus(window));
    expect(document.body).toHaveFocus();
  });
});

describe("The label measurer shares the stop's styles", () => {
  it("uses the stop's label classes and its inset, not hand copies", () => {
    setup({ railSlot: { slotW: 960, slotH: 900, need: 622, rootPx: 16 } });
    const measurer = document.querySelector<HTMLElement>('[data-slot="rail-measurer"]')!;
    const span = measurer.querySelector("span")!;
    for (const cls of RAIL_LABEL_CLASS.split(" ")) expect(span.className, cls).toContain(cls);
    expect(span.className).toContain("font-bold"); // the widest weight, the active stop's
    expect(measurer.style.width).toBe(`calc(var(--rail-w-split) - ${RAIL_STOP_INSET_REM}rem)`);
    const real = document.querySelector<HTMLElement>('[data-slot="rail-item-label"]')!;
    for (const cls of RAIL_LABEL_CLASS.split(" ")) expect(real.className, cls).toContain(cls);
  });

  it("re-measures when a web font finishes loading after the first ready", () => {
    const fonts = new EventTarget() as EventTarget & { ready: Promise<void> };
    fonts.ready = Promise.resolve();
    Object.defineProperty(document, "fonts", { value: fonts, configurable: true });
    let lines = 1;
    const spy = measurerHeights(() => 16 * lines);
    setup({ railSlot: { slotW: 960, slotH: splitNeed(16, "labels", 1) + 20, need: 622, rootPx: 16 } });
    const before = spy.mock.calls.length;
    lines = 2;
    act(() => void fonts.dispatchEvent(new Event("loadingdone")));
    expect(spy.mock.calls.length).toBeGreaterThan(before);
    expect(document.querySelector('[data-slot="rail-column"] [data-slot="rail-item-label"]')).toBeNull();
    delete (document as { fonts?: unknown }).fonts;
  });
});

describe("Split: the Go cell (NR2.9, R31)", () => {
  it("is first in the rail column, an icon-only --nav-cell cell named by aria-label, like the utility cells", () => {
    setup();
    const column = document.querySelector<HTMLElement>('[data-slot="rail-column"]')!;
    const first = column.querySelector<HTMLElement>("button");
    expect(first).toBe(navId("util:go"));
    expect(first).toHaveAttribute("data-variant", "cell");
    expect(first).toHaveAttribute("aria-label", "Go to…");
    expect(first).toHaveAttribute("aria-haspopup", "dialog");
    expect(first!.className).toContain("h-[var(--nav-cell)]");
    expect(first!.textContent).toBe("");
  });

  it("sits at the top of the end-of-season rail too", () => {
    setup({ compact: true });
    const column = document.querySelector<HTMLElement>('[data-slot="rail-column"]')!;
    expect(column.querySelector("button")).toBe(navId("util:go"));
  });
});
