import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import type { RivalRow } from "@/lib/scrims/rivalOdds";
import type { TeamData } from "@/store/gameStore";
import { dismissOverlayWithBack, resetNativeBackOverlaysForTests } from "@/ui-v2/palette/paletteHistory";
import { ScrimPickView, type ScrimPickViewProps } from "./ScrimPickView";

beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(() => resetNativeBackOverlaysForTests());

const team = (id: string, name: string, tag: string): TeamData =>
  ({ id, name, short_name: tag, logo_url: null, competition_id: "lec", scrim_reputation: 50 }) as unknown as TeamData;

// The eight rivals of the Pick frame, in the order the game gives them, with the frame's Acepta numbers.
const EIGHT: [string, string, string, number, number][] = [
  ["gxi", "GiantX Itero", "GXI", 40, 40],
  ["uam", "UB Alma Mater", "UAM", 40, 40],
  ["ucam", "UCAM Esports", "UCAM", 58, 46],
  ["tha", "Team Heretics Academy", "THA", 48, 47],
  ["lua", "LUA Gaming", "LUA", 50, 45],
  ["mkf", "Movistar KOI Fénix", "MKF", 46, 44],
  ["bar", "Barcelona Esports", "BAR", 52, 48],
  ["flk", "Falke Esports", "FLK", 57, 49],
];
const MORE: [string, string, string, number, number][] = [
  ["tsw", "Team Secret Whales", "TSW", 52, 41],
  ["gam", "GAM Esports", "GAM", 52, 43],
  ["gzg", "Ground Zero Gaming", "GZG", 52, 44],
  ["shg", "SoftBank HAWKS", "SHG", 52, 45],
  ["dcg", "Deep Cross Gaming", "DCG", 52, 46],
  ["dfm", "DetonatioN FocusMe", "DFM", 52, 52],
  ["mvk", "MVK Esports", "MVK", 52, 54],
  ["r16", "Rival Dieciséis", "R16", 60, 56],
];
const rows = (data: typeof EIGHT): RivalRow[] =>
  data.map(([teamId, name, , acceptPercent, winPercent], index) => ({ teamId, name, ovr: 80 - index, reputation: 20 + index, winPercent, acceptPercent }));
const teamsOf = (data: typeof EIGHT) => [team("mine", "Tu Club Esports", "TCE"), ...data.map(([id, name, tag]) => team(id, name, tag))];

function setup(props: Partial<ScrimPickViewProps> = {}, data = EIGHT) {
  const onPick = vi.fn();
  const onDone = vi.fn();
  const onBack = vi.fn();
  const base: ScrimPickViewProps = {
    slotLabel: "Wed A",
    myTeam: team("mine", "Tu Club Esports", "TCE"),
    teams: teamsOf(data),
    plan: ["ucam", "tha", "lua"],
    rivals: rows(data),
    ownReputation: 30,
    readOnly: false,
    disabled: false,
    blockedText: null,
    doneTo: "Wed B",
    onPick,
    onDone,
    onBack,
  };
  const utils = render(<ScrimPickView {...base} {...props} />);
  const rerender = (next: Partial<ScrimPickViewProps>) => utils.rerender(<ScrimPickView {...base} {...props} {...next} />);
  return { onPick, onDone, onBack, ...utils, rerenderWith: rerender };
}

const slot = (name: string) => document.querySelector(`[data-slot="${name}"]`) as HTMLElement;
const plans = () => screen.getByRole("group", { name: "Opponent plans" });
const tab = (name: RegExp | string) => within(plans()).getByRole("button", { name });
const strip = () => screen.getByRole("group", { name: "Rivals by overall rating" });
const stripButtons = () => within(strip()).getAllByRole("button");
const rival = (name: RegExp | string) => within(strip()).getByRole("button", { name });
const clear = () => screen.getByRole("button", { name: "Not planned" });
const help = () => screen.getByRole("button", { name: /Win \/ Accepts/ });
const card = () => slot("pick-card");

