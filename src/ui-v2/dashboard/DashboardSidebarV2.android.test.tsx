import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  return { props, rerender };
}

const navId = (id: string) => document.querySelector<HTMLElement>(`[data-nav-id="${id}"]`)!;
const focus = (el: HTMLElement) => act(() => el.focus());
const press = (el: HTMLElement, key: string) => fireEvent.keyDown(el, { key });
const openMore = async () => {
  focus(navId("util:more"));
  press(navId("util:more"), "Enter");
  return screen.findAllByRole("menuitem");
};

beforeEach(() => useNavMemoryStore.getState().resetNavMemory());

describe("Android rail", () => {
  it("is always Split, whatever the size or the mode asked for", () => {
    setup({ railMode: "tree", railSlot: { slotW: 5000, slotH: 5000, need: 622, rootPx: 9 } });
    expect(document.querySelector('[data-slot="rail"]')).toHaveAttribute("data-rail-mode", "split");
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
  });

  it("has eight stops: Go, Home, Inbox, Schedule, Club, Market, World and More (R32)", () => {
    setup();
    const ids = [...document.querySelectorAll<HTMLElement>('[data-slot="rail-item"], [data-slot="go-button"]')].map(
      (e) => e.dataset.navId,
    );
    expect(ids).toEqual([
      "util:go", "tab:Home", "tab:Inbox", "tab:Schedule", "group:club", "group:market", "group:world", "util:more",
    ]);
    expect(navId("tab:News")).toBeNull();
    expect(document.querySelector('[data-slot="rail-cluster"]')).toBeNull();
  });

  it("sizes every stop to the touch --hit in height and width", () => {
    setup();
    for (const el of document.querySelectorAll<HTMLElement>('[data-slot="rail-item"]')) {
      expect(el.className, el.dataset.navId).toContain("min-h-[var(--hit)]");
      expect(el.className, el.dataset.navId).toContain("min-w-[var(--hit)]");
    }
  });

  it("keeps the labels visible whatever the height: touch has no hover tip", () => {
    setup({ railSlot: { slotW: 915, slotH: 200, need: 622, rootPx: 9 } });
    for (const el of document.querySelectorAll<HTMLElement>('[data-slot="rail-item"]')) {
      expect(el.querySelector('[data-slot="rail-item-label"]'), el.dataset.navId).not.toBeNull();
      expect(el.className).not.toContain("h-[var(--nav-cell)]");
    }
  });

  it("sizes the panel rows to --hit (ruling R1), scrolls it with the fade cues, and pads it by the safe area", () => {
    setup({ activeTab: "Squad" });
    const panel = document.querySelector<HTMLElement>('[data-slot="rail-panel"]')!;
    const rows = within(panel).getAllByRole("button");
    expect(rows).toHaveLength(10);
    for (const row of rows) {
      expect(row.className).toContain("min-h-[var(--hit)]");
      expect(row.className).not.toContain("min-h-[var(--nav-cell)]");
    }
    const scroller = panel.querySelector<HTMLElement>('[data-slot="rail-panel-scroll"]')!;
    expect(scroller.className).toContain("overflow-y-auto");
    expect(scroller.style.maskImage).toContain("linear-gradient");
    expect(scroller.className).toContain("pb-[var(--safe-bottom)]");
    expect(panel.className).toContain("w-[var(--nav-panel-w)]");
  });

  it("answers type-ahead on the Go stop, named by its visible text (R90)", () => {
    setup();
    act(() => navId("tab:Home").focus());
    fireEvent.keyDown(navId("tab:Home"), { key: "g" });
    expect(navId("util:go")).toHaveFocus();
  });

  it("pads the rail 4 px top and bottom so eight 48 px stops need exactly 392 px (R32)", () => {
    setup();
    expect(document.querySelector('[data-slot="rail-column"]')!.className).toContain("py-[4px]");
  });

  it("shows Go as a labelled stop at the touch hit, named by its visible “Go” (R40)", () => {
    setup();
    const go = navId("util:go");
    expect(go).toHaveAttribute("data-variant", "stop");
    expect(go).toHaveAccessibleName("Go");
    expect(go).not.toHaveAttribute("aria-label");
    expect(go.className).toContain("min-h-[var(--hit)]");
  });

  it("keeps the desktop panel rows at --nav-row-child, not --hit", () => {
    setup({ platform: "desktop", activeTab: "Squad" });
    expect(navId("tab:Squad").className).toContain("min-h-[var(--nav-row-child)]");
    expect(navId("tab:Squad").className).not.toContain("min-h-[var(--hit)]");
  });

  it("shows the panel's fade cue at 915x412: Club's ten 48 px rows need 520 px of 412", () => {
    const needed = 28 + 10 * 48 + 12; // header, ten --hit rows, padding
    expect(needed).toBe(520);
    const size = (name: "scrollHeight" | "clientHeight", value: number) =>
      vi.spyOn(HTMLElement.prototype, name, "get").mockImplementation(function (this: HTMLElement) {
        return this.dataset.slot === "rail-panel-scroll" ? value : 0;
      });
    const heights = [size("scrollHeight", needed - 28), size("clientHeight", 412 - 28)];
    setup({ activeTab: "Squad" });
    const scroller = document.querySelector<HTMLElement>('[data-slot="rail-panel-scroll"]')!;
    expect(scroller).toHaveAttribute("data-overflow-bottom", "true");
    expect(scroller).not.toHaveAttribute("data-overflow-top");
    // The mask itself comes from the same state; jsdom drops the calc() gradient, so the attribute is the check.
    for (const h of heights) h.mockRestore();
  });
});

