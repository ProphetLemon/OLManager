import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import type { DecisionResult } from "@/lib/scrims/decisionResult";
import type { TeamIdentity } from "@/lib/teams/teamIdentity";
import { ScrimResultPane, type ScrimResultPaneProps } from "./ScrimResultPane";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

const YOU: TeamIdentity = { name: "Mine Esports", tag: "MIN", logoUrl: null };
const RIVAL: TeamIdentity = { name: "UCAM Esports", tag: "UCAM", logoUrl: null };
const HERETICS: TeamIdentity = { name: "Team Heretics Academy", tag: "THA", logoUrl: null };

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
    { kind: "change", field: "quality", before: 61, after: 68, cost: false },
    { kind: "change", field: "severity", before: 3, after: 2, cost: false },
    { kind: "change", field: "reputation", before: 30, after: 25, cost: true },
    { kind: "change", field: "cancellations", before: 0, after: 1, cost: true },
    { kind: "block", label: "B", state: "cancelled" },
  ],
};

function setup(props: Partial<ScrimResultPaneProps> = {}) {
  const onDecideNext = vi.fn();
  const onBack = vi.fn();
  const utils = render(
    <ScrimResultPane
      title="Block review"
      onBack={onBack}
      result={PUSH}
      statusText="Decision applied to scrim block: Push through"
      you={YOU}
      rival={RIVAL}
      won={false}
      slotLabel="Wed A"
      other={{ label: "Wed B", identity: HERETICS, state: "played" }}
      nextSlotLabel="Wed B"
      onDecideNext={onDecideNext}
      {...props}
    />,
  );
  return { onDecideNext, onBack, ...utils };
}

const pane = () => document.querySelector('[data-slot="scrim-result-pane"]') as HTMLElement;
const changes = () => screen.getByRole("group", { name: "What changed" });

describe("ScrimResultPane: the frame and the applied line", () => {
  it("draws the shared frame titled Block review, with one heading and a back control", () => {
    const { onBack } = setup();
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 2, name: /Block review/ })).toHaveAttribute("data-pane-heading", "");
    fireEvent.click(screen.getByRole("button", { name: "Back: Block review" }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-slot="scrim-view-body"]')?.className).not.toContain("bg-card");
  });

  it("says the decision applied with the option's name in the top row, and it is not a live region", () => {
    const { container } = setup();
    const line = document.querySelector('[data-slot="result-applied"]') as HTMLElement;
    expect(document.querySelector('[data-slot="scrim-view-top"]')).toContainElement(line);
    expect(line).toHaveTextContent("Decision applied to scrim block: Push through");
    expect(line.querySelector("svg")).not.toBeNull();
    expect(container.querySelectorAll("[aria-live]")).toHaveLength(0);
  });

  it("keeps the body inside the 286 px area and nothing scrolls", () => {
    setup();
    expect(pane().className).toContain("pt-2");
    expect(pane().className).toContain("pb-3");
    // The frame's body may scroll as a safety; nothing inside the pane does.
    expect(pane().querySelector('[class*="overflow-y-auto"], [class*="overflow-auto"]')).toBeNull();
  });
});

