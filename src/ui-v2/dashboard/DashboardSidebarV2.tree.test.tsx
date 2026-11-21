import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useNavMemoryStore } from "@/store/navMemoryStore";
import { usePaletteStore } from "@/store/paletteStore";

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
import { RAIL_CLUSTER_CELLS, RAIL_CLUSTER_COLUMNS } from "@/ui-v2/shell/railMode";

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
    railMode: "tree" as const,
    railSlot: { slotW: 1280, slotH: 764, need: 622 },
    ...overrides,
  };
  const view = render(<DashboardSidebarV2 {...props} />);
  const rerender = (next: Partial<typeof props>) =>
    view.rerender(<DashboardSidebarV2 {...props} {...next} />);
  return { props, rerender };
}

// Focus inside act: the roving state follows focus through a React update.
const focus = (el: HTMLElement) => act(() => el.focus());
const row = (name: RegExp | string) => screen.getByRole("button", { name });
const navId = (id: string) => document.querySelector<HTMLElement>(`[data-nav-id="${id}"]`)!;
// By id: the Market header and its child share one label.
const header = (name: string) => navId(`group:${name.toLowerCase()}`);

beforeEach(() => {
  useNavMemoryStore.getState().resetNavMemory();
  usePaletteStore.getState().reset();
});