describe("ScrimPickView top row", () => {
  it("is the frame's row: the back control with the slot, the three plans, Not planned, then the help last", () => {
    const { onBack } = setup();
    const back = screen.getByRole("button", { name: "Back: Wed A" });
    expect(back).toHaveTextContent("Wed A");
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
    const top = slot("scrim-view-top");
    const controls = within(top).getAllByRole("button");
    expect(controls.map((control) => control.getAttribute("aria-label") ?? control.textContent)).toEqual([
      "Back: Wed A",
      "Plan A: UCAM Esports",
      "Plan B: Team Heretics Academy",
      "Plan C: LUA Gaming",
      "Not planned",
      expect.stringMatching(/Win \/ Accepts/),
    ]);
    // Nothing that changes data sits at the right end: the last control only opens an explanation.
    expect(controls[controls.length - 1]).toBe(help());
    expect(clear().className).toContain("h-[var(--hit)]");
    expect(clear().querySelector("svg")).not.toBeNull();
    expect(help().className).toContain("size-[var(--hit)]");
  });

  it("shows each plan with its letter and the real logo of its rival, or the empty shield", () => {
    setup({ plan: ["ucam", "", "lua"] });
    const a = tab(/Plan A/);
    expect(a).toHaveTextContent("A");
    expect((a.querySelector("img") as HTMLImageElement).getAttribute("src")).toContain("/teams-icons/ucam.webp");
    expect(tab(/Plan B/).querySelector("img")).toBeNull();
    expect(tab(/Plan B/).querySelector('[data-slot="phone-empty-shield"]')).not.toBeNull();
    expect(tab(/Plan B/)).toHaveAccessibleName("Plan B: No fallback");
    expect(within(plans()).getAllByRole("button")).toHaveLength(3);
  });

  it("marks the plan being filled by an underline and aria-pressed, not by colour alone", () => {
    setup();
    expect(tab(/Plan A/)).toHaveAttribute("aria-pressed", "true");
    expect(tab(/Plan A/).className).toContain("border-club");
    expect(tab(/Plan B/)).toHaveAttribute("aria-pressed", "false");
    expect(tab(/Plan B/).className).toContain("border-transparent");
    fireEvent.click(tab(/Plan C/));
    expect(tab(/Plan C/)).toHaveAttribute("aria-pressed", "true");
    expect(tab(/Plan A/)).toHaveAttribute("aria-pressed", "false");
  });
});

describe("ScrimPickView card", () => {
  it("draws your club on the left and the rival of the plan being filled on the right, large, with their names", () => {
    setup();
    const mine = within(card()).getByRole("img", { name: "Tu Club Esports" });
    const theirs = within(card()).getByRole("img", { name: "UCAM Esports" });
    expect(mine.className).toContain("size-[4.5rem]");
    expect(theirs.className).toContain("size-[4.5rem]");
    expect((theirs as HTMLImageElement).getAttribute("src")).toContain("/teams-icons/ucam.webp");
    expect(slot("pick-card-mine")).toHaveTextContent("Tu Club Esports");
    expect(slot("pick-card-rival")).toHaveTextContent("UCAM Esports");
    expect(screen.getByRole("region", { name: "Tu Club Esports vs UCAM Esports" })).toBe(card());
    expect(within(card()).getByText("Plan A")).toBeInTheDocument();
  });

  it("shows Win and Accepts as bars with the mark at 50 and the number, then OVR and Rep of the rival and your Rep", () => {
    setup();
    const win = within(card()).getByRole("meter", { name: "Win" });
    const accepts = within(card()).getByRole("meter", { name: "Accepts" });
    expect(win).toHaveAttribute("aria-valuenow", "46");
    expect(win).toHaveAttribute("aria-valuetext", "46%");
    expect(accepts).toHaveAttribute("aria-valuenow", "58");
    for (const bar of [win, accepts]) expect(bar.querySelector('[data-slot="meter-tick"]')).toHaveStyle({ left: "50%" });
    expect(slot("pick-card-mine")).toHaveTextContent("46%");
    expect(slot("pick-card-mine")).toHaveTextContent("Win");
    expect(slot("pick-card-mine")).toHaveTextContent("Rep 30");
    expect(slot("pick-card-rival")).toHaveTextContent("58%");
    expect(slot("pick-card-rival")).toHaveTextContent("Accepts");
    // The third row of ucam in the fixture: OVR 78, Rep 22.
    expect(slot("pick-card-rival")).toHaveTextContent("OVR 78");
    expect(slot("pick-card-rival")).toHaveTextContent("Rep 22");
  });

  it("follows the plan being filled: its label, its rival and its numbers", () => {
    setup();
    fireEvent.click(tab(/Plan B/));
    expect(within(card()).getByText("Plan B")).toBeInTheDocument();
    expect(slot("pick-card-rival")).toHaveTextContent("Team Heretics Academy");
    expect(within(card()).getByRole("meter", { name: "Accepts" })).toHaveAttribute("aria-valuenow", "48");
  });

  it("has no rival in an empty plan: the empty shield, the words of the frame, and only your side's numbers", () => {
    setup({ plan: ["ucam", "", ""] });
    fireEvent.click(tab(/Plan B/));
    expect(within(card()).getByText("Plan B")).toBeInTheDocument();
    expect(slot("pick-card-rival").querySelector('[data-slot="phone-empty-shield"]')).not.toBeNull();
    expect(slot("pick-card-rival")).toHaveTextContent("No fallback");
    expect(slot("pick-card-rival")).toHaveTextContent("Select Opponent");
    expect(within(card()).queryByRole("meter")).toBeNull();
    expect(slot("pick-card-mine")).toHaveTextContent("Rep 30");
    expect(screen.getByRole("region", { name: "Tu Club Esports vs No fallback" })).toBe(card());
  });

  it("words an empty Plan A as Not planned", () => {
    setup({ plan: ["", "", ""] });
    expect(slot("pick-card-rival")).toHaveTextContent("Not planned");
  });
});

