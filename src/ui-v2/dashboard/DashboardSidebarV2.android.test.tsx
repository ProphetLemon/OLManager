import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNavMemoryStore } from "@/store/navMemoryStore";
import { dismissOverlayWithBack, resetNativeBackOverlaysForTests, setNativeBackRegistered } from "@/ui-v2/palette/paletteHistory";

import { DashboardSidebarV2 } from "./DashboardSidebarV2";

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
    platform: "android",
    ...overrides,
  };
  const view = render(<DashboardSidebarV2 {...props} />);
  const rerender = (next: Partial<Props>) => view.rerender(<DashboardSidebarV2 {...props} {...next} />);
  return { props, rerender, unmount: view.unmount };
}

const focus = (el: HTMLElement) => act(() => el.focus());
const press = (el: HTMLElement, key: string) => fireEvent.keyDown(el, { key });
const navId = (id: string) => document.querySelector<HTMLElement>(`[data-nav-id="${id}"]`)!;

beforeEach(() => useNavMemoryStore.getState().resetNavMemory());
afterEach(() => resetNativeBackOverlaysForTests());

describe("Android rail", () => {
  it("is always Split, whatever the size or the mode asked for", () => {
    setup({ railMode: "tree", railSlot: { slotW: 5000, slotH: 5000, need: 622, rootPx: 9 } });
    expect(document.querySelector('[data-slot="rail"]')).toHaveAttribute("data-rail-mode", "split");
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
  });

  it("has seven stops: Go, Home, Inbox, Schedule, Club, Market and World; More lives in the bar", () => {
    setup();
    const ids = [...document.querySelectorAll<HTMLElement>('[data-slot="rail-item"], [data-slot="go-button"]')].map(
      (e) => e.dataset.navId,
    );
    expect(ids).toEqual([
      "util:go", "tab:Home", "tab:Inbox", "tab:Schedule", "group:club", "group:market", "group:world",
    ]);
    expect(navId("util:more")).toBeNull();
    expect(navId("tab:News")).toBeNull();
    expect(document.querySelector('[data-slot="rail-cluster"]')).toBeNull();
  });

  it("fixes every stop at the touch --hit so seven of them need 336 px, with no scrolling margin around them", () => {
    setup();
    const stops = document.querySelectorAll<HTMLElement>('[data-slot="rail-item"], [data-slot="go-button"]');
    expect(stops).toHaveLength(7);
    for (const el of stops) {
      expect(el.className, el.dataset.navId).toContain("h-[var(--hit)]");
      expect(el.className, el.dataset.navId).toContain("w-full");
    }
    const column = document.querySelector('[data-slot="rail-column"]')!;
    expect(column.className).not.toContain("py-");
    expect(column.className).toContain("w-[var(--rail-w-phone)]");
  });

  it("keeps the labels visible whatever the height: touch has no hover tip", () => {
    setup({ railSlot: { slotW: 915, slotH: 200, need: 622, rootPx: 9 } });
    for (const el of document.querySelectorAll<HTMLElement>('[data-slot="rail-item"]')) {
      expect(el.querySelector('[data-slot="rail-item-label"]'), el.dataset.navId).not.toBeNull();
      expect(el.className).not.toContain("h-[var(--nav-cell)]");
    }
  });

  it("docks no panel beside the rail, whatever tab is open", () => {
    setup({ activeTab: "Squad" });
    expect(document.querySelector('[data-slot="rail-panel"]')).toBeNull();
    expect(screen.queryByRole("group", { name: "Club sections" })).toBeNull();
  });

  it("answers type-ahead on the Go stop, named by its visible text (R90)", () => {
    setup();
    act(() => navId("tab:Home").focus());
    fireEvent.keyDown(navId("tab:Home"), { key: "g" });
    expect(navId("util:go")).toHaveFocus();
  });

  it("shows Go as a labelled stop at the touch hit, named by its visible “Go” (R40)", () => {
    setup();
    const go = navId("util:go");
    expect(go).toHaveAttribute("data-variant", "stop");
    expect(go).toHaveAccessibleName("Go");
    expect(go).not.toHaveAttribute("aria-label");
    expect(go.className).toContain("h-[var(--hit)]");
  });

  it("keeps the desktop panel rows at --nav-row-child, not --hit", () => {
    setup({ platform: "desktop", activeTab: "Squad" });
    expect(navId("tab:Squad").className).toContain("min-h-[var(--nav-row-child)]");
    expect(navId("tab:Squad").className).not.toContain("min-h-[var(--hit)]");
  });
});

