import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import type { RivalRow } from "@/lib/scrims/rivalOdds";
import { ScrimSlotPane, type ScrimSlotPaneProps } from "./ScrimSlotPane";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

const row = (teamId: string, name: string, ovr: number, win: number): RivalRow => ({
  teamId,
  name,
  ovr,
  reputation: 50,
  winPercent: win,
  acceptPercent: 52,
});
const RIVALS = [row("tsw", "Team Secret Whales", 79, 41), row("gam", "GAM Esports", 78, 43), row("mvk", "MVK Esports", 74, 54)];
const NAMES = new Map(RIVALS.map((rival) => [rival.teamId, rival.name]));

function setup(props: Partial<ScrimSlotPaneProps> = {}) {
  const onPick = vi.fn();
  const onDone = vi.fn();
  const utils = render(
    <ScrimSlotPane
      slotLabel="Thu A"
      plan={["", "", ""]}
      rivals={RIVALS}
      teamNameById={NAMES}
      readOnly={false}
      disabled={false}
      blockedText={null}
      doneTo="Thu B"
      resolvedTeamId={null}
      cleared={false}
      onPick={onPick}
      onDone={onDone}
      {...props}
    />,
  );
  return { onPick, onDone, ...utils };
}

const tab = (name: RegExp | string) => screen.getByRole("tab", { name });
const grid = () => screen.getByRole("group", { name: "Rivals by overall rating" });
const cells = () => within(grid()).getAllByRole("button");
const lastCell = () => cells()[cells().length - 1];

describe("ScrimSlotPane tab row", () => {
  it("has Done over where it leads, then Plan A, B and C with their values", () => {
    const { onDone } = setup();
    const done = screen.getByRole("button", { name: /Done/ });
    expect(done).toHaveTextContent("DoneThu B");
    expect(done.className).toContain("min-h-[var(--hit)]");
    fireEvent.click(done);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(tab(/Plan A/)).toHaveTextContent("Plan AChoosing");
    expect(tab(/Plan B/)).toHaveTextContent("Plan BNo fallback");
    expect(tab(/Plan C/)).toHaveTextContent("Plan CNo fallback");
    expect(tab(/Plan A/)).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tablist").contains(done)).toBe(false);
  });

  it("shows the rival's name under a plan once it is set", () => {
    setup({ plan: ["mvk", "gam", ""] });
    expect(tab(/Plan A/)).toHaveTextContent("MVK Esports");
    expect(tab(/Plan B/)).toHaveTextContent("GAM Esports");
    expect(tab(/Plan C/)).toHaveTextContent("No fallback");
  });

  it("moves between the tabs with the arrow keys", () => {
    setup();
    tab(/Plan A/).focus();
    fireEvent.keyDown(tab(/Plan A/), { key: "ArrowRight" });
    expect(tab(/Plan B/)).toHaveAttribute("aria-selected", "true");
    expect(tab(/Plan B/)).toHaveFocus();
    fireEvent.keyDown(tab(/Plan B/), { key: "ArrowLeft" });
    expect(tab(/Plan A/)).toHaveAttribute("aria-selected", "true");
  });

  it("keeps only the active tab in the tab order", () => {
    setup();
    expect(screen.getAllByRole("tab").filter((t) => t.tabIndex === 0)).toHaveLength(1);
    expect(tab(/Plan A/).tabIndex).toBe(0);
  });
});

