import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import type { DecisionResult } from "@/lib/scrims/decisionResult";
import { ScrimResultPane, type ScrimResultPaneProps } from "./ScrimResultPane";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

const PUSH: DecisionResult = {
  action: "PushThrough",
  closing: "blockTwoPlayed",
  rows: [
    { kind: "change", field: "quality", before: 61, after: 73, cost: false },
    { kind: "players", morale: 0, condition: -6 },
    { kind: "block", label: "B", state: "played" },
  ],
};

const CANCEL: DecisionResult = {
  action: "VodReview",
  closing: "blockCancelled",
  rows: [
    { kind: "change", field: "quality", before: 61, after: 67, cost: false },
    { kind: "change", field: "reputation", before: 50, after: 45, cost: true },
    { kind: "change", field: "cancellations", before: 0, after: 1, cost: true },
    { kind: "block", label: "B", state: "cancelled" },
  ],
};

function setup(props: Partial<ScrimResultPaneProps> = {}) {
  const onDecideNext = vi.fn();
  const utils = render(
    <ScrimResultPane
      result={PUSH}
      statusText="Decision applied to scrim block: Push through"
      nextSlotLabel="Wed B"
      onDecideNext={onDecideNext}
      {...props}
    />,
  );
  return { onDecideNext, ...utils };
}

describe("ScrimResultPane", () => {
  it("shows the decision line but leaves announcing it to the tab's one live region", () => {
    const { container } = setup();
    expect(container.querySelectorAll("[aria-live]")).toHaveLength(0);
    expect(screen.getByText("Decision applied to scrim block: Push through")).toBeInTheDocument();
  });

  it("titles the pane What changed, names it, and lets the parent focus the heading", () => {
    setup();
    const heading = screen.getByRole("heading", { level: 2, name: "What changed" });
    expect(heading).toHaveAttribute("tabindex", "-1");
    heading.focus();
    expect(heading).toHaveFocus();
    expect(screen.getByRole("group", { name: "What changed" })).toBeInTheDocument();
  });

  it("lists the rows of what changed and the closing sentence, from the existing rules", () => {
    setup();
    const rows = screen.getByRole("group", { name: "What changed" });
    expect(within(rows).getByText("Quality")).toBeInTheDocument();
    expect(within(rows).getByText("61 → 73")).toBeInTheDocument();
    expect(within(rows).getByText("Condition -6")).toBeInTheDocument();
    expect(within(rows).getByText("Played, report waiting")).toBeInTheDocument();
    expect(screen.getByText("Block 2 was played. Its report is waiting for your decision.")).toBeInTheDocument();
  });

  it("marks the cancel path's costs with the Cost mark", () => {
    const { container } = setup({ result: CANCEL, nextSlotLabel: null });
    expect(container.querySelectorAll('[data-slot="cost-mark"]')).toHaveLength(3);
    expect(screen.getByText("Block B was cancelled. Continue advances the day.")).toBeInTheDocument();
  });

  it("offers one outline button 'Decide Wed B' when the next block waits, and it calls the parent", () => {
    const { onDecideNext } = setup();
    const button = screen.getByRole("button", { name: "Decide Wed B" });
    expect(button.className).toContain("border");
    expect(button.className).not.toContain("bg-club");
    expect(button.className).toContain("h-[var(--hit)]");
    fireEvent.click(button);
    expect(onDecideNext).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("has no button when the next block was not played", () => {
    setup({ result: CANCEL, nextSlotLabel: null });
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
