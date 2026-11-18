import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { TFunction } from "i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CallItem } from "@/lib/dashboard/needsYourCall";
import type { DashboardLocation } from "@/lib/dashboard/profileNavigation";
import { usePaletteStore } from "@/store/paletteStore";
import { resetSessionNavigation } from "@/store/sessionReset";
import { translateFromEnglish } from "@/test-i18n";

import { GoPalette } from "./GoPalette";
import { buildPaletteIndex, type PaletteEntry, type PaletteIndexInput } from "./paletteIndex";
import { searchPalette } from "./paletteSearch";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translateFromEnglish, i18n: { language: "en" } }),
}));

const t = translateFromEnglish as unknown as TFunction;

const scrims: CallItem = {
  id: "blocker:scrims",
  kind: "blocker",
  severity: "hard",
  tagKey: "onAir.tags.blocker",
  tagTone: "negative",
  headline: "No scrims planned for Thursday",
  actionLabelKey: "onAir.calls.actions.openScrims",
  target: { tab: "Scrims" },
};
const renewal: CallItem = {
  id: "contract:p1",
  kind: "contract",
  severity: "soft",
  tagKey: "onAir.tags.contract",
  tagTone: "warning",
  headline: "Upset",
  actionLabelKey: "onAir.calls.actions.renew",
  target: { tab: "Squad", context: { playerId: "p1" } },
};
const at = (tab: string, over: Partial<DashboardLocation> = {}): DashboardLocation => ({
  tab,
  playerId: null,
  teamId: null,
  staffId: null,
  championKey: null,
  ...over,
});

const entries = buildPaletteIndex({
  callState: { decisionItems: [scrims, renewal] },
  recent: [at("Squad", { playerId: "p1" }), at("Inbox")],
  current: at("Home"),
  unemployed: false,
  scheduleCalendar: true,
  selectedCompetitionId: null,
  game: {
    manager: { team_id: "team-1" },
    user_competition_id: "lec",
    leagues: [{ id: "league-lec", competition_id: "lec" }],
    players: [{ id: "p1", match_name: "Upset", team_id: "team-1", position: "ADC", lol_ovr: 86 }],
    teams: [{ id: "team-1", name: "Fnatic" }],
    staff: [],
  } as unknown as PaletteIndexInput["game"],
  t,
});

const onActivate = vi.fn<(entry: PaletteEntry) => void>();

function Harness({
  platform = "desktop",
  rows = entries,
}: {
  platform?: "android" | "desktop";
  rows?: readonly PaletteEntry[];
}) {
  return (
    <>
      <button id="util:go" type="button">
        Go
      </button>
      <main id="main-content" tabIndex={-1}>
        content
      </main>
      <GoPalette entries={rows} callCount={2} platform={platform} onActivate={onActivate} />
    </>
  );
}

async function openPalette(platform: "android" | "desktop" = "desktop") {
  render(<Harness platform={platform} />);
  const go = screen.getByRole("button", { name: "Go" });
  act(() => go.focus());
  act(() => usePaletteStore.getState().openPalette("util:go"));
  const dialog = await screen.findByRole("dialog");
  // Base UI moves the initial focus a frame after the dialog mounts.
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  return dialog;
}

const input = () => screen.getByRole("combobox") as HTMLInputElement;
const options = () => screen.getAllByRole("option");
const activeOption = () => document.getElementById(input().getAttribute("aria-activedescendant") ?? "");
const type = (value: string) => fireEvent.change(input(), { target: { value } });
const press = (key: string, init: Record<string, unknown> = {}) => fireEvent.keyDown(input(), { key, ...init });
const status = () => screen.getByRole("status");

beforeEach(() => {
  usePaletteStore.getState().reset();
  onActivate.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  delete (HTMLElement.prototype as { getAnimations?: unknown }).getAnimations;
});