describe("ScrimSlotPane rivals", () => {
  it("lists the rivals as buttons in the order given with name, OVR, Rep, Win and Accepts", () => {
    setup();
    const [first, second, third] = cells();
    expect(first).toHaveTextContent("Team Secret Whales");
    expect(first).toHaveTextContent("OVR 79");
    expect(first).toHaveTextContent("Rep 50");
    expect(first).toHaveTextContent("Win 41%");
    expect(first).toHaveTextContent("Accepts 52%");
    expect(second).toHaveTextContent("GAM Esports");
    expect(third).toHaveTextContent("MVK Esports");
    expect(first.className).toContain("min-h-[var(--hit)]");
    expect(first.innerHTML).toContain("tabular-nums");
  });

  it("saves a pick at once and moves the tab from A to B to C and stays on C", () => {
    const { onPick } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Team Secret Whales/ }));
    expect(onPick).toHaveBeenLastCalledWith(0, "tsw");
    expect(tab(/Plan B/)).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: /GAM Esports/ }));
    expect(onPick).toHaveBeenLastCalledWith(1, "gam");
    expect(tab(/Plan C/)).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: /MVK Esports/ }));
    expect(onPick).toHaveBeenLastCalledWith(2, "mvk");
    expect(tab(/Plan C/)).toHaveAttribute("aria-selected", "true");
  });

  it("marks the rival the active plan already holds as chosen, by a check", () => {
    const { container } = setup({ plan: ["gam", "", ""] });
    const chosen = screen.getByRole("button", { name: /GAM Esports/ });
    expect(chosen).toHaveAttribute("aria-pressed", "true");
    expect(chosen.querySelector('[data-slot="choice-check"]')).not.toBeNull();
    expect(container.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
  });

  it("shows which plan holds a rival already used in this slot and cannot pick it again", () => {
    const { onPick } = setup({ plan: ["tsw", "gam", ""] });
    fireEvent.click(tab(/Plan C/));
    const held = screen.getByRole("button", { name: /Team Secret Whales/ });
    expect(held).toHaveTextContent("Plan A");
    expect(held).not.toHaveTextContent("Win");
    expect(held).toHaveAttribute("aria-disabled", "true");
    expect(held).not.toBeDisabled();
    expect(held.querySelector('[data-slot="choice-check"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: /GAM Esports/ })).toHaveTextContent("Plan B");
    fireEvent.click(held);
    expect(onPick).not.toHaveBeenCalled();
    expect(tab(/Plan C/)).toHaveAttribute("aria-selected", "true");
  });

  it("does not save the rival the active plan already holds again", () => {
    const { onPick } = setup({ plan: ["gam", "", ""] });
    fireEvent.click(screen.getByRole("button", { name: /GAM Esports/ }));
    expect(onPick).not.toHaveBeenCalled();
  });
});

describe("ScrimSlotPane clearing", () => {
  it("ends the grid with Not planned on tab A and No fallback on B and C", () => {
    setup({ plan: ["gam", "tsw", "mvk"] });
    expect(lastCell()).toHaveTextContent("Not planned");
    fireEvent.click(tab(/Plan B/));
    expect(lastCell()).toHaveTextContent("No fallback");
    fireEvent.click(tab(/Plan C/));
    expect(lastCell()).toHaveTextContent("No fallback");
  });

  it("clears the active plan without moving the tab", () => {
    const { onPick } = setup({ plan: ["gam", "tsw", ""] });
    fireEvent.click(tab(/Plan B/));
    fireEvent.click(lastCell());
    expect(onPick).toHaveBeenCalledWith(1, "");
    expect(tab(/Plan B/)).toHaveAttribute("aria-selected", "true");
  });

  it("shows the clear cell as chosen while the plan is empty and does not save it again", () => {
    const { onPick } = setup();
    const clear = lastCell();
    expect(clear).toHaveAttribute("aria-pressed", "true");
    expect(clear.querySelector('[data-slot="choice-check"]')).not.toBeNull();
    fireEvent.click(clear);
    expect(onPick).not.toHaveBeenCalled();
  });
});

describe("ScrimSlotPane note and scrolling", () => {
  it("says what Win and Accepts mean on tab A and the plan rule on tabs B and C", () => {
    setup();
    expect(screen.getByRole("note")).toHaveTextContent(/Win is your chance to win the scrim\. Accepts is the chance this rival takes a slot with two or more plans\./);
    expect(screen.getByRole("note")).not.toHaveTextContent(/Plan A plays if every plan declines/);
    fireEvent.click(tab(/Plan B/));
    expect(screen.getByRole("note")).toHaveTextContent("A slot with one plan always plays it, and Plan A plays if every plan declines.");
    expect(screen.getByRole("note")).not.toHaveTextContent(/Win is your chance/);
  });

  it("scrolls the grid inside the pane while the tab row and the note stay outside the scroller", () => {
    setup();
    expect(grid().className).toContain("overflow-y-auto");
    expect(grid().contains(screen.getByRole("tablist"))).toBe(false);
    expect(grid().contains(screen.getByRole("note"))).toBe(false);
    expect(grid().className).toContain("min-h-0");
  });
});

describe("ScrimSlotPane saving", () => {
  it("keeps the cells in place but cannot pick while a save is running", () => {
    const { onPick } = setup({ disabled: true });
    const cell = screen.getByRole("button", { name: /Team Secret Whales/ });
    expect(cell).toHaveAttribute("aria-disabled", "true");
    expect(cell).not.toBeDisabled();
    fireEvent.click(cell);
    expect(onPick).not.toHaveBeenCalled();
  });
});

describe("ScrimSlotPane read-only", () => {
  const readOnly = { readOnly: true, plan: ["mvk", "gam", ""], blockedText: "Setup locked once block starts" };

  it("shows the three plans as text with no grid and no tabs", () => {
    setup(readOnly);
    expect(screen.getByRole("heading", { name: "Thu A" })).toBeInTheDocument();
    expect(screen.getByText("Setup locked once block starts")).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("group", { name: "Rivals by overall rating" })).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    const list = screen.getByRole("list");
    expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Plan AMVK Esports",
      "Plan BGAM Esports",
      "Plan CNo fallback",
    ]);
  });

  it("marks the plan that was played", () => {
    setup({ ...readOnly, resolvedTeamId: "gam" });
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items[1]).toHaveTextContent("Played");
    expect(items[0]).not.toHaveTextContent("Played");
  });

  it("words an empty or cleared slot as the desktop recap does", () => {
    const { rerender } = setup({ ...readOnly, plan: ["", "", ""] });
    expect(within(screen.getByRole("list")).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Plan ANo opponent set",
      "Plan BNo fallback",
      "Plan CNo fallback",
    ]);
    rerender(
      <ScrimSlotPane
        slotLabel="Thu A"
        plan={["", "", ""]}
        rivals={RIVALS}
        teamNameById={NAMES}
        readOnly
        disabled={false}
        blockedText={null}
        doneTo="Thu B"
        resolvedTeamId={null}
        cleared
        onPick={() => {}}
        onDone={() => {}}
      />,
    );
    expect(within(screen.getByRole("list")).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Plan APlan cleared",
      "Plan B-",
      "Plan C-",
    ]);
  });
});
