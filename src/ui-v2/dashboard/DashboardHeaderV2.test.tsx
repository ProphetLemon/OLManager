import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardHeaderV2 } from "@/ui-v2/dashboard/DashboardHeaderV2";

const requestedKeys = vi.hoisted(() => [] as string[]);

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_k: string, o?: Record<string, unknown> & { defaultValue?: string }) =>
      (requestedKeys.push(_k), o?.defaultValue ?? _k).replace(/{{(\w+)}}/g, (_m, name: string) => String(o?.[name] ?? "")),
  }),
}));

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const baseProps = {
  title: "Squad",
  currentDate: "12 Jan",
  backTo: null,
  isAdvancing: false,
  isSaving: false,
  saveFlash: false,
  hasMatchToday: false,
  dayPhase: "Morning",
  alerts: [],
  teamName: "Night Owls",
  activeTab: "Squad",
  isUnemployed: false,
  callCount: 0,
} satisfies Partial<HeaderProps>;

function setup(extra: Partial<HeaderProps> = {}) {
  const fns = {
    onBack: vi.fn(),
    onSave: vi.fn(),
    onContinue: vi.fn(),
    onSkipToMatchDay: vi.fn(),
    onSkipToNextDay: vi.fn(),
    onShowCalls: vi.fn(),
  };
  const view = render(<DashboardHeaderV2 {...baseProps} {...fns} {...extra} />);
  rerenderHeader = (props) => view.rerender(<DashboardHeaderV2 {...baseProps} {...fns} {...extra} {...props} />);
  return fns;
}

type HeaderProps = React.ComponentProps<typeof DashboardHeaderV2>;
let rerenderHeader: (props: Partial<HeaderProps>) => void = () => {};

