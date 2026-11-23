import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { ScrimDecisionPane, type ScrimDecisionPaneProps } from "./ScrimDecisionPane";
import { makeOptions, makeReport } from "./scrimDayFixtures";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

const LOCK = "A scrim block of this week has already been played, so the setup is locked. It reopens next Monday.";

function setup(props: Partial<ScrimDecisionPaneProps> = {}) {
  const onDecide = vi.fn();
  const utils = render(
    <ScrimDecisionPane
      report={makeReport()}
      slotLabel="Wed A"
      blockLabel="A"
      options={makeOptions({ isFirstBlock: true, won: false })}
      savingId={null}
      onDecide={onDecide}
      closeDay={false}
      ghostReputation={45}
      lockText={LOCK}
      {...props}
    />,
  );
  return { onDecide, ...utils };
}

const buttonNames = () => screen.getAllByRole("button").map((b) => b.textContent);

describe("ScrimDecisionPane", () => {
  it("shows the facts bar: result, slot, focus, quality, issue after a loss, and the block", () => {
    const { container } = setup();
    const facts = container.querySelector('[data-slot="scrim-decision-facts"]') as HTMLElement;
    for (const text of ["Wed A", "Report focus", "Fix early game", "Quality", "61", "Detected issue", "Lane pressure", "A of 2"]) {
      expect(within(facts).getAllByText(text).length).toBeGreaterThan(0);
    }
    expect(within(facts).getAllByText("Loss").length).toBeGreaterThan(0);
  });

  it("leaves the detected issue out after a win", () => {
    const report = makeReport({ won: true, issue: null });
    setup({ report, options: makeOptions({ isFirstBlock: true, won: true, report }) });
    expect(screen.queryByText("Detected issue")).toBeNull();
    expect(screen.getAllByText("Win").length).toBeGreaterThan(0);
  });

  it("offers Push through and Cancel scrims after a loss, Continue and Offer rest after a win", () => {
    const { unmount } = setup();
    expect(buttonNames()).toEqual(["Push through", "Cancel scrims"]);
    unmount();
    const report = makeReport({ won: true, issue: null });
    setup({ report, options: makeOptions({ isFirstBlock: true, won: true, report }) });
    expect(buttonNames()).toEqual(["Continue to block 2", "Offer rest"]);
  });

  it("gives each card its tags as plain text and its effect lines from the rules", () => {
    setup();
    const push = screen.getByRole("button", { name: "Push through" }).closest("li") as HTMLElement;
    expect(push).toHaveTextContent("+Volume");
    expect(push).toHaveTextContent("+Learning");
    expect(push).toHaveTextContent("Report quality +12");
    expect(push).toHaveTextContent("Picked players: Condition -6");
    expect(push).toHaveTextContent("Block B plays now. Its report waits for your decision.");
    expect(push.querySelector('[data-slot="cost-mark"]')).toBeNull();
    // plain text, not boxed chips
    expect(push.querySelector("[data-tone][class*='border']")).toBeNull();
  });

  it("marks Cancel scrims as a cost and says it applies nothing yet, with the dashed mark's value", () => {
    setup();
    const cancel = screen.getByRole("button", { name: "Cancel scrims" }).closest("li") as HTMLElement;
    expect(within(cancel).getByText("Cost")).toBeInTheDocument();
    expect(cancel).toHaveTextContent("Applies nothing yet. Any follow-up cancels block B: scrim rep -5, cancellations +1.");
    expect(cancel).toHaveTextContent("Dashed mark: 45 after any follow-up.");
  });

  it("says no dashed mark when the parent has none", () => {
    setup({ ghostReputation: null });
    expect(screen.queryByText(/Dashed mark/)).toBeNull();
  });

  it("decides with one press and no confirmation", () => {
    const { onDecide } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Push through" }));
    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(onDecide).toHaveBeenCalledWith("PushThrough");
  });

  it("says Saving on the card that saves and makes every card aria-disabled but focusable", () => {
    const { onDecide } = setup({ savingId: "PushThrough" });
    expect(screen.getByRole("button", { name: "Saving..." })).toBeInTheDocument();
    const buttons = screen.getAllByRole("button");
    for (const button of buttons) {
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).not.toBeDisabled();
    }
    fireEvent.click(screen.getByRole("button", { name: "Cancel scrims" }));
    expect(onDecide).not.toHaveBeenCalled();
    buttons[1].focus();
    expect(buttons[1]).toHaveFocus();
  });

  it("describes a card's choice to a screen reader through its tags and effects", () => {
    setup();
    const button = screen.getByRole("button", { name: "Push through" });
    const described = (button.getAttribute("aria-describedby") ?? "").split(" ").map((id) => document.getElementById(id)?.textContent ?? "");
    expect(described.join(" ")).toContain("+Volume");
    expect(described.join(" ")).toContain("Report quality +12");
  });

  it("keeps every card at least the card height and the pane's lock sentence last, on one line", () => {
    const { container } = setup();
    for (const li of container.querySelectorAll("[data-slot='decision-card']")) {
      expect(li.className).toContain("min-h-[5.25rem]");
    }
    const lock = container.querySelector('[data-slot="phone-lock-line"]') as HTMLElement;
    expect(lock).toHaveTextContent(LOCK);
    expect(lock.querySelector(".truncate")).not.toBeNull();
    expect(container.querySelector('[data-slot="scrim-decision-pane"]')?.lastElementChild).toBe(lock);
  });

  it("scrolls the cards inside the pane under a fixed facts bar", () => {
    const { container } = setup();
    const scroller = container.querySelector('[data-slot="decision-scroll"]') as HTMLElement;
    expect(scroller.className).toContain("overflow-y-auto");
    expect(scroller.className).toContain("min-h-0");
    expect(scroller).toContainElement(screen.getByRole("button", { name: "Push through" }));
    expect(scroller).not.toContainElement(container.querySelector('[data-slot="scrim-decision-facts"]'));
  });

  it("has no lock line when there is nothing to say", () => {
    const { container } = setup({ lockText: null });
    expect(container.querySelector('[data-slot="phone-lock-line"]')).toBeNull();
  });

  it("closes the day as rows: one choice after a win, four after a loss, titled Close day", () => {
    const won = makeReport({ slot_index: 1, won: true, issue: null });
    const { unmount } = setup({
      report: won,
      blockLabel: "B",
      closeDay: true,
      ghostReputation: null,
      options: makeOptions({ isFirstBlock: false, won: true, report: won }),
    });
    expect(buttonNames()).toEqual(["Day off"]);
    expect(screen.getByRole("heading", { level: 2, name: "Close day" })).toBeInTheDocument();
    unmount();
    const lost = makeReport({ slot_index: 1 });
    const { container } = setup({
      report: lost,
      blockLabel: "B",
      closeDay: true,
      ghostReputation: null,
      options: makeOptions({ isFirstBlock: false, won: false, report: lost }),
    });
    expect(buttonNames()).toEqual(["Day off", "VOD Review", "Mental Reset", "Targeted Drills"]);
    expect(container.querySelectorAll('[data-slot="decision-card"][data-layout="row"]')).toHaveLength(4);
    expect(screen.getByText("B of 2")).toBeInTheDocument();
  });

  it("titles the pane Block Decision for the first block and lets the parent focus the heading", () => {
    setup();
    const heading = screen.getByRole("heading", { level: 2, name: "Block Decision" });
    expect(heading).toHaveAttribute("tabindex", "-1");
    expect(heading.className).toContain("sr-only");
    heading.focus();
    expect(heading).toHaveFocus();
    expect(screen.getByRole("group", { name: "Block Decision" })).toBeInTheDocument();
  });

  it("has no live region of its own", () => {
    const { container } = setup();
    expect(container.querySelector("[aria-live]")).toBeNull();
  });
});