describe("ScrimResultPane: the blocks", () => {
  it("tells the block as a matchup with its result word, a loss in red", () => {
    setup();
    const a = document.querySelector('[data-slot="result-block-a"]') as HTMLElement;
    expect(a).toHaveTextContent("Wed A");
    expect(within(a).getAllByRole("img").map((img) => img.getAttribute("aria-label"))).toEqual(["Mine Esports", "UCAM Esports"]);
    const word = within(a).getByText("Loss");
    expect(word).toHaveAttribute("data-result", "lost");
    expect(word.className).toContain("text-negative");
  });

  it("says a win in the positive colour with its word", () => {
    setup({ won: true });
    const word = within(document.querySelector('[data-slot="result-block-a"]') as HTMLElement).getByText("Win");
    expect(word).toHaveAttribute("data-result", "won");
    expect(word.className).toContain("text-positive");
  });

  it("shows the day's other block under it with its rival's logo and name", () => {
    setup();
    const b = document.querySelector('[data-slot="result-block-b"]') as HTMLElement;
    expect(b).toHaveTextContent("Wed B");
    expect(within(b).getByRole("img", { name: "Team Heretics Academy" })).toBeInTheDocument();
    expect(within(b).getByText("Team Heretics Academy")).toBeInTheDocument();
    expect(b).toHaveTextContent("Played, report waiting");
  });

  it("says a cancelled block with the X and Cancelled in the secondary colour, not red and not dimmed", () => {
    setup({ result: CANCEL, other: { label: "Wed B", identity: HERETICS, state: "cancelled" }, nextSlotLabel: null });
    const state = document.querySelector('[data-slot="result-block-state"]') as HTMLElement;
    expect(state).toHaveTextContent("Cancelled");
    expect(state.querySelector("svg")).not.toBeNull();
    expect(state.className).toContain("text-muted-foreground");
    expect(state.className).not.toContain("text-negative");
    const b = document.querySelector('[data-slot="result-block-b"]') as HTMLElement;
    expect(b.className).not.toMatch(/opacity/);
  });

  it("says only Cancelled for a cancelled block with no rival: no Not planned under the dashed shield", () => {
    setup({ result: CANCEL, other: { label: "Wed B", identity: null, state: "cancelled" }, nextSlotLabel: null });
    const b = document.querySelector('[data-slot="result-block-b"]') as HTMLElement;
    expect(b.querySelector('[data-slot="phone-empty-shield"]')).not.toBeNull();
    expect(b).not.toHaveTextContent("Not planned");
    expect(b).toHaveTextContent("Cancelled");
  });

  it("words the other block as report pending only while its own decision is pending", () => {
    setup({ other: { label: "Wed A", identity: HERETICS, state: "played", decided: false, result: "won" } });
    const b = document.querySelector('[data-slot="result-block-b"]') as HTMLElement;
    expect(b).toHaveTextContent("Played, report waiting");
    expect(b.querySelector('[data-slot="phone-result-word"]')).toBeNull();
  });

  it("shows a decided other block's result with the shared result word: Win", () => {
    setup({ other: { label: "Wed A", identity: HERETICS, state: "played", decided: true, result: "won" } });
    const b = document.querySelector('[data-slot="result-block-b"]') as HTMLElement;
    expect(b).not.toHaveTextContent("report waiting");
    expect(b.querySelector('[data-slot="phone-result-word"]')).toHaveAttribute("data-result", "won");
    expect(b).toHaveTextContent("Win");
  });

  it("shows a decided other block's result with the shared result word: Loss", () => {
    setup({ other: { label: "Wed A", identity: HERETICS, state: "played", decided: true, result: "lost" } });
    const b = document.querySelector('[data-slot="result-block-b"]') as HTMLElement;
    expect(b.querySelector('[data-slot="phone-result-word"]')).toHaveAttribute("data-result", "lost");
    expect(b).toHaveTextContent("Loss");
  });

  it("draws no second block when the day has no other one", () => {
    setup({ other: null });
    expect(document.querySelector('[data-slot="result-block-b"]')).toBeNull();
  });

  it("draws an empty shield when the other block has no rival", () => {
    setup({ other: { label: "Wed B", identity: null, state: "none" } });
    const b = document.querySelector('[data-slot="result-block-b"]') as HTMLElement;
    expect(b.querySelector('[data-slot="phone-empty-shield"]')).not.toBeNull();
    expect(b).toHaveTextContent("Not planned");
  });
});