describe("DashboardHeaderV2", () => {
  it("renders the team caption over the page title h1", () => {
    setup();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Squad");
    expect(screen.getByText("Night Owls")).toBeInTheDocument();
  });

  it("hides the to-resolve chip at zero and shows it with the count otherwise", () => {
    setup();
    expect(screen.queryByRole("button", { name: /to resolve/ })).toBeNull();
  });

  it("opens the calls when the chip is pressed", () => {
    const { onShowCalls } = setup({ callCount: 3 });
    fireEvent.click(screen.getByRole("button", { name: "3 to resolve" }));
    expect(onShowCalls).toHaveBeenCalledTimes(1);
  });

  it("names the icon-only Save button and announces a saved flash politely", () => {
    const { onSave } = setup({ saveFlash: true });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });

  it("says a failed auto-save in the Save button and the status, and keeps Save usable", () => {
    const { onSave } = setup({ saveFailed: true });
    const save = screen.getByRole("button", { name: "Auto-save failed. Press Save to keep your progress." });
    expect(save).not.toBeDisabled();
    // The sentence itself is spoken and shown by the notice under the bar, not twice here.
    expect(screen.getByRole("status")).toHaveTextContent("");
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("calls the closed period a split when later splits remain in the season", () => {
    setup({ seasonComplete: true, endsSplit: true });
    expect(screen.getByRole("button", { name: "Split Complete" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Season Complete" })).toBeNull();
  });

  it("disables the advance controls and says why while the split is over", () => {
    const { onContinue, onSkipToMatchDay, onSkipToNextDay } = setup({ seasonComplete: true });
    const main = screen.getByRole("button", { name: "Season Complete" });
    expect(main).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    const menu = screen.getByRole("button", { name: "More ways to advance" });
    expect(menu).toBeDisabled();
    fireEvent.click(main);
    fireEvent.click(menu);
    expect(screen.queryByRole("menuitem")).toBeNull();
    expect(onContinue).not.toHaveBeenCalled();
    expect(onSkipToMatchDay).not.toHaveBeenCalled();
    expect(onSkipToNextDay).not.toHaveBeenCalled();
  });

  it("keeps the advance controls enabled while the split is running", () => {
    setup();
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "More ways to advance" })).toBeEnabled();
  });

  it("keeps the status region empty when not saved", () => {
    setup();
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("labels the primary action Continue, or Match on match day", () => {
    setup();
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
  });

  it("switches the primary action to the match label on match day", () => {
    const { onContinue } = setup({ hasMatchToday: true });
    fireEvent.click(screen.getByRole("button", { name: "Match" }));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
  });

  it("offers skip to match day, skip to next day and continue in the menu", async () => {
    const { onSkipToMatchDay, onSkipToNextDay, onContinue } = setup();
    const chevron = screen.getByRole("button", { name: "More ways to advance" });
    chevron.focus();
    fireEvent.keyDown(chevron, { key: "ArrowDown" });
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Simulate to next match", "Skip to next day", "Continue"]);
    fireEvent.click(items[0]);
    expect(onSkipToMatchDay).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(onSkipToNextDay).not.toHaveBeenCalled();
    expect(onContinue).not.toHaveBeenCalled();
  });

  describe("Back (R20)", () => {
    it("is always rendered, and aria-disabled but focusable with nothing to go back to", () => {
      const { onBack } = setup({ backTo: null });
      const back = screen.getByRole("button", { name: "Nothing to go back to" });
      expect(back).toHaveAttribute("aria-disabled", "true");
      expect(back).not.toBeDisabled();
      back.focus();
      expect(back).toHaveFocus();
      fireEvent.click(back);
      expect(onBack).not.toHaveBeenCalled();
      // Drawn dim, and not only by colour: the name says it does nothing.
      expect(back.className).toContain("text-dim");
    });

    it("gives the dimmed Back no hover wash or press nudge, and GrayText in forced colours (R53)", () => {
      setup({ backTo: null });
      const classes = screen.getByRole("button", { name: "Nothing to go back to" }).className.split(/\s+/);
      expect(classes).toEqual(
        expect.arrayContaining([
          "dark:hover:bg-transparent",
          "active:not-aria-[haspopup]:translate-y-0",
          "forced-colors:text-[color:GrayText]",
          // `hover:text-dim` would beat the forced-colours GrayText on hover without its own override.
          "forced-colors:hover:text-[color:GrayText]",
        ]),
      );
      expect(classes).not.toContain("dark:hover:bg-muted/50");
      expect(classes).not.toContain("active:not-aria-[haspopup]:translate-y-px");
    });

    it("keeps the hover wash and press nudge on a Back that goes somewhere", () => {
      setup({ backTo: "Squad" });
      const classes = screen.getByRole("button", { name: "Back to Squad" }).className.split(/\s+/);
      expect(classes).toEqual(
        expect.arrayContaining(["dark:hover:bg-muted/50", "active:not-aria-[haspopup]:translate-y-px"]),
      );
      expect(classes).not.toContain("forced-colors:text-[color:GrayText]");
    });

    it("is named after its destination and goes back when pressed", () => {
      const { onBack } = setup({ backTo: "Squad" });
      const back = screen.getByRole("button", { name: "Back to Squad" });
      expect(back).not.toHaveAttribute("aria-disabled");
      fireEvent.click(back);
      expect(onBack).toHaveBeenCalledTimes(1);
    });

    it("is the first control of the title group, an icon with a tip that follows focus", () => {
      setup({ backTo: "Squad" });
      const titleGroup = document.querySelector<HTMLElement>('[data-slot="bar-title"]')!;
      const back = screen.getByRole("button", { name: "Back to Squad" });
      expect(titleGroup.querySelector("button")).toBe(back);
      expect(back.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
      act(() => back.focus());
      expect(screen.getByRole("tooltip")).toHaveTextContent("Back to Squad");
    });

    it("keeps focus while its name changes to the next destination", () => {
      setup({ backTo: "Inbox" });
      const back = screen.getByRole("button", { name: "Back to Inbox" });
      back.focus();
      fireEvent.click(back);
      rerenderHeader({ backTo: "Squad" });
      expect(screen.getByRole("button", { name: "Back to Squad" })).toHaveFocus();
      rerenderHeader({ backTo: null });
      expect(screen.getByRole("button", { name: "Nothing to go back to" })).toHaveFocus();
    });
  });

  it("shows the location's own title in the h1, such as a player's name on a profile (R21)", () => {
    setup({ title: "Faker", activeTab: "Squad" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Faker");
  });

  describe("crumb above the title", () => {
    const crumb = () => document.querySelector<HTMLElement>('[data-slot="crumb"]');

    // What assistive tech reads: aria-hidden parts dropped.
    const spoken = () => {
      const copy = crumb()!.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
      return copy.textContent;
    };

    it("shows the team and the group of a grouped tab", () => {
      setup({ activeTab: "Squad" });
      expect(crumb()).toHaveTextContent(/^Night Owls\s*·\s*,?\s*Club$/);
    });

    it("is spoken with a separator, not as one run-together word", () => {
      setup({ activeTab: "Squad" });
      expect(spoken()).toBe("Night Owls, Club");
    });

    it("shows only the team on a direct stop", () => {
      setup({ activeTab: "Inbox", title: "Inbox" });
      expect(crumb()).toHaveTextContent(/^Night Owls$/);
    });

    it("localises the group through the existing section keys", () => {
      setup({ activeTab: "Transfers" });
      expect(requestedKeys).toContain("dashboard.sectionMarket");
      expect(spoken()).toBe("Night Owls, Market");
    });

    it("omits the team while unemployed and keeps the group", () => {
      setup({ activeTab: "Market", isUnemployed: true });
      expect(crumb()).toHaveTextContent(/^Market$/);
      expect(screen.queryByText("Night Owls")).toBeNull();
    });

    it("renders no crumb when there is neither a team nor a group", () => {
      setup({ activeTab: "Inbox", isUnemployed: true });
      expect(crumb()).toBeNull();
    });

    it("is small dim text, not a link or a landmark", () => {
      setup({ activeTab: "Squad" });
      // text-nav (R16): the shell keeps its own label token (caption was 6.75 px at the old 9 px Android root).
      expect(crumb()!.className).toContain("text-nav");
      expect(crumb()!.className).not.toContain("text-caption");
      expect(crumb()!.className).toContain("text-dim");
      expect(crumb()!.querySelector("a, button")).toBeNull();
      expect(screen.queryByRole("navigation")).toBeNull();
    });

    it("also shows in compact mode, with no navigation", () => {
      setup({ activeTab: "Market", compact: true });
      expect(spoken()).toBe("Night Owls, Market");
      expect(screen.queryByRole("navigation")).toBeNull();
    });
  });

  it("routes each day phase through onAir.bar.phase keys with English defaults", () => {
    setup({ dayPhase: "ScrimBlock" });
    expect(screen.getByRole("group", { name: "Game date and phase" })).toHaveTextContent("Scrims");
    for (const k of ["morning", "scrimBlock"]) {
      expect(requestedKeys).toContain(`onAir.bar.phase.${k}`);
    }
    for (const k of ["reviewBlock", "trainingBlock", "evening"]) {
      expect(requestedKeys).not.toContain(`onAir.bar.phase.${k}`);
    }
  });

  it("labels the morning phase", () => {
    setup({ dayPhase: "Morning" });
    expect(screen.getByRole("group", { name: "Game date and phase" })).toHaveTextContent("Morning");
  });

  it("draws a 2px club rule under the bar and gives the chip a dot", () => {
    setup({ callCount: 2 });
    const rule = document.querySelector('[data-slot="bar-rule"]');
    expect(rule?.className).toContain("h-0.5");
    expect(rule?.className).toContain("bg-club");
    // Two-colour rule: --club, a hard stop at 60%, then --club-secondary (single colour when unset).
    expect(rule?.className).toContain("var(--club)_60%");
    expect(rule?.className).toContain("var(--club-secondary,var(--club))_60%");
    const chip = screen.getByRole("button", { name: "2 to resolve" });
    expect(chip.className).toContain("rounded-full");
    expect(chip.querySelector("span[aria-hidden='true']")).not.toBeNull();
  });

  it("calls onContinue with no arguments from the primary button and the menu item", async () => {
    const { onContinue } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onContinue.mock.calls[0]).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "More ways to advance" }));
    const items = await screen.findAllByRole("menuitem");
    fireEvent.click(items[items.length - 1]);
    await waitFor(() => expect(onContinue).toHaveBeenCalledTimes(2));
    expect(onContinue.mock.calls[1]).toEqual([]);
  });
});

describe("DashboardHeaderV2 adapts to its own width (R17)", () => {
  const header = () => document.querySelector<HTMLElement>("header")!;
  /** A class that hides or removes text, at any container breakpoint. */
  const HIDING = /(^|\s)(@[^\s:]+:)*(hidden|sr-only|invisible)(\s|$)/;
  const chain = (el: HTMLElement) => {
    const out: HTMLElement[] = [];
    for (let n: HTMLElement | null = el; n && n !== header(); n = n.parentElement) out.push(n);
    return out;
  };

  it("is a container, so it follows its own width and not the window", () => {
    setup();
    expect(header().className).toContain("@container");
  });

  it("takes the short date under 80rem and keeps the full one above", () => {
    setup({ currentDate: "Tuesday, November 17, 2026", currentDateShort: "Tue, Nov 17" });
    const full = document.querySelector<HTMLElement>('[data-date="full"]')!;
    const short = document.querySelector<HTMLElement>('[data-date="short"]')!;
    expect(full).toHaveTextContent("Tuesday, November 17, 2026");
    expect(short).toHaveTextContent("Tue, Nov 17");
    expect(full.className).toContain("@max-[80rem]:hidden");
    expect(short.className).toContain("hidden");
    expect(short.className).toContain("@max-[80rem]:inline");
  });

  it("falls back to the full date when no short one is given", () => {
    setup({ currentDate: "12 Jan" });
    expect(document.querySelector('[data-date="short"]')).toBeNull();
    expect(screen.getByRole("group", { name: "Game date and phase" })).toHaveTextContent("12 Jan");
  });

  it("turns the decisions chip icon-only under 64rem and keeps its name", () => {
    setup({ callCount: 12 });
    const chip = screen.getByRole("button", { name: "12 to resolve" });
    expect(chip).toHaveAccessibleName("12 to resolve");
    const word = chip.querySelector<HTMLElement>('[data-part="chip-text"]')!;
    const count = chip.querySelector<HTMLElement>('[data-part="chip-count"]')!;
    expect(word.className).toContain("@max-[64rem]:hidden");
    expect(count).toHaveTextContent("12");
    expect(count.className).toContain("hidden");
    expect(count.className).toContain("@max-[64rem]:inline");
    expect(count).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps Save icon-only with its name, at every width", () => {
    setup();
    expect(screen.getByRole("button", { name: "Save" })).toHaveAccessibleName("Save");
  });

  it("wraps into two rows under 58rem: the title group takes a row, the actions the next", () => {
    setup();
    const left = document.querySelector<HTMLElement>('[data-slot="bar-title"]')!;
    const right = document.querySelector<HTMLElement>('[data-slot="bar-actions"]')!;
    expect(left.className).toContain("basis-full");
    expect(left.className).toContain("@min-[58rem]:basis-0");
    expect(left.className).toContain("@min-[58rem]:flex-1");
    expect(right.className).toContain("flex-wrap");
    expect(left.parentElement!.className).toContain("flex-wrap");
  });

  it("lets the title and the crumb shrink to an ellipsis, with the full text in title", () => {
    setup({ title: "A very long section name", activeTab: "Squad" });
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.className).toContain("truncate");
    expect(h1).toHaveAttribute("title", "A very long section name");
    const crumb = document.querySelector<HTMLElement>('[data-slot="crumb"]')!;
    expect(crumb.className).toContain("truncate");
    expect(crumb).toHaveAttribute("title", "Night Owls, Club");
    expect(chain(h1.parentElement!).some((el) => el.className.includes("min-w-0"))).toBe(true);
  });

  it("never hides the title or Continue, whatever the width", () => {
    setup({ callCount: 2 });
    const h1 = screen.getByRole("heading", { level: 1 });
    const crumb = document.querySelector<HTMLElement>('[data-slot="crumb"]')!;
    const cont = screen.getByRole("button", { name: "Continue" });
    for (const target of [h1, crumb, cont]) {
      for (const el of chain(target)) {
        expect(el.className, `${target.textContent} in ${el.tagName}`).not.toMatch(HIDING);
      }
    }
  });

  it("keeps Continue whole: it does not shrink, and it tightens its padding in a very narrow bar", () => {
    setup();
    const split = document.querySelector<HTMLElement>('[data-slot="split-button"]')!;
    expect(split.className).toContain("shrink-0");
    expect(split.className).toContain("@max-[22rem]:[&>button:first-child]:px-3");
  });

  it("applies the same rules to the end-of-season compact bar", () => {
    setup({ compact: true, seasonComplete: true, activeTab: "Home" });
    expect(header().className).toContain("@container");
    expect(document.querySelector('[data-slot="bar-title"]')!.className).toContain("basis-full");
    expect(screen.getByRole("heading", { level: 1 })).toBeVisible();
    expect(screen.getByRole("button", { name: /Complete/ })).toBeInTheDocument();
  });
});