describe("Android More menu", () => {
  it("lists News, Social, Settings, Report bug, Exit and Manager, six items at --hit", async () => {
    setup();
    const items = await openMore();
    expect(items.map((i) => i.textContent?.trim())).toEqual([
      "News", "Social", "Settings", "Report bug", "Exit", "Manager profile",
    ]);
    for (const item of items) expect(item.className).toContain("min-h-[var(--hit)]");
  });

  it("shows the highlighted item with the rail's inset focus ring, not a wash alone", async () => {
    setup();
    const items = await openMore();
    for (const item of items) {
      for (const cls of ["data-[highlighted]:ring-[3px]", "data-[highlighted]:ring-inset", "data-[highlighted]:ring-ring"]) {
        expect(item.className, cls).toContain(cls);
      }
      expect(item.className).toContain("data-[highlighted]:bg-muted"); // the wash stays as a second cue
    }
  });

  it("names the stop More and says it opens a menu", async () => {
    setup();
    expect(navId("util:more")).toHaveAccessibleName("More");
    expect(navId("util:more")).toHaveAttribute("aria-haspopup", "menu");
    expect(navId("util:more")).toHaveAttribute("aria-expanded", "false");
    await openMore();
    expect(navId("util:more")).toHaveAttribute("aria-expanded", "true");
  });

  it("closes on Escape and returns focus to More", async () => {
    setup();
    await openMore();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await waitFor(() => expect(navId("util:more")).toHaveFocus());
  });

  it("runs each item and closes the menu", async () => {
    const { props } = setup();
    let items = await openMore();
    fireEvent.click(items[0]);
    expect(props.onNavClick).toHaveBeenLastCalledWith("News");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

    items = await openMore();
    fireEvent.click(items[1]);
    expect(props.onNavClick).toHaveBeenLastCalledWith("Social");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

    items = await openMore();
    fireEvent.click(items[2]);
    expect(props.onNavigateSettings).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

    items = await openMore();
    fireEvent.click(items[4]);
    expect(props.onExitClick).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

    items = await openMore();
    fireEvent.click(items[5]);
    expect(props.onNavClick).toHaveBeenLastCalledWith("Manager");
  });

  it("opens the bug report from the menu", async () => {
    setup();
    const items = await openMore();
    fireEvent.click(items[3]);
    expect(await screen.findByRole("dialog", { name: "Bug report" })).toBeInTheDocument();
  });

  it("marks More current while the active tab is News, Social or Manager", () => {
    const { rerender } = setup({ activeTab: "News" });
    expect(navId("util:more")).toHaveAttribute("aria-current", "page");
    rerender({ activeTab: "Manager" });
    expect(navId("util:more")).toHaveAttribute("aria-current", "page");
    rerender({ activeTab: "Home" });
    expect(navId("util:more")).not.toHaveAttribute("aria-current");
  });

  it("keeps More in the roving widget: Down from World reaches it", () => {
    setup();
    focus(navId("group:world"));
    press(navId("group:world"), "ArrowDown");
    expect(navId("util:more")).toHaveFocus();
    // Go is the first stop (R32), so Down from More wraps to it.
    press(navId("util:more"), "ArrowDown");
    expect(navId("util:go")).toHaveFocus();
  });
});