/** Gives every element an exit animation that never ends while `running()` holds, so a close stays in progress. */
function holdExitAnimations(running: () => boolean) {
  Object.defineProperty(HTMLElement.prototype, "getAnimations", {
    configurable: true,
    value: () => (running() ? [{ finished: new Promise(() => {}) }] : []),
  });
}

describe("GoPalette: the decisive ARIA tests (R25)", () => {
  it("is a modal dialog named Go to", async () => {
    const dialog = await openPalette();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Go to");
  });

  it("has a combobox named Go to, expanded, that controls the listbox (R44)", async () => {
    await openPalette();
    expect(input()).toHaveAccessibleName("Go to");
    expect(input()).toHaveAttribute("aria-expanded", "true");
    expect(input()).toHaveAttribute("aria-autocomplete", "list");
    expect(input().getAttribute("aria-controls")).toBe(screen.getByRole("listbox").id);
  });

  it("makes the first decision the active option on open, with focus in the input", async () => {
    await openPalette();
    expect(document.activeElement).toBe(input());
    expect(activeOption()).toBe(options()[0]);
    expect(options()[0]).toHaveAttribute("aria-selected", "true");
    expect(options()[0]).toHaveTextContent("Open scrims");
  });

  it("clears the query on Escape and stays open", async () => {
    await openPalette();
    type("sq");
    press("Escape");
    expect(input().value).toBe("");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes on Escape with an empty query and returns focus to the Go control", async () => {
    await openPalette();
    press("Escape");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(usePaletteStore.getState().open).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Go" })));
    expect(onActivate).not.toHaveBeenCalled();
  });
});

