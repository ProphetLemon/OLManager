import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import type { TeamIdentity } from "@/lib/teams/teamIdentity";
import { ScrimDecisionPane, type ScrimDecisionPaneProps } from "./ScrimDecisionPane";
import { makeOptions, makeReport } from "./scrimDayFixtures";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

const YOU: TeamIdentity = { name: "Mine Esports", tag: "MIN", logoUrl: null };
const RIVAL: TeamIdentity = { name: "UCAM Esports", tag: "UCAM", logoUrl: null };

function setup(props: Partial<ScrimDecisionPaneProps> = {}) {
  const onDecide = vi.fn();
  const onBack = vi.fn();
  const utils = render(
    <ScrimDecisionPane
      title="Decide Wed A"
      onBack={onBack}
      report={makeReport()}
      you={YOU}
      rival={RIVAL}
      blockLabel="A"
      options={makeOptions({ isFirstBlock: true, won: false })}
      savingId={null}
      onDecide={onDecide}
      reputation={30}
      locked
      {...props}
    />,
  );
  return { onDecide, onBack, ...utils };
}

const cards = () => [...document.querySelectorAll<HTMLElement>('[data-slot="decision-card"]')];
const cardOf = (name: string) => screen.getByRole("button", { name }).closest("li") as HTMLElement;
const titles = () => cards().map((card) => card.querySelector("button")?.textContent);
const pane = () => document.querySelector('[data-slot="scrim-decision-pane"]') as HTMLElement;

function closeDay(won: boolean) {
  const report = makeReport({ slot_index: 1, won, issue: won ? null : "LanePressure" });
  return { report, blockLabel: "B", title: "Decide Wed B", options: makeOptions({ isFirstBlock: false, won, report }) };
}

describe("ScrimDecisionPane: the frame", () => {
  it("draws the shared frame with one heading, the frame's title, and a back control that leaves for Semana", () => {
    const { onBack } = setup();
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 2, name: /Decide Wed A/ })).toHaveAttribute("data-pane-heading", "");
    const back = screen.getByRole("button", { name: "Back: Decide Wed A" });
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("has no card around the whole view, no live region and nothing that scrolls", () => {
    const { container } = setup();
    expect(container.querySelector('[data-slot="scrim-view-body"]')?.className).not.toContain("bg-card");
    expect(container.querySelector("[aria-live]")).toBeNull();
    expect(container.querySelector('[class*="overflow-y-auto"], [class*="overflow-auto"], [class*="overflow-y-scroll"]')).toBeNull();
  });

  it("keeps the body inside the 286 px area: 8 px under the top row and 12 px free at the bottom", () => {
    setup();
    expect(pane().className).toContain("pt-2");
    expect(pane().className).toContain("pb-3");
    expect(pane().className).toContain("h-full");
  });

  it("shows the lock as its icon and the word Locked in the top row, never the sentence", () => {
    setup();
    const lock = document.querySelector('[data-slot="decision-lock"]') as HTMLElement;
    expect(lock).toHaveTextContent("Locked");
    expect(lock.querySelector("svg")).not.toBeNull();
    expect(document.querySelector('[data-slot="scrim-view-top"]')).toContainElement(lock);
    expect(screen.queryByText(/setup is locked/)).toBeNull();
  });

  it("draws no lock when the week is not locked", () => {
    setup({ locked: false });
    expect(document.querySelector('[data-slot="decision-lock"]')).toBeNull();
  });
});