describe("ScrimResultPane: what changed", () => {
  const labels = () => [...changes().querySelectorAll("dt")].map((dt) => dt.textContent);

  it("lists Quality, Morale and Energy first, always in that order, then the costs and the other block's row, and the closing sentence", () => {
    setup();
    expect(screen.getByText("What changed")).toBeInTheDocument();
    expect(labels()).toEqual(["Quality", "Morale", "Energy", "Block B"]);
    expect(screen.getByText("Block 2 was played. Its report is waiting for your decision.")).toBeInTheDocument();
  });

  it("never lists Severity, nor Picked players as one line", () => {
    setup({ result: CANCEL, nextSlotLabel: null });
    expect(labels()).not.toContain("Severity");
    expect(pane().textContent).not.toMatch(/Severity|Picked players/);
  });

  it("shows each stat with the table's arrows: up and +n, a DOWN arrow and the minus in amber, a dash when untouched, Quality with where it ends", () => {
    setup();
    const quality = changes().querySelector('[data-stat="quality"] [data-slot="stat-value"]') as HTMLElement;
    expect(quality).toHaveAttribute("data-change", "up");
    expect(quality).toHaveTextContent("+12");
    expect(quality).toHaveTextContent("\u2192 73");
    expect(changes().querySelector('[data-stat="morale"] [data-slot="stat-value"]')).toHaveAttribute("data-change", "none");
    const energy = changes().querySelector('[data-stat="energy"] [data-slot="stat-value"]') as HTMLElement;
    expect(energy).toHaveAttribute("data-change", "down");
    expect(energy).toHaveTextContent("\u22126");
    expect(energy.className).toContain("text-warning");
    expect(energy.querySelector(".lucide-arrow-down")).not.toBeNull();
  });

  it("says each stat in words for assistive technology", () => {
    setup();
    expect(within(changes()).getByText("Quality goes up 12, ends at 73")).toBeInTheDocument();
    expect(within(changes()).getByText("Morale: no change")).toBeInTheDocument();
    expect(within(changes()).getByText("Energy goes down 6")).toBeInTheDocument();
  });

  it("marks the costs with the warning icon and the word Cost after the three stats", () => {
    setup({ result: CANCEL, nextSlotLabel: null, other: { label: "Wed B", identity: HERETICS, state: "cancelled" } });
    expect(labels()).toEqual(["Quality", "Morale", "Energy", "Scrim rep", "Cancellations", "Block B"]);
    const costs = pane().querySelectorAll('[data-slot="phone-change"][data-tone="cost"]');
    expect(costs).toHaveLength(2);
    expect(pane().querySelectorAll('[data-slot="cost-mark"]')).toHaveLength(2);
    expect(within(changes()).getByText("30 → 25")).toBeInTheDocument();
    expect(within(changes()).getByText("0 → 1")).toBeInTheDocument();
  });

  it("says the cancelled block in the rows with the X and the closing sentence", () => {
    setup({ result: CANCEL, nextSlotLabel: null, other: { label: "Wed B", identity: HERETICS, state: "cancelled" } });
    const row = within(changes()).getByText("Block B").closest("div") as HTMLElement;
    expect(row).toHaveTextContent("Cancelled");
    expect(row.querySelector("svg")).not.toBeNull();
    expect(screen.getByText("Block B was cancelled. Continue advances the day.")).toBeInTheDocument();
  });

  it("has no tag words and no nested heading", () => {
    setup();
    expect(pane().textContent).not.toMatch(/\+Volume|\+Learning/);
    expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
  });

  it("puts the ? glossary at the right end of the top row", () => {
    setup();
    const top = document.querySelector('[data-slot="scrim-view-top"]') as HTMLElement;
    const controls = [...top.querySelectorAll("button")];
    expect(controls[controls.length - 1]).toBe(within(top).getByRole("button", { name: "What each number means" }));
  });
});

describe("ScrimResultPane: Decide <slot>", () => {
  it("offers one outline button when the next block waits, and it calls the parent", () => {
    const { onDecideNext } = setup();
    const button = screen.getByRole("button", { name: "Decide Wed B" });
    expect(button.className).toContain("border");
    expect(button.className).not.toContain("bg-club");
    expect(button.className).toContain("h-[var(--hit)]");
    expect(pane()).toContainElement(button);
    fireEvent.click(button);
    expect(onDecideNext).toHaveBeenCalledTimes(1);
  });

  it("has no such button when the next block is not waiting", () => {
    setup({ result: CANCEL, nextSlotLabel: null });
    expect(screen.queryByRole("button", { name: /Decide/ })).toBeNull();
    expect(within(pane()).queryAllByRole("button")).toHaveLength(0);
  });
});