describe("GoPalette: keys, pointer and activation (spec §5.5, R27, R37)", () => {
  it("moves the active option with ArrowDown and ArrowUp, wrapping", async () => {
    await openPalette();
    press("ArrowDown");
    expect(activeOption()).toBe(options()[1]);
    expect(options()[0]).toHaveAttribute("aria-selected", "false");
    press("ArrowUp");
    press("ArrowUp");
    expect(activeOption()).toBe(options()[options().length - 1]);
  });

  it("jumps to the first Recent row with PageDown", async () => {
    await openPalette();
    press("PageDown");
    const recent = screen.getByRole("group", { name: "Recent" });
    expect(within(recent).getAllByRole("option")[0]).toBe(activeOption());
  });

  it("jumps back to the first row of the previous group with PageUp, and stays put in the first group", async () => {
    await openPalette();
    press("PageDown");
    press("PageDown");
    expect(activeOption()).toBe(within(screen.getByRole("group", { name: "Sections" })).getAllByRole("option")[0]);
    press("PageUp");
    expect(activeOption()).toBe(within(screen.getByRole("group", { name: "Recent" })).getAllByRole("option")[0]);
    press("PageUp");
    expect(activeOption()).toBe(options()[0]);
    press("PageUp");
    expect(activeOption()).toBe(options()[0]);
  });

  it("highlights the row under the pointer", async () => {
    await openPalette();
    fireEvent.mouseMove(options()[3], { clientX: 24, clientY: 160 });
    expect(activeOption()).toBe(options()[3]);
  });

  it("hands the active row to onActivate on Enter once it has closed, without returning focus to Go", async () => {
    await openPalette();
    type("competitions");
    const best = searchPalette(entries, "competitions", "en")[0];
    press("Enter");
    await waitFor(() => expect(onActivate).toHaveBeenCalledTimes(1));
    expect(onActivate).toHaveBeenCalledWith(best);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Go" }));
  });

  it("activates a row on click", async () => {
    await openPalette();
    fireEvent.click(options()[1]);
    await waitFor(() => expect(onActivate).toHaveBeenCalledWith(entries.find((e) => e.id === "call:contract:p1")));
  });

  it("does nothing on Enter with no option", async () => {
    await openPalette();
    type("zzzz");
    press("Enter");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("ignores Enter and Escape while an IME composes (R48)", async () => {
    await openPalette();
    type("sq");
    press("Enter", { isComposing: true });
    press("Escape", { keyCode: 229 });
    expect(input().value).toBe("sq");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("has two Tab stops, the input then Close, and no option among them", async () => {
    const dialog = await openPalette();
    const close = screen.getByRole("button", { name: "Close" });
    const stops = dialog.querySelectorAll('input, button, a[href], [tabindex]:not([tabindex="-1"])');
    expect(Array.from(stops)).toEqual([input(), close]);
    expect(screen.getAllByRole("option").every((o) => !o.hasAttribute("tabindex"))).toBe(true);
  });

  // jsdom has no sequential focus navigation, so these focus the guard that Tab or
  // Shift+Tab reaches past the last or first stop; Base UI's trap sends focus round.
  it("wraps Tab from Close round to the input", async () => {
    const dialog = await openPalette();
    act(() => screen.getByRole("button", { name: "Close" }).focus());
    const after = dialog.nextElementSibling as HTMLElement;
    expect(after).toHaveAttribute("data-base-ui-focus-guard");
    act(() => after.focus());
    await waitFor(() => expect(document.activeElement).toBe(input()));
  });

  it("wraps Shift+Tab from the input round to Close", async () => {
    const dialog = await openPalette();
    expect(document.activeElement).toBe(input());
    const before = dialog.previousElementSibling as HTMLElement;
    expect(before).toHaveAttribute("data-base-ui-focus-guard");
    act(() => before.focus());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" })));
  });

  it("keeps the query and the palette on an Escape that belongs to an IME composition (R48)", async () => {
    await openPalette();
    type("sq");
    press("Escape", { isComposing: true });
    expect(input().value).toBe("sq");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes when the session resets, on a new game, a load or an exit (R22)", async () => {
    await openPalette();
    act(() => resetSessionNavigation());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("closes from the Close button and returns focus to Go", async () => {
    await openPalette();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Go" })));
  });

  it("closes on popstate, the Android back gesture", async () => {
    await openPalette();
    act(() => window.dispatchEvent(new PopStateEvent("popstate")));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("GoPalette: status, empty state and rows (R45, R48)", () => {
  it("says nothing on open, and the results count 300 ms after typing", async () => {
    await openPalette();
    expect(status()).toHaveTextContent("");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    type("s");
    const count = searchPalette(entries, "s", "en").length;
    expect(count).toBeGreaterThan(1);
    act(() => vi.advanceTimersByTime(299));
    expect(status()).toHaveTextContent("");
    act(() => vi.advanceTimersByTime(1));
    expect(status()).toHaveTextContent(`${count} results`);
  });

  it("shows and says the empty state, collapsed, with no active option (R45)", async () => {
    await openPalette();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    type("zzzz");
    expect(screen.getByText("No matches for “zzzz”")).toBeInTheDocument();
    expect(input()).toHaveAttribute("aria-expanded", "false");
    expect(input()).not.toHaveAttribute("aria-activedescendant");
    expect(input()).not.toHaveAttribute("aria-controls");
    act(() => vi.advanceTimersByTime(300));
    expect(status()).toHaveTextContent("No matches for “zzzz”");
  });

  it("groups the rows under named groups, Needs your call with its count", async () => {
    await openPalette();
    const groups = screen.getAllByRole("group");
    expect(groups).toHaveLength(3);
    expect(groups[0]).toBe(screen.getByRole("group", { name: "Needs your call, 2" }));
    expect(groups[1]).toBe(screen.getByRole("group", { name: "Recent" }));
    expect(groups[2]).toBe(screen.getByRole("group", { name: "Sections" }));
  });

  it("hides the separators from screen readers and gives rows no title (R48)", async () => {
    await openPalette();
    const call = options()[0];
    const seps = Array.from(call.querySelectorAll('[aria-hidden="true"]')).map((s) => s.textContent);
    expect(seps).toEqual(expect.arrayContaining(["›", "·"]));
    expect(call).not.toHaveAttribute("title");
    expect(within(call).getByText("Blocker")).toBeInTheDocument();
  });
});

describe("GoPalette on Android (R29, R39)", () => {
  it("puts focus on the title, not the input, so no keyboard rises", async () => {
    await openPalette("android");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Go to" })));
    expect(input()).toHaveAttribute("inputmode", "search");
    expect(input()).toHaveAttribute("enterkeyhint", "go");
  });

  it("sizes the options with the palette row token, var(--hit) on Android", async () => {
    await openPalette("android");
    expect(options()[0]).toHaveClass("min-h-[var(--palette-row)]");
  });
});

describe("GoPalette: one activation per close (code review)", () => {
  it("runs an activated row once, and a later reopen and dismissal run nothing", async () => {
    await openPalette();
    press("Enter");
    await waitFor(() => expect(onActivate).toHaveBeenCalledTimes(1));
    act(() => usePaletteStore.getState().openPalette("util:go"));
    await screen.findByRole("dialog");
    press("Escape");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("drops a row whose close a reopening interrupted, so the next dismissal runs nothing", async () => {
    await openPalette();
    let exiting = true;
    holdExitAnimations(() => exiting);
    press("Enter");
    // Reopened while the activated close still animates: that close never completes.
    act(() => usePaletteStore.getState().openPalette("util:go"));
    exiting = false;
    press("Escape");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("keeps its rows while it closes, though the caller drops the index (lazy build)", async () => {
    const view = render(<Harness />);
    act(() => usePaletteStore.getState().openPalette("util:go"));
    await screen.findByRole("dialog");
    holdExitAnimations(() => true);
    press("Escape");
    view.rerender(<Harness rows={[]} />);
    expect(document.querySelector('[data-slot="go-palette-empty"]')).toBeNull();
    expect(document.querySelectorAll('[role="option"]').length).toBeGreaterThan(0);
  });
});

describe("GoPalette: accessibility audit (R74-R84)", () => {
  it("names each option after its row, so a re-filter that changes the active row changes aria-activedescendant (R74)", async () => {
    await openPalette();
    type("inbox");
    const inbox = input().getAttribute("aria-activedescendant");
    expect(activeOption()).toHaveTextContent(/inbox/i);
    type("scrims");
    expect(activeOption()).toHaveTextContent(/scrims/i);
    expect(input().getAttribute("aria-activedescendant")).not.toBe(inbox);
    expect(activeOption()).toBe(options()[0]);
  });

  it("writes the active row's secondary text in the foreground, over the club wash (R75)", async () => {
    await openPalette();
    const secondary = (option: HTMLElement) => option.querySelector('[data-slot="palette-option-secondary"]');
    const [first, ...rest] = options().filter((o) => secondary(o));
    expect(first).toBe(activeOption());
    expect(secondary(first)).toHaveClass("text-foreground");
    expect(secondary(first)).not.toHaveClass("text-muted-foreground");
    for (const row of rest) expect(secondary(row)).toHaveClass("text-muted-foreground");
  });

  it("draws the active bar in the club text colour, as the rail does (R76)", async () => {
    await openPalette();
    const bars = document.querySelectorAll('[data-slot="palette-option-bar"]');
    expect(bars).toHaveLength(1);
    expect(activeOption()?.contains(bars[0])).toBe(true);
    expect(bars[0]).toHaveClass("bg-club-text");
    expect(bars[0]).not.toHaveClass("bg-club");
  });

  it("keeps a transparent outline on the input, which forced colours paint as its focus indicator (R77)", async () => {
    await openPalette();
    // Tailwind 4: outline-none is outline-style none; outline-hidden keeps a transparent
    // outline that forced-colours mode shows, where the box-shadow ring is dropped.
    expect(input()).toHaveClass("outline-hidden", "focus-visible:ring-2");
    expect(input()).not.toHaveClass("outline-none");
  });

  it("places the desktop panel from the --palette-top token, which a short window lowers (R80)", async () => {
    const dialog = await openPalette();
    expect(dialog).toHaveClass("top-[var(--palette-top)]", "max-h-[var(--palette-h)]");
  });

  it("ignores a mousemove whose pointer has not moved, as a browser sends after a scroll (R78)", async () => {
    await openPalette();
    fireEvent.mouseMove(options()[1], { clientX: 40, clientY: 120 });
    expect(activeOption()).toBe(options()[1]);
    press("ArrowDown");
    expect(activeOption()).toBe(options()[2]);
    // The list scrolled under the parked pointer: the same point, now over another row.
    fireEvent.mouseMove(options()[3], { clientX: 40, clientY: 120 });
    expect(activeOption()).toBe(options()[2]);
    // A move over the active row counts as the last position too.
    fireEvent.mouseMove(options()[2], { clientX: 40, clientY: 132 });
    press("ArrowDown");
    fireEvent.mouseMove(options()[4], { clientX: 40, clientY: 132 });
    expect(activeOption()).toBe(options()[3]);
    // A real move highlights again.
    fireEvent.mouseMove(options()[4], { clientX: 41, clientY: 140 });
    expect(activeOption()).toBe(options()[4]);
  });

  it("counts the call rows the query keeps, after a pause in the group's name (R81)", async () => {
    await openPalette();
    expect(screen.getByRole("group", { name: "Needs your call, 2" })).toBeInTheDocument();
    type("scrims");
    const calls = screen.getByRole("group", { name: "Needs your call, 1" });
    expect(within(calls).getAllByRole("option")).toHaveLength(1);
    // Sighted users see the number after a space; the comma is for screen readers only.
    const label = document.getElementById(calls.getAttribute("aria-labelledby") ?? "");
    expect(label?.querySelector(".tabular-nums")).toHaveTextContent(/^1$/);
  });

  it("wraps a long secondary line onto a second line rather than cutting it at once (R83)", async () => {
    await openPalette();
    const lines = document.querySelectorAll('[data-slot="palette-option-secondary"]');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toHaveClass("line-clamp-2");
      expect(line).not.toHaveClass("truncate");
    }
  });

  it("says there is nothing to go to when nothing is indexed and nothing is typed (R84)", async () => {
    render(<Harness rows={[]} />);
    act(() => usePaletteStore.getState().openPalette("util:go"));
    await screen.findByRole("dialog");
    const empty = () => document.querySelector('[data-slot="go-palette-empty"]');
    expect(empty()).toHaveTextContent(/^Nothing to go to$/);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    type("zz");
    expect(empty()).toHaveTextContent("No matches for “zz”");
    type("");
    act(() => vi.advanceTimersByTime(300));
    expect(empty()).toHaveTextContent(/^Nothing to go to$/);
    expect(status()).toHaveTextContent(/^Nothing to go to$/);
  });
});

// R79: the app routes the Android back gesture through webview history (wry's
// WryActivity calls goBack, which raises popstate) and pushes no entry of its own
// anywhere, so the palette closes on that same popstate and adds no sentinel.
describe("GoPalette: back and history (R79)", () => {
  const HISTORY_METHODS = ["pushState", "replaceState", "back", "forward", "go"] as const;

  it("closes on back without consuming it, so DashboardV2's own popstate handler still runs", async () => {
    const appHandler = vi.fn();
    window.addEventListener("popstate", appHandler);
    try {
      await openPalette();
      act(() => window.dispatchEvent(new PopStateEvent("popstate")));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(appHandler).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("popstate", appHandler);
    }
  });

  it.each(["Escape", "Close", "an activation"])("leaves history as it was when it opens and closes by %s", async (how) => {
    const spies = HISTORY_METHODS.map((method) => vi.spyOn(window.history, method));
    const { length, state } = window.history;
    try {
      await openPalette();
      if (how === "Escape") press("Escape");
      else if (how === "Close") fireEvent.click(screen.getByRole("button", { name: "Close" }));
      else press("Enter");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      if (how === "an activation") await waitFor(() => expect(onActivate).toHaveBeenCalledTimes(1));
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      expect(window.history.length).toBe(length);
      expect(window.history.state).toBe(state);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