describe("Tree rail structure", () => {
  it("renders one navigation landmark and exposes the mode on the aside", () => {
    setup();
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
    const aside = document.querySelector<HTMLElement>('[data-slot="rail"]')!;
    expect(aside).toHaveAttribute("data-rail-mode", "tree");
    expect(aside).toHaveAttribute("data-rail-slot-w", "1280");
    expect(aside).toHaveAttribute("data-rail-slot-h", "764");
    expect(aside).toHaveAttribute("data-rail-need", "622");
  });

  it("lists direct stops, a separator, then the three groups as nested lists", () => {
    setup();
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    const lists = within(nav).getAllByRole("list", { hidden: true });
    expect(lists.length).toBe(4); // the root list and one per group
    for (const name of ["Home", "Inbox", "News", "Social", "Schedule"]) {
      expect(navId(`tab:${name}`)).toBeInTheDocument();
    }
    expect(within(nav).getAllByRole("separator").length).toBeGreaterThanOrEqual(1);
    for (const g of ["club", "market", "world"]) expect(navId(`group:${g}`)).toBeInTheDocument();
  });

  it("keeps the divider valid inside the list: every child of a list is a plain item", () => {
    setup();
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    expect(nav.querySelector('li[role="separator"]')).toBeNull();
    for (const ul of nav.querySelectorAll("ul")) {
      for (const child of ul.children) {
        expect(child.tagName).toBe("LI");
        expect(child.getAttribute("role") === null || child.getAttribute("role") === "presentation").toBe(true);
      }
    }
    expect(within(nav).getAllByRole("separator").length).toBeGreaterThanOrEqual(1);
  });

  it("gives each group header aria-expanded and aria-controls pointing at its list", () => {
    setup();
    for (const [name, open] of [["Club", "true"], ["Market", "false"], ["World", "false"]] as const) {
      const h = header(name);
      expect(h).toHaveAttribute("aria-expanded", open);
      const list = document.getElementById(h.getAttribute("aria-controls")!)!;
      expect(list.tagName).toBe("UL");
      expect(list.hidden).toBe(open === "false");
    }
  });

  it("shows the ten Club children and leaves closed children out of the accessibility tree", () => {
    setup();
    const club = document.getElementById(header("Club").getAttribute("aria-controls")!)!;
    expect(within(club).getAllByRole("button")).toHaveLength(10);
    expect(screen.queryByRole("button", { name: "Transfers" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Players" })).toBeNull();
    const closed = document.getElementById(header("Market").getAttribute("aria-controls")!)!;
    expect(closed).toHaveAttribute("hidden");
    expect(closed).not.toHaveAttribute("aria-hidden");
  });

  it("hides the Club group while unemployed", () => {
    setup({ isUnemployed: true });
    expect(screen.queryByRole("button", { name: /^Club/ })).toBeNull();
  });

  it("makes exactly one row tabbable", () => {
    setup({ activeTab: "Squad" });
    const tabbable = screen.getAllByRole("button").filter((b) => b.getAttribute("tabindex") === "0");
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveAttribute("data-nav-id", "tab:Squad");
  });

  it("falls back to the header as the tab stop when the active child is collapsed", () => {
    setup({ activeTab: "Squad" });
    fireEvent.click(header("Club"));
    expect(header("Club")).toHaveAttribute("tabindex", "0");
  });
});

describe("Tree rail structural spacing", () => {
  // Spacing utilities such as p-1.5 or my-2 are rem-scaled and grew the tree past `need` at XL.
  const REM_SPACING = /(^|\s)-?(?:p|px|py|pt|pb|m|mx|my|mt|mb|gap)-(?:[1-9]|\.)/;

  it("spends only px-fixed spacing on the list, the divider, the Market gap and the cluster", () => {
    setup();
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    const root = nav.querySelector("ul")!;
    const divider = root.querySelector(":scope > li:has(hr)") as HTMLElement;
    const market = navId("group:market").closest("li") as HTMLElement;
    const cluster = document.querySelector('[data-slot="rail-cluster"]') as HTMLElement;
    for (const el of [root, divider, market, cluster]) {
      expect(el.className, el.outerHTML.slice(0, 60)).not.toMatch(REM_SPACING);
    }
  });
});

describe("Tree rail active state", () => {
  it("marks the active child current and its header only active-within", () => {
    setup({ activeTab: "Squad" });
    expect(row("Squad")).toHaveAttribute("aria-current", "page");
    expect(header("Club")).not.toHaveAttribute("aria-current");
    expect(header("Club")).toHaveAttribute("data-active-within", "true");
    expect(header("Club").className).toContain("font-bold");
    expect(header("Market")).not.toHaveAttribute("data-active-within");
    expect(document.querySelectorAll('nav [aria-current="page"]')).toHaveLength(1);
  });

  it("marks a direct stop current and no header active-within", () => {
    setup({ activeTab: "Inbox" });
    expect(row(/^Inbox/)).toHaveAttribute("aria-current", "page");
    expect(document.querySelector("[data-active-within]")).toBeNull();
  });

  it("does not rely on colour: the active row carries a bar and bold weight", () => {
    setup({ activeTab: "Squad" });
    expect(row("Squad").className).toContain("font-bold");
    expect(row("Squad").querySelector('[data-slot="rail-item-bar"]')).not.toBeNull();
    expect(row("Squad").className).not.toMatch(/text-pri\w+/); // bare primary is banned (tokens.guard)
  });

  it("opens the group of the active tab through the store, without a user toggle", () => {
    setup({ activeTab: "Transfers" });
    expect(header("Market")).toHaveAttribute("aria-expanded", "true");
    expect(row("Transfers")).toHaveAttribute("aria-current", "page");
  });

  it("lets the user collapse the group holding the active tab and keeps it marked active-within", () => {
    const { rerender } = setup({ activeTab: "Squad" });
    fireEvent.click(header("Club"));
    expect(header("Club")).toHaveAttribute("aria-expanded", "false");
    expect(header("Club")).toHaveAttribute("data-active-within", "true");
    expect(header("Club")).toHaveAttribute("aria-current", "true"); // not "page": the child alone carries that
    expect(header("Club").className).toContain("font-bold");
    expect(screen.queryByRole("button", { name: "Squad" })).toBeNull();
    // A re-render with the same active tab never forces it open again.
    rerender({ unreadMessagesCount: 3 });
    expect(header("Club")).toHaveAttribute("aria-expanded", "false");
  });

  it("shows a collapsed group's badge on its header and not twice when open", () => {
    setup({ pendingOffersCount: 3 });
    expect(header("Market")).toHaveAccessibleName("Market, 3");
    fireEvent.click(header("Market"));
    expect(header("Market")).toHaveAccessibleName("Market");
    expect(row(/^Transfers/)).toHaveAccessibleName("Transfers, 3");
  });
});

describe("Tree rail activation", () => {
  it("toggles a header on click without navigating", () => {
    const { props } = setup();
    fireEvent.click(header("World"));
    expect(header("World")).toHaveAttribute("aria-expanded", "true");
    expect(props.onNavClick).not.toHaveBeenCalled();
    fireEvent.click(header("World"));
    expect(header("World")).toHaveAttribute("aria-expanded", "false");
  });

  it("navigates from a child and a direct stop", () => {
    const { props } = setup();
    fireEvent.click(row("Tactics"));
    expect(props.onNavClick).toHaveBeenLastCalledWith("Tactics");
    fireEvent.click(row(/^Inbox/));
    expect(props.onNavClick).toHaveBeenLastCalledWith("Inbox");
  });

  it("maps the Academy child to the Youth tab", () => {
    const { props } = setup();
    fireEvent.click(row("Academy"));
    expect(props.onNavClick).toHaveBeenCalledWith("Youth");
  });
});

describe("Tree rail keyboard", () => {
  const press = (el: HTMLElement, key: string, init: KeyboardEventInit = {}) =>
    fireEvent.keyDown(el, { key, ...init });

  it("Right on an open header enters the first child, Left returns to the header", () => {
    setup();
    focus(header("Club"));
    press(header("Club"), "ArrowRight");
    expect(navId("tab:Squad")).toHaveFocus();
    press(navId("tab:Squad"), "ArrowLeft");
    expect(header("Club")).toHaveFocus();
  });

  it("Left collapses an open header and Right expands a collapsed one, keeping focus", () => {
    setup();
    focus(header("Club"));
    press(header("Club"), "ArrowLeft");
    expect(header("Club")).toHaveAttribute("aria-expanded", "false");
    expect(header("Club")).toHaveFocus();
    press(header("Club"), "ArrowRight");
    expect(header("Club")).toHaveAttribute("aria-expanded", "true");
    expect(header("Club")).toHaveFocus();
  });

  it("keeps focus on the same row when a toggle shifts the rows below it", () => {
    setup();
    focus(header("Market"));
    press(header("Club"), "ArrowLeft"); // collapses Club from its own header first
    focus(header("Market"));
    press(header("Market"), "ArrowRight");
    expect(header("Market")).toHaveFocus();
    expect(header("Market")).toHaveAttribute("tabindex", "0");
  });

  it("Enter and Space toggle a header and navigate a child", () => {
    const { props } = setup();
    focus(header("Market"));
    press(header("Market"), "Enter");
    expect(header("Market")).toHaveAttribute("aria-expanded", "true");
    press(header("Market"), " ");
    expect(header("Market")).toHaveAttribute("aria-expanded", "false");
    focus(row("Training"));
    press(row("Training"), "Enter");
    expect(props.onNavClick).toHaveBeenCalledWith("Training");
  });

  it("Down, Up, Home and End walk the visible rows and skip closed children", () => {
    setup();
    focus(row(/^Home/));
    press(row(/^Home/), "End");
    expect(navId("util:manager")).toHaveFocus();
    press(navId("util:manager"), "Home");
    expect(navId("util:go")).toHaveFocus();
    press(navId("tab:Schedule"), "ArrowDown");
    expect(header("Club")).toHaveFocus();
    press(header("Club"), "ArrowUp");
    expect(navId("tab:Schedule")).toHaveFocus();
  });

  it("Left and Right do nothing on a leaf, a child's Right and a utility, and never move focus", () => {
    setup();
    focus(row(/^Home/));
    const left = press(row(/^Home/), "ArrowLeft");
    const right = press(row(/^Home/), "ArrowRight");
    expect(left).toBe(false); // handled: default prevented
    expect(right).toBe(false);
    expect(navId("tab:Home")).toHaveFocus();
    focus(row("Squad"));
    press(row("Squad"), "ArrowRight");
    expect(row("Squad")).toHaveFocus();
    focus(navId("util:settings"));
    press(navId("util:settings"), "ArrowRight");
    press(navId("util:settings"), "ArrowLeft");
    expect(navId("util:settings")).toHaveFocus();
  });

  it("leaves Alt, Ctrl and Meta combinations to the browser", () => {
    setup();
    focus(row(/^Home/));
    for (const mod of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
      for (const key of ["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", "Home", "End"]) {
        const notPrevented = press(row(/^Home/), key, mod);
        expect(notPrevented, `${JSON.stringify(mod)} ${key}`).toBe(true);
        expect(navId("tab:Home")).toHaveFocus();
      }
    }
  });

  it("keeps type-ahead working across visible labels", () => {
    setup();
    focus(row(/^Home/));
    press(row(/^Home/), "n");
    expect(navId("tab:News")).toHaveFocus();
  });
});

describe("Tree utility cluster", () => {
  const cells = () => [...document.querySelectorAll<HTMLElement>('[data-slot="rail-cluster"] [data-nav-id]')];

  it("pins four icon-only cells in one grid row: Bug, Settings, Exit, Manager", () => {
    setup();
    const cluster = document.querySelector<HTMLElement>('[data-slot="rail-cluster"]')!;
    expect(cells().map((c) => c.dataset.navId)).toEqual(["util:bug", "util:settings", "util:exit", "util:manager"]);
    expect(cells()).toHaveLength(RAIL_CLUSTER_CELLS);
    expect(cluster.style.gridTemplateColumns).toBe(`repeat(${RAIL_CLUSTER_COLUMNS}, minmax(0, 1fr))`);
    for (const c of cells()) {
      expect(c.className).toContain("h-[var(--nav-cell)]");
      // No visible word: the only text is the manager's initials, and they are aria-hidden.
      const visible = [...c.querySelectorAll("*")].filter((n) => n.children.length === 0 && n.textContent?.trim() && n.getAttribute("aria-hidden") !== "true");
      expect(visible).toEqual([]);
    }
  });

  it("names every cell with an aria-label", () => {
    setup();
    expect(cells().map((c) => c.getAttribute("aria-label"))).toEqual([
      "Reportar Bug", // FloatingBugButton's own default text; the i18n key is onAir.nav.bug
      "Settings",
      "Exit",
      "Manager profile, Boss",
    ]);
  });

  it("shows each label in an IconTip on keyboard focus, and not for pointer focus", () => {
    setup();
    focus(navId("util:settings"));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Settings");
    act(() => navId("util:settings").blur());
    expect(screen.queryByRole("tooltip")).toBeNull();
    // A browser that supports :focus-visible says a click's focus is not keyboard focus.
    vi.stubGlobal("CSS", { supports: () => true });
    const real = Element.prototype.matches;
    const spy = vi.spyOn(Element.prototype, "matches").mockImplementation(function (this: Element, sel: string) {
      return sel === ":focus-visible" ? false : real.call(this, sel);
    });
    fireEvent.pointerDown(navId("util:exit"), { pointerType: "mouse" });
    focus(navId("util:exit"));
    expect(screen.queryByRole("tooltip")).toBeNull();
    spy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("keeps Exit in the danger tone and runs its callbacks", () => {
    const { props } = setup();
    expect(navId("util:exit").className).toContain("text-negative");
    fireEvent.click(navId("util:exit"));
    expect(props.onExitClick).toHaveBeenCalledTimes(1);
    fireEvent.click(navId("util:settings"));
    expect(props.onNavigateSettings).toHaveBeenCalledTimes(1);
    fireEvent.click(navId("util:manager"));
    expect(props.onNavClick).toHaveBeenLastCalledWith("Manager");
  });

  it("reaches the bug cell with the arrows and opens the report with Enter", () => {
    setup();
    focus(header("World"));
    fireEvent.keyDown(header("World"), { key: "ArrowDown" });
    expect(navId("util:bug")).toHaveFocus();
    expect(navId("util:bug")).toHaveAttribute("tabindex", "0");
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(navId("util:bug"), { key: "Enter" });
    expect(screen.getByRole("dialog", { name: "Bug report" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close bug report" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the report on click as well, and it is the only tab stop in the cluster", () => {
    setup();
    fireEvent.click(navId("util:bug"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(cells().filter((c) => c.getAttribute("tabindex") === "0")).toHaveLength(0);
  });
});

describe("Tree attention marker", () => {
  it("puts the badge before the attention clause so a count never reads as part of it", () => {
    setup({
      activeTab: "Players",
      attention: { Players: { count: 2, headline: "Two pending" } },
      playerCount: 22,
    });
    expect(navId("tab:Players")).toHaveAccessibleName("Players (22), 2 need your call");
  });

  const attention = {
    Scrims: { count: 1, headline: "Scrims are not planned" },
    Squad: { count: 3, headline: "Lineup incomplete" },
    Transfers: { count: 2, headline: "Offers waiting" },
  };

  it("names a row that needs a call, with the headline as its description", () => {
    setup({ attention });
    expect(navId("tab:Scrims")).toHaveAccessibleName("Scrims, needs your call");
    expect(navId("tab:Scrims")).toHaveAttribute("aria-description", "Scrims are not planned");
    expect(navId("tab:Squad")).toHaveAccessibleName("Squad, 3 need your call");
  });

  it("leaves other rows alone: plain name, no description", () => {
    setup({ attention });
    expect(navId("tab:Tactics")).toHaveAccessibleName("Tactics");
    expect(navId("tab:Tactics")).not.toHaveAttribute("aria-description");
    expect(navId("tab:Tactics").querySelector('[data-slot="rail-attention"]')).toBeNull();
  });

  it("draws a warning icon, the count only above 1, and no state word", () => {
    setup({ attention });
    const one = navId("tab:Scrims").querySelector('[data-slot="rail-attention"]')!;
    expect(one.querySelector("svg")).not.toBeNull();
    expect(one.getAttribute("aria-hidden")).toBe("true");
    expect(one.textContent).toBe("");
    const many = navId("tab:Squad").querySelector('[data-slot="rail-attention"]')!;
    expect(many.textContent).toBe("3");
    expect(many.className).toContain("text-nav");
    expect(navId("tab:Scrims").textContent).not.toMatch(/not planned|needs/i);
  });

  it("rolls up onto a collapsed header, and only when it is collapsed", () => {
    setup({ attention });
    fireEvent.click(header("Club"));
    expect(header("Club")).toHaveAccessibleName("Club, 4 need your call");
    expect(header("Club")).toHaveAttribute("aria-description", "Lineup incomplete");
    expect(header("Club").querySelector('[data-slot="rail-attention"]')).not.toBeNull();
    fireEvent.click(header("Club"));
    expect(header("Club")).toHaveAccessibleName("Club");
    expect(header("Club").querySelector('[data-slot="rail-attention"]')).toBeNull();
    // Market is collapsed by default and holds Transfers.
    expect(header("Market")).toHaveAccessibleName("Market, 2 need your call");
  });

  it("keeps the badge count in the name next to the attention text", () => {
    setup({ attention, pendingOffersCount: 3, activeTab: "Transfers" });
    expect(navId("tab:Transfers")).toHaveAccessibleName("Transfers (3), 2 need your call");
  });

  it("sets every badge in the nav text size, never under 10 px", () => {
    setup({ unreadMessagesCount: 21, activeTab: "Transfers", pendingOffersCount: 3 });
    const badges = document.querySelectorAll('[data-slot="rail-item-badge"]');
    expect(badges.length).toBeGreaterThan(0);
    for (const b of badges) {
      expect(b.className).toContain("text-nav");
      expect(b.className).not.toContain("text-xs");
    }
  });
});

describe("Tree: the Go row (NR2.9, spec section 7.1)", () => {
  it("is the first row, above the scroller: a dialog button named “Go to…”, never current", () => {
    setup();
    const nav = screen.getByRole("navigation");
    const go = within(nav).getAllByRole("button")[0];
    expect(go).toBe(navId("util:go"));
    expect(go).toHaveAccessibleName("Go to…");
    expect(go).toHaveAttribute("aria-haspopup", "dialog");
    expect(go).not.toHaveAttribute("aria-current");
    const scroller = document.querySelector('[data-slot="rail-stops"]')!;
    expect(scroller.contains(go)).toBe(false);
    expect(go.compareDocumentPosition(scroller) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("is reached by Up from Home, and by the Home key", () => {
    setup();
    focus(navId("tab:Home"));
    fireEvent.keyDown(navId("tab:Home"), { key: "ArrowUp" });
    expect(navId("util:go")).toHaveFocus();
    focus(navId("tab:Inbox"));
    fireEvent.keyDown(navId("tab:Inbox"), { key: "Home" });
    expect(navId("util:go")).toHaveFocus();
  });

  it("opens the palette with util:go as its opener, by click and by Enter", () => {
    setup();
    fireEvent.click(navId("util:go"));
    expect(usePaletteStore.getState()).toMatchObject({ open: true, openerId: "util:go" });
    act(() => usePaletteStore.getState().reset());
    focus(navId("util:go"));
    fireEvent.keyDown(navId("util:go"), { key: "Enter" });
    expect(usePaletteStore.getState()).toMatchObject({ open: true, openerId: "util:go" });
  });

  it("answers type-ahead: G reaches the row by its visible text (R90)", () => {
    setup();
    focus(navId("tab:Home"));
    fireEvent.keyDown(navId("tab:Home"), { key: "g" });
    expect(navId("util:go")).toHaveFocus();
  });

  it("keeps focus on Go when the rail flips to Split", () => {
    const { rerender } = setup();
    focus(navId("util:go"));
    rerender({ railMode: "split" });
    expect(navId("util:go")).toHaveFocus();
    expect(navId("util:go")).toHaveAttribute("data-variant", "cell");
  });
});