describe("ScrimDecisionPane: the block", () => {
  it("tells the block as a matchup: your club and the rival, each with its logo and name", () => {
    setup();
    const matchup = document.querySelector('[data-slot="phone-matchup"]') as HTMLElement;
    const teams = within(matchup).getAllByRole("img");
    expect(teams.map((img) => img.getAttribute("aria-label"))).toEqual(["Mine Esports", "UCAM Esports"]);
    expect(within(matchup).getByText("Mine Esports")).toBeInTheDocument();
    expect(within(matchup).getByText("UCAM Esports")).toBeInTheDocument();
  });

  it("says the result as a large word: a loss in red, with the word, and the A of 2 label", () => {
    setup();
    const word = document.querySelector('[data-slot="phone-result-word"]') as HTMLElement;
    expect(word).toHaveTextContent("Loss");
    expect(word).toHaveAttribute("data-result", "lost");
    expect(word.className).toContain("text-negative");
    expect(word.className).toContain("text-title");
    expect(screen.getByText("A of 2")).toBeInTheDocument();
  });

  it("says a win in the positive colour, with its word, and leaves the detected issue out", () => {
    const report = makeReport({ won: true, issue: null });
    setup({ report, options: makeOptions({ isFirstBlock: true, won: true, report }) });
    const word = document.querySelector('[data-slot="phone-result-word"]') as HTMLElement;
    expect(word).toHaveTextContent("Win");
    expect(word).toHaveAttribute("data-result", "won");
    expect(word.className).toContain("text-positive");
    expect(word.className).not.toContain("text-negative");
    expect(screen.queryByText("Detected issue")).toBeNull();
  });

  it("lists the report's focus, the quality and the detected issue after a loss", () => {
    setup();
    const facts = document.querySelector('[data-slot="phone-decision-facts"]') as HTMLElement;
    for (const text of ["Report focus", "Fix early game", "Quality", "61", "Detected issue", "Lane pressure"]) {
      expect(within(facts).getByText(text)).toBeInTheDocument();
    }
  });

  it("keeps a long club name on one line so the left column cannot grow", () => {
    setup({ rival: { name: "Team Heretics Academy", tag: "THA", logoUrl: null } });
    const name = within(document.querySelector('[data-slot="phone-matchup"]') as HTMLElement).getByText("Team Heretics Academy");
    expect(name.className).toContain("truncate");
  });
});

describe("ScrimDecisionPane: one card per option the game gives", () => {
  it("offers Push through and Cancel scrims after a loss, Continue and Offer rest after a win, in the game's order", () => {
    const { unmount } = setup();
    expect(titles()).toEqual(["Push through", "Cancel scrims"]);
    unmount();
    const report = makeReport({ won: true, issue: null });
    setup({ report, options: makeOptions({ isFirstBlock: true, won: true, report }) });
    expect(titles()).toEqual(["Continue to block 2", "Offer rest"]);
  });

  it("closes the day with one card after a win and four after a loss", () => {
    const { unmount } = setup(closeDay(true));
    expect(titles()).toEqual(["Day off"]);
    unmount();
    setup(closeDay(false));
    expect(titles()).toEqual(["Day off", "VOD Review", "Mental Reset", "Targeted Drills"]);
    expect(screen.getByText("B of 2")).toBeInTheDocument();
  });

  it("draws any number of options as cards, from one to four, none of them left out", () => {
    const options = makeOptions({ isFirstBlock: false, won: false, report: makeReport({ slot_index: 1 }) });
    for (const count of [1, 2, 3, 4]) {
      const { unmount } = setup({ options: options.slice(0, count) });
      expect(cards()).toHaveLength(count);
      unmount();
    }
  });

  it("gives each card its title, its description and its effects as before-and-after pairs", () => {
    setup();
    const push = cardOf("Push through");
    expect(push).toHaveTextContent("Quality");
    expect(push).toHaveTextContent("61 → 73");
    expect(push).toHaveTextContent("Picked players: Condition -6");
    expect(push).toHaveTextContent("Block B plays now. Its report waits for your decision.");
    expect(push.querySelector("p")?.textContent).not.toBe("");
  });

  it("leaves the tag words out of the phone's cards", () => {
    setup();
    const text = pane().textContent ?? "";
    for (const word of ["+Volume", "+Learning", "+Fatigue", "+Impulse"]) expect(text).not.toContain(word);
  });

  it("marks a gain with the up arrow and a cost with the warning icon and the word, never by colour alone", () => {
    setup();
    const push = cardOf("Push through");
    const gain = push.querySelector('[data-slot="phone-change"][data-tone="gain"]') as HTMLElement;
    expect(gain.querySelector("svg")).not.toBeNull();
    expect(gain).toHaveTextContent("61 → 73");
    const cost = push.querySelector('[data-slot="phone-change"][data-tone="cost"]') as HTMLElement;
    expect(cost.querySelector("svg")?.getAttribute("class")).toContain("text-warning");
    expect(cost).toHaveTextContent(/cost/i);
  });

  it("shows Rep scrims as a bar at the current value with a dashed mark at the value after cancelling", () => {
    setup();
    const cancel = cardOf("Cancel scrims");
    const bar = within(cancel).getByRole("meter", { name: "Scrim rep" });
    expect(bar).toHaveAttribute("aria-valuenow", "30");
    const ghost = cancel.querySelector('[data-slot="rep-bar-ghost"]') as HTMLElement;
    expect(ghost.style.left).toBe("25%");
    expect(ghost.className).toContain("border-dashed");
    expect(cancel).toHaveTextContent("30 → 25");
    expect(cancel.querySelector('[data-slot="cost-mark"]')).not.toBeNull();
    expect(cancel).toHaveTextContent("Applies nothing yet. Any follow-up cancels block B: scrim rep -5, cancellations +1.");
  });

  it("shows the bar on any option that cancels, such as Offer rest after a win, and on no other", () => {
    const report = makeReport({ won: true, issue: null });
    setup({ report, options: makeOptions({ isFirstBlock: true, won: true, report }) });
    expect(within(cardOf("Offer rest")).getByRole("meter")).toBeInTheDocument();
    expect(within(cardOf("Continue to block 2")).queryByRole("meter")).toBeNull();
    expect(within(cardOf("Continue to block 2")).queryByText("Cost")).toBeNull();
  });

  it("leaves the closing sentence out of an option that cancels, which already says the block is not played", () => {
    const report = makeReport({ won: true, issue: null });
    setup({ report, options: makeOptions({ isFirstBlock: true, won: true, report }) });
    expect(cardOf("Offer rest")).toHaveTextContent("Cancels block B.");
    expect(cardOf("Offer rest")).not.toHaveTextContent("The day closes");
  });

  it("draws no bar on Push through", () => {
    setup();
    expect(within(cardOf("Push through")).queryByRole("meter")).toBeNull();
  });

  it("never lets the dashed mark go below zero", () => {
    setup({ reputation: 3 });
    expect((document.querySelector('[data-slot="rep-bar-ghost"]') as HTMLElement).style.left).toBe("0%");
    expect(cardOf("Cancel scrims")).toHaveTextContent("3 → 0");
  });
});