describe("Android group sheet", () => {
  const clubStop = () => navId("group:club");
  const sheet = () => screen.findByRole("dialog", { name: "Club" });
  const open = async () => {
    focus(clubStop());
    fireEvent.click(clubStop());
    return sheet();
  };

  it("names group stops as dialog openers and lists no section of them in the rail", () => {
    setup();
    for (const id of ["group:club", "group:market", "group:world"]) {
      expect(navId(id)).toHaveAttribute("aria-haspopup", "dialog");
      expect(navId(id)).toHaveAttribute("aria-expanded", "false");
    }
    expect(navId("tab:Home")).not.toHaveAttribute("aria-haspopup");
  });

  it("opens the group's sections in a modal dialog named after the group, without navigating", async () => {
    const { props } = setup();
    const dialog = await open();
    expect(clubStop()).toHaveAttribute("aria-expanded", "true");
    const list = within(dialog).getByRole("group", { name: "Club sections" });
    expect(within(list).getAllByRole("button").map((b) => b.textContent?.trim())).toEqual([
      "Squad", "Tactics", "Training", "Scrims", "SoloQ", "Meta", "Staff", "Scouting", "Academy", "Finances",
    ]);
    expect(props.onNavClick).not.toHaveBeenCalled();
    // The dialog is modal, so the rail behind it is hidden from assistive tech; there is still only one nav.
    expect(screen.getAllByRole("navigation", { hidden: true })).toHaveLength(1);
  });

  it("marks the section in use and lands focus on it", async () => {
    setup({ activeTab: "Training" });
    const dialog = await open();
    const current = within(dialog).getByRole("button", { name: "Training" });
    expect(current).toHaveAttribute("aria-current", "page");
    expect(within(dialog).getAllByRole("button").filter((b) => b.hasAttribute("aria-current"))).toHaveLength(1);
    await waitFor(() => expect(current).toHaveFocus());
  });

  it("lands focus on the last section used in the group when the open page is elsewhere", async () => {
    useNavMemoryStore.getState().rememberTab("Scouting");
    setup({ activeTab: "Home" });
    const dialog = await open();
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Scouting" })).toHaveFocus());
  });

  it("walks the sections with the arrow keys, the rail's own keyboard model", async () => {
    setup({ activeTab: "Squad" });
    const dialog = await open();
    const squad = within(dialog).getByRole("button", { name: "Squad" });
    await waitFor(() => expect(squad).toHaveFocus());
    press(squad, "ArrowDown");
    expect(within(dialog).getByRole("button", { name: "Tactics" })).toHaveFocus();
    press(within(dialog).getByRole("button", { name: "Tactics" }), "End");
    expect(within(dialog).getByRole("button", { name: "Finances" })).toHaveFocus();
  });

  it("navigates and closes when a section is chosen, once the sheet has closed", async () => {
    const onSheetNavigate = vi.fn();
    const { props } = setup({ onSheetNavigate });
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole("button", { name: "Tactics" }));
    await waitFor(() => expect(onSheetNavigate).toHaveBeenCalledWith("Tactics"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(props.onNavClick).not.toHaveBeenCalled();
    expect(clubStop()).toHaveAttribute("aria-expanded", "false");
  });

  it("falls back to onNavClick when the owner gives no sheet handler", async () => {
    const { props } = setup();
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole("button", { name: "Meta" }));
    await waitFor(() => expect(props.onNavClick).toHaveBeenCalledWith("Meta"));
  });

  it("closes on Escape and returns focus to the stop that opened it", async () => {
    setup();
    const dialog = await open();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(clubStop()).toHaveFocus());
  });

  it("closes on the Close button and returns focus to the stop", async () => {
    setup();
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(clubStop()).toHaveFocus());
  });

  it("closes on the system Back, through the shared dismisser, and returns focus to the stop", async () => {
    setNativeBackRegistered(true);
    setup();
    await open();
    expect(act(() => dismissOverlayWithBack())).toBeDefined();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(clubStop()).toHaveFocus());
    expect(dismissOverlayWithBack()).toBe(false);
  });

  it("opens Market's two and World's five sections the same way", async () => {
    setup();
    fireEvent.click(navId("group:market"));
    const market = await screen.findByRole("dialog", { name: "Market" });
    expect(
      within(within(market).getByRole("group", { name: "Market sections" }))
        .getAllByRole("button")
        .map((b) => b.textContent?.trim()),
    ).toEqual(["Market", "Transfers"]);
    fireEvent.keyDown(market, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(navId("group:world"));
    const world = await screen.findByRole("dialog", { name: "World" });
    expect(within(world).getByRole("group", { name: "World sections" })).toBeInTheDocument();
  });

  it("navigates at once from a direct stop and opens no sheet", () => {
    const { props } = setup();
    fireEvent.click(navId("tab:Inbox"));
    expect(props.onNavClick).toHaveBeenCalledWith("Inbox");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("makes Go the tab stop while News, Social or Manager is open, since no stop is current", () => {
    for (const activeTab of ["News", "Social", "Manager"]) {
      const { unmount } = setup({ activeTab });
      expect(navId("util:go")).toHaveAttribute("tabindex", "0");
      for (const el of document.querySelectorAll<HTMLElement>('[data-slot="rail-item"]')) {
        expect(el, `${activeTab} ${el.dataset.navId}`).not.toHaveAttribute("aria-current");
      }
      unmount();
    }
  });

  it("hides Club for an unemployed manager: six stops", () => {
    setup({ isUnemployed: true });
    expect(navId("group:club")).toBeNull();
    expect(document.querySelectorAll('[data-slot="rail-item"], [data-slot="go-button"]')).toHaveLength(6);
  });
});