describe("ScrimPickView strip", () => {
  it("has one button per rival in the order given, each named with the full team, its Acepta and what holds it", () => {
    setup();
    const names = stripButtons().map((button) => button.getAttribute("aria-label"));
    expect(names).toEqual([
      "GiantX Itero, Accepts 40%",
      "UB Alma Mater, Accepts 40%",
      "UCAM Esports, Accepts 58%",
      "Team Heretics Academy, Accepts 48%, Plan B",
      "LUA Gaming, Accepts 50%, Plan C",
      "Movistar KOI Fénix, Accepts 46%",
      "Barcelona Esports, Accepts 52%",
      "Falke Esports, Accepts 57%",
    ]);
  });

  it("draws the real logo at 40 px and under it one line: the tag and the number", () => {
    setup();
    const button = rival(/^UCAM Esports/);
    const logo = button.querySelector("img") as HTMLImageElement;
    expect(logo.getAttribute("src")).toContain("/teams-icons/ucam.webp");
    expect(logo.className).toContain("size-10");
    expect(button.querySelector('[data-slot="pick-rival-line"]')).toHaveTextContent("UCAM 58%");
    expect(button.className).toContain("min-h-[var(--hit)]");
  });

  it("writes the word Accepts once, at the start of the strip", () => {
    setup();
    const label = within(strip()).getByText("Accepts");
    expect(within(strip()).getAllByText("Accepts")).toHaveLength(1);
    expect(strip().firstElementChild).toBe(label);
    expect(label.compareDocumentPosition(stripButtons()[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("rings the rival of the plan being filled and gives it the plan's letter as a badge", () => {
    setup();
    const chosen = rival(/^UCAM Esports/);
    expect(chosen).toHaveAttribute("aria-pressed", "true");
    expect(chosen).toHaveAttribute("data-state", "chosen");
    expect(chosen.querySelector('[data-slot="pick-badge"]')).toHaveTextContent("A");
    expect(chosen.querySelector('[data-slot="pick-ring"]')?.className).toContain("ring-club");
    expect(rival(/^GiantX/)).toHaveAttribute("aria-pressed", "false");
    expect(rival(/^GiantX/).querySelector('[data-slot="pick-badge"]')).toBeNull();
  });

  it("gives a rival held by another plan that plan's letter and does not let this plan choose it, without dimming", () => {
    const { onPick } = setup();
    const held = rival(/^Team Heretics Academy/);
    expect(held).toHaveAttribute("data-state", "held");
    expect(held.querySelector('[data-slot="pick-badge"]')).toHaveTextContent("B");
    expect(held).toHaveAttribute("aria-disabled", "true");
    expect(held).not.toBeDisabled();
    expect(held.outerHTML).not.toMatch(/opacity/);
    fireEvent.click(held);
    expect(onPick).not.toHaveBeenCalled();
    // From Plan B's side the same rival is the chosen one, and Plan A's rival is held.
    fireEvent.click(tab(/Plan B/));
    expect(rival(/^Team Heretics Academy/)).toHaveAttribute("data-state", "chosen");
    expect(rival(/^UCAM Esports/)).toHaveAttribute("data-state", "held");
    expect(rival(/^UCAM Esports/)).toHaveAccessibleName("UCAM Esports, Accepts 58%, Plan A");
  });

  it("scrolls sideways inside itself and keeps Done outside what scrolls", () => {
    setup();
    expect(strip().className).toContain("overflow-x-auto");
    expect(strip().className).toContain("min-w-0");
    expect(strip().contains(screen.getByRole("button", { name: /Done/ }))).toBe(false);
    expect(slot("pick-strip-row").className).toContain("h-[3.625rem]");
  });

  it("holds sixteen rivals in the same strip, in order, with Done in place", () => {
    setup({ plan: ["", "ucam", ""] }, [...EIGHT, ...MORE]);
    expect(stripButtons()).toHaveLength(16);
    expect(stripButtons()[0]).toHaveAccessibleName("GiantX Itero, Accepts 40%");
    expect(stripButtons()[15]).toHaveAccessibleName("Rival Dieciséis, Accepts 60%");
    expect(screen.getByRole("button", { name: /Done/ }).parentElement).toBe(slot("pick-strip-row"));
  });
});

describe("ScrimPickView behaviour", () => {
  it("saves the rival tapped for the plan being filled and does not move on by itself", () => {
    const { onPick } = setup({ plan: ["", "", ""] });
    fireEvent.click(rival(/^GiantX/));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenLastCalledWith(0, "gxi");
    expect(tab(/Plan A/)).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(tab(/Plan C/));
    fireEvent.click(rival(/^Falke/));
    expect(onPick).toHaveBeenLastCalledWith(2, "flk");
    expect(tab(/Plan C/)).toHaveAttribute("aria-pressed", "true");
  });

  it("shows the matchup of the pick once the plan holds it, still on the same plan", () => {
    const { rerenderWith } = setup({ plan: ["", "", ""] });
    rerenderWith({ plan: ["gxi", "", ""] });
    expect(slot("pick-card-rival")).toHaveTextContent("GiantX Itero");
    expect(tab(/Plan A/)).toHaveAttribute("aria-pressed", "true");
  });

  it("does not save the rival the plan already holds again", () => {
    const { onPick } = setup();
    fireEvent.click(rival(/^UCAM Esports/));
    expect(onPick).not.toHaveBeenCalled();
  });

  it("keeps the buttons in place but cannot pick while a save runs", () => {
    const { onPick } = setup({ disabled: true });
    const free = rival(/^GiantX/);
    expect(free).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(free);
    fireEvent.click(clear());
    expect(onPick).not.toHaveBeenCalled();
  });

  it("clears the plan being filled with Not planned", () => {
    const { onPick } = setup();
    fireEvent.click(tab(/Plan B/));
    expect(clear()).not.toHaveAttribute("aria-disabled");
    fireEvent.click(clear());
    expect(onPick).toHaveBeenCalledWith(1, "");
    expect(tab(/Plan B/)).toHaveAttribute("aria-pressed", "true");
  });

  it("leaves Not planned as a focusable button that does nothing when the plan is empty", () => {
    const { onPick } = setup({ plan: ["ucam", "", ""] });
    fireEvent.click(tab(/Plan B/));
    expect(clear()).toHaveAttribute("aria-disabled", "true");
    expect(clear()).not.toBeDisabled();
    fireEvent.click(clear());
    expect(onPick).not.toHaveBeenCalled();
  });

  it("has Done with the next slot and an arrow, outlined, and leaves through it", () => {
    const { onDone } = setup();
    const done = screen.getByRole("button", { name: /Done/ });
    expect(done).toHaveTextContent("DoneWed B");
    expect(done.querySelector("svg")).not.toBeNull();
    expect(done.className).toContain("border-club");
    expect(done.className).not.toContain("bg-club");
    fireEvent.click(done);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe("ScrimPickView help", () => {
  it("opens the sentence on Win and Accepts in a dialog, and closes with its button", () => {
    setup();
    expect(help()).toHaveAttribute("aria-haspopup", "dialog");
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(help());
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Win is your chance to win the scrim. Accepts is the chance this rival takes a slot with two or more plans.");
    expect(dialog).not.toHaveTextContent("Plan A plays if every plan declines");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("adds the sentence about fallbacks on Plan B and Plan C", () => {
    setup();
    fireEvent.click(tab(/Plan B/));
    fireEvent.click(help());
    expect(screen.getByRole("dialog")).toHaveTextContent("A slot with one plan always plays it, and Plan A plays if every plan declines.");
    expect(screen.getByRole("dialog")).toHaveTextContent("Win is your chance to win the scrim.");
  });

  it("closes with Escape, and system Back closes it before it closes the view", () => {
    setup();
    help().focus();
    fireEvent.click(help());
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(help()).toHaveFocus();
    fireEvent.click(help());
    act(() => {
      expect(dismissOverlayWithBack()).toBe(true);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(dismissOverlayWithBack()).toBe(false);
  });
});

describe("ScrimPickView read-only", () => {
  const readOnly = { readOnly: true, blockedText: "Setup locked once block starts" };

  it("has no tappable rivals: the strip holds no buttons, and the reason takes the place of Accepts", () => {
    const { onPick } = setup(readOnly);
    expect(within(strip()).queryAllByRole("button")).toHaveLength(0);
    expect(within(strip()).queryByText("Accepts")).toBeNull();
    expect(within(strip()).getByText("Setup locked once block starts")).toBeInTheDocument();
    expect(strip().firstElementChild).toHaveTextContent("Setup locked once block starts");
    // The rivals are still read: logo, tag and number, and the plans that hold them.
    expect(strip()).toHaveTextContent("UCAM 58%");
    expect(within(strip()).getAllByRole("img").length).toBe(8);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("drops Not planned, keeps the tabs to look at each plan and the help, and still leaves through Done", () => {
    const { onDone } = setup(readOnly);
    expect(screen.queryByRole("button", { name: "Not planned" })).toBeNull();
    fireEvent.click(tab(/Plan B/));
    expect(slot("pick-card-rival")).toHaveTextContent("Team Heretics Academy");
    expect(help()).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Done/ }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("falls back to the lock word when the week gives no sentence", () => {
    setup({ readOnly: true, blockedText: null });
    expect(strip().firstElementChild).toHaveTextContent("Locked");
  });
});

describe("ScrimPickView frame and sizes", () => {
  it("is one view in the frame: one heading, no card around the whole view, and the heights of the frame", () => {
    setup();
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(screen.getByRole("heading")).toHaveAttribute("data-pane-heading");
    expect(slot("scrim-view-body").className).not.toContain("bg-card");
    expect(slot("scrim-view-body").className).not.toContain("shadow");
    // 4 + 48 + 8 + 148 + 8 + 58 + 12 at the smallest content area; a taller one gives its spare height to the card.
    expect(slot("scrim-pick-view").className).toContain("pt-2");
    expect(slot("scrim-pick-view").className).toContain("pb-3");
    expect(slot("scrim-pick-view").className).toContain("gap-2");
    expect(card().className).toContain("min-h-[9.25rem]");
    expect(card().className).toContain("flex-1");
    expect(slot("pick-strip-row").className).toContain("h-[3.625rem]");
  });

  it("makes the card the only raised surface", () => {
    setup();
    expect(card().className).toContain("bg-card");
    expect(slot("pick-strip-row").className).not.toContain("bg-card");
    expect(strip().className).not.toContain("bg-card");
  });

  it("only the rivals, the plans, Not planned, the help, Done and Back are buttons", () => {
    setup();
    expect(screen.getAllByRole("button")).toHaveLength(1 + 3 + 1 + 1 + 8 + 1);
    expect(within(card()).queryAllByRole("button")).toHaveLength(0);
  });
});

describe("ScrimPickView strip room", () => {
  it("leaves room above the logos for the plan badge and the chosen ring, inside the same row height", () => {
    setup();
    expect(slot("pick-strip").className).toContain("pt-0.5");
    expect(slot("pick-strip-row").className).toContain("h-[3.625rem]");
  });
});
