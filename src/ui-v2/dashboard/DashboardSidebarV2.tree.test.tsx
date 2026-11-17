import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useNavMemoryStore } from "@/store/navMemoryStore";

vi.mock("@/ui-v2/_legacy/components/dashboard/FloatingBugButton", () => ({
  default: () => <button type="button">Report bug</button>,
}));

import { DashboardSidebarV2 } from "./DashboardSidebarV2";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (key: string, opts?: { defaultValue?: string; group?: string }) =>
      (opts?.defaultValue ?? key).replace("{{group}}", opts?.group ?? ""),
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

beforeEach(() => useNavMemoryStore.getState().resetNavMemory());

describe("Tree rail structure", () => {
  it("renders one navigation landmark and exposes the mode on the aside", () => {
    setup();
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
    const aside = screen.getByRole("complementary");
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
    expect(navId("tab:Home")).toHaveFocus();
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
