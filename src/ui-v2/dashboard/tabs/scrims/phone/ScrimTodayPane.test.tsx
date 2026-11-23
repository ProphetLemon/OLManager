import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import i18n from "@/i18n";
import { ScrimTodayPane, type ScrimTodayPaneProps } from "./ScrimTodayPane";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

const MESSAGE = "Nothing to decide right now. Wed A plays against MVK Esports when you continue.";

function setup(props: Partial<ScrimTodayPaneProps> = {}) {
  return render(
    <ScrimTodayPane
      slotLabel="Wed A"
      dayState="Planned"
      message={MESSAGE}
      facts={{ opponent: "MVK Esports", risk: "low" }}
      plans={["MVK Esports", "GAM Esports", null]}
      lockText="You confirmed this week's setup, so it is locked. It reopens next Monday."
      {...props}
    />,
  );
}

describe("ScrimTodayPane", () => {
  it("names the pane by the slot and puts the state of the day in a badge with a word", () => {
    const { container } = setup();
    const group = screen.getByRole("group", { name: "Today's Block Wed A" });
    expect(within(group).getByRole("heading", { level: 2 })).toHaveTextContent("Today's Block");
    const badge = container.querySelector('[data-slot="day-badge"]') as HTMLElement;
    expect(badge).toHaveTextContent("Planned");
    expect(badge.querySelector("svg")).not.toBeNull();
  });

  it("words every state of the day", () => {
    const { rerender } = setup();
    const badge = (c: HTMLElement) => c.querySelector('[data-slot="day-badge"]')?.textContent;
    const states = [
      ["PlayedNeedsReview", "Pending Review"],
      ["Reviewed", "Reviewed"],
      ["Cancelled", "Cancelled"],
      ["NoScrimToday", "No scrim"],
    ] as const;
    for (const [state, word] of states) {
      rerender(
        <ScrimTodayPane slotLabel="Wed A" dayState={state} message="x" facts={null} plans={null} lockText={null} />,
      );
      expect(badge(document.body)).toBe(word);
    }
  });

  it("says the sentence of the state it was given", () => {
    setup();
    expect(screen.getByText(MESSAGE)).toBeInTheDocument();
  });

  it("shows today's opponent and today's risk, with the risk in bars and a word", () => {
    const { container } = setup({ facts: { opponent: "MVK Esports", risk: "medium" } });
    expect(screen.getByText("Today's Opponent")).toBeInTheDocument();
    expect(screen.getAllByText("MVK Esports").length).toBeGreaterThan(0);
    expect(screen.getByText("Today's Risk")).toBeInTheDocument();
    expect(screen.getByText("Medium")).toBeInTheDocument();
    expect(container.querySelector('[data-risk="medium"]')).not.toBeNull();
  });

  it("leaves the two facts out once the block is no longer to be played", () => {
    setup({ facts: null, plans: null });
    expect(screen.queryByText("Today's Opponent")).toBeNull();
    expect(screen.queryByText("Today's Risk")).toBeNull();
    expect(screen.queryByText("Plan A")).toBeNull();
  });

  it("lists Plan A, B and C as read-only items, 'No fallback' where empty", () => {
    setup();
    const list = screen.getByRole("list", { name: "Opponent plans" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual(["APlan AMVK Esports", "BPlan BGAM Esports", "CPlan CNo fallback"]);
  });

  it("says when Plan A has no rival", () => {
    setup({ plans: [null, null, null] });
    expect(screen.getByText("No opponent set")).toBeInTheDocument();
  });

  it("ends with the lock sentence, on one line that gives way first, or the assistant sentence", () => {
    const { container, rerender } = setup();
    const line = container.querySelector('[data-slot="phone-lock-line"]') as HTMLElement;
    expect(line).toHaveTextContent("You confirmed this week's setup");
    expect(line.querySelector(".truncate")).not.toBeNull();
    rerender(
      <ScrimTodayPane slotLabel="Wed A" dayState="Planned" message="x" facts={null} plans={null} lockText="Assistant is handling scrims" />,
    );
    expect(screen.getByText("Assistant is handling scrims")).toBeInTheDocument();
  });

  it("has nothing to press and no live region", () => {
    const { container } = setup();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(container.querySelector("[aria-live]")).toBeNull();
  });

  it("lets the parent move focus to the heading, never by Tab", () => {
    setup();
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toHaveAttribute("tabindex", "-1");
    heading.focus();
    expect(heading).toHaveFocus();
  });
});