describe("ScrimDecisionPane: a day-closing decision with several cards", () => {
  it("draws the four cards as dense rows and says once, in the top row, that the day closes", () => {
    setup(closeDay(false));
    expect(cards().map((card) => card.getAttribute("data-layout"))).toEqual(["dense", "dense", "dense", "dense"]);
    const closing = document.querySelector('[data-slot="decision-closing"]') as HTMLElement;
    expect(document.querySelector('[data-slot="scrim-view-top"]')).toContainElement(closing);
    expect(closing).toHaveTextContent("The day closes after this decision.");
    expect(screen.getAllByText("The day closes after this decision.")).toHaveLength(1);
  });

  it("keeps every card at least one target high, with its description and effects", () => {
    setup(closeDay(false));
    for (const card of cards()) expect(card.className).toContain("min-h-[var(--hit)]");
    const vod = cardOf("VOD Review");
    expect(vod).toHaveTextContent("Quality");
    expect(vod).toHaveTextContent("61 → 67");
    expect(vod).toHaveTextContent("Morale +1, Condition -1");
    expect(vod).not.toHaveTextContent("Picked players");
  });

  it("keeps the single card of a won day in the card layout with its sentence", () => {
    setup(closeDay(true));
    const [card] = cards();
    expect(card).toHaveAttribute("data-layout", "card");
    expect(card).toHaveTextContent("The day closes after this decision.");
  });
});

describe("ScrimDecisionPane: pressing", () => {
  it("decides with one press and no confirmation", () => {
    const { onDecide } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Push through" }));
    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(onDecide).toHaveBeenCalledWith("PushThrough");
  });

  it("makes each card one real button of at least a target, covering the card", () => {
    setup();
    for (const card of cards()) {
      expect(card.className).toContain("min-h-[var(--hit)]");
      const button = card.querySelector("button") as HTMLElement;
      expect(button.className).toContain("after:inset-0");
    }
  });

  it("says Saving on the card that saves and makes every card aria-disabled but focusable and unpressable", () => {
    const { onDecide } = setup({ savingId: "PushThrough" });
    expect(screen.getByRole("button", { name: "Saving..." })).toBeInTheDocument();
    const buttons = cards().map((card) => card.querySelector("button") as HTMLElement);
    for (const button of buttons) {
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).not.toBeDisabled();
    }
    fireEvent.click(screen.getByRole("button", { name: "Cancel scrims" }));
    expect(onDecide).not.toHaveBeenCalled();
    buttons[1].focus();
    expect(buttons[1]).toHaveFocus();
  });

  it("does not show a saving card by lower opacity", () => {
    setup({ savingId: "PushThrough" });
    for (const card of cards()) expect(card.className).not.toMatch(/opacity/);
  });

  it("describes a card's choice to a screen reader through its description and effects", () => {
    setup();
    const button = screen.getByRole("button", { name: "Push through" });
    const described = (button.getAttribute("aria-describedby") ?? "").split(" ").map((id) => document.getElementById(id)?.textContent ?? "");
    expect(described.join(" ")).toContain("Quality");
    expect(described.join(" ")).toContain("61 → 73");
  });
});
