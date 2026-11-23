import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import type { PhoneCell, PhoneSlotCell, PhoneWeekModel } from "@/lib/scrims/phoneWeek";
import { ScrimWeekList, type ScrimWeekListProps } from "./ScrimWeekList";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TEAMS = new Map([["mvk", "MVK Esports"], ["gam", "GAM Esports"]]);

afterEach(async () => {
  await i18n.changeLanguage("en");
});

function slot(slotIndex: number, overrides: Partial<PhoneSlotCell> = {}): PhoneSlotCell {
  return {
    kind: "slot",
    id: `slot:${slotIndex}`,
    tag: null,
    slotIndex,
    weekday: 2 + Math.floor(slotIndex / 2),
    suffix: slotIndex % 2 === 0 ? "A" : "B",
    status: "Open",
    rival: { kind: "none" },
    result: null,
    quality: null,
    ...overrides,
  };
}

function model(overrides: Partial<PhoneWeekModel> = {}, slots: PhoneSlotCell[] = [slot(0), slot(1), slot(2), slot(3), slot(4), slot(5)]): PhoneWeekModel {
  const rows: PhoneCell[][] = [
    [{ kind: "objective", id: "objective", tag: null, objective: "EarlyGame", locked: false }],
    [
      { kind: "volume", id: "volume", tag: null, capacity: 6, days: [2, 3, 4], locked: false },
      { kind: "report", id: "report", tag: null, wins: 0, losses: 0 },
    ],
    [slots[0], slots[1]],
    [slots[2], slots[3]],
    [slots[4], slots[5]],
  ];
  return {
    rows,
    openRow: "volume",
    gauges: { planned: 2, capacity: 6, plannedSlots: [true, true, false, false, false, false], wins: 0, losses: 0, reputation: 50, cancellations: 0 },
    ...overrides,
  };
}

function setup(props: Partial<ScrimWeekListProps> = {}) {
  const onSelect = vi.fn();
  const utils = render(
    <ScrimWeekList model={model()} selectedId="volume" teamNameById={TEAMS} weekdayLabels={WEEKDAYS} onSelect={onSelect} {...props} />,
  );
  return { onSelect, ...utils };
}

describe("ScrimWeekList cells", () => {
  it("draws the objective, volume, report and one button per slot", () => {
    setup();
    expect(screen.getAllByRole("button")).toHaveLength(9);
    expect(screen.getByRole("button", { name: /Objective.*Fix early game/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Volume.*6, Wed, Thu, Fri/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Report.*No recent reports/ })).toBeInTheDocument();
  });

  it("shows the week record on the report cell once a block was played", () => {
    const base = model();
    base.rows[1][1] = { kind: "report", id: "report", tag: null, wins: 1, losses: 1 };
    setup({ model: base });
    expect(screen.getByRole("button", { name: /Report.*Week Record 1-1/ })).toBeInTheDocument();
  });

  it("names the objective as no objective set on a fresh week", () => {
    const base = model();
    base.rows[0][0] = { kind: "objective", id: "objective", tag: "next", objective: null, locked: false };
    setup({ model: base });
    expect(screen.getByRole("button", { name: /Objective.*No objective set/ })).toBeInTheDocument();
  });

  it("marks the selected cell with aria-current and no other", () => {
    setup({ selectedId: "slot:3" });
    const current = screen.getAllByRole("button").filter((button) => button.getAttribute("aria-current") === "true");
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("Thu B");
  });

  it("reports the row id on a tap", () => {
    const { onSelect } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Thu A/ }));
    fireEvent.click(screen.getByRole("button", { name: /Objective/ }));
    expect(onSelect.mock.calls).toEqual([["slot:2"], ["objective"]]);
  });

  it("names the rival, or says not planned or plan cleared", () => {
    const slots = [
      slot(0, { rival: { kind: "team", teamId: "mvk" } }),
      slot(1, { rival: { kind: "cleared" } }),
      slot(2),
      slot(3, { rival: { kind: "team", teamId: "unknown-id" } }),
      slot(4),
      slot(5),
    ];
    setup({ model: model({}, slots) });
    expect(screen.getByRole("button", { name: /Wed A.*MVK Esports/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Wed B.*Plan cleared/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Thu A.*Not planned/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Thu B.*unknown-id/ })).toBeInTheDocument();
  });

  it("tells the status with its word, never by colour alone, and keeps a locked cell focusable", () => {
    const slots = [slot(0, { status: "Locked" }), slot(1, { status: "Cancelled" }), slot(2, { status: "NotPlayed" }), slot(3), slot(4), slot(5)];
    setup({ model: model({}, slots) });
    const locked = screen.getByRole("button", { name: /Wed A.*Locked/ });
    expect(locked).not.toBeDisabled();
    expect(locked).not.toHaveAttribute("disabled");
    expect(locked.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("button", { name: /Wed B.*Cancelled/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Thu A.*Not played/ })).toBeInTheDocument();
  });

  it("shows the result letter and the quality of a played slot, with their words for assistive technology", () => {
    const slots = [
      slot(0, { status: "Reviewed", result: "lost", quality: 73, rival: { kind: "team", teamId: "mvk" } }),
      slot(1, { status: "Played", result: "won", quality: 64, rival: { kind: "team", teamId: "gam" } }),
      slot(2),
      slot(3),
      slot(4),
      slot(5),
    ];
    setup({ model: model({}, slots) });
    const lost = screen.getByRole("button", { name: /Wed A.*Reviewed.*Loss.*Q73/ });
    expect(lost).toHaveTextContent("Q73");
    expect(screen.getByRole("button", { name: /Wed B.*Played.*Win.*Q64/ })).toBeInTheDocument();
  });

  it("locks the objective and volume cells with an icon and their word", () => {
    const base = model();
    base.rows[0][0] = { kind: "objective", id: "objective", tag: null, objective: "Macro", locked: true };
    setup({ model: base });
    expect(screen.getByRole("button", { name: /Objective.*Locked/ })).not.toBeDisabled();
  });
});

describe("ScrimWeekList tags", () => {
  it("puts the tag inside its cell's button so a tap on it opens the row", () => {
    const slots = [slot(0), slot(1), slot(2, { tag: "next" }), slot(3), slot(4), slot(5)];
    const { onSelect } = setup({ model: model({}, slots) });
    const cell = screen.getByRole("button", { name: /Next.*Thu A/ });
    const tag = within(cell).getByText("Next");
    fireEvent.click(tag);
    expect(onSelect).toHaveBeenCalledWith("slot:2");
  });

  it.each([
    ["next", "Next"],
    ["today", "Today"],
    ["decide", "Decide"],
  ] as const)("words the %s tag", (tag, word) => {
    const slots = [slot(0, { tag }), slot(1), slot(2), slot(3), slot(4), slot(5)];
    setup({ model: model({}, slots) });
    expect(within(screen.getByRole("button", { name: new RegExp(`${word}.*Wed A`) })).getByText(word)).toBeInTheDocument();
  });

  it("marks the tagged cell with a 4 px club edge and no other cell", () => {
    const slots = [slot(0, { tag: "decide" }), slot(1), slot(2), slot(3), slot(4), slot(5)];
    setup({ model: model({}, slots), selectedId: "slot:1" });
    const edged = screen.getAllByRole("button").filter((cell) => cell.className.includes("shadow-[inset_4px_0_0_0_var(--club)]"));
    expect(edged).toHaveLength(1);
    expect(edged[0]).toHaveTextContent("Decide");
  });

  it("fills the tag with the club colour", () => {
    const slots = [slot(0, { tag: "next" }), slot(1), slot(2), slot(3), slot(4), slot(5)];
    const { container } = setup({ model: model({}, slots) });
    const tag = container.querySelector('[data-slot="phone-week-tag"]');
    expect(tag?.className).toMatch(/(^|\s)bg-club(\s|$)/);
  });
});

describe("ScrimWeekList gauges", () => {
  it("shows Planned n/N with one segment per slot", () => {
    const { container } = setup();
    const meter = screen.getByRole("meter", { name: "Planned" });
    expect(meter).toHaveAttribute("aria-valuenow", "2");
    expect(meter).toHaveAttribute("aria-valuemax", "6");
    expect(meter.children).toHaveLength(6);
    expect(container).toHaveTextContent("2/6");
  });

  it("draws the planned segments in the club colour and the rest dim", () => {
    setup();
    const segments = [...screen.getByRole("meter", { name: "Planned" }).children];
    expect(segments.map((segment) => /(^|\s)bg-club(\s|$)/.test(segment.className))).toEqual([true, true, false, false, false, false]);
  });

  it("draws the rep bar fill in the club colour", () => {
    setup();
    const fill = screen.getByRole("meter", { name: "Scrim rep" }).firstElementChild;
    expect(fill?.className).toMatch(/(^|\s)bg-club(\s|$)/);
  });

  it("shows the week record as W-L only", () => {
    const base = model({ gauges: { planned: 0, capacity: 6, plannedSlots: [], wins: 1, losses: 2, reputation: 50, cancellations: 3 } });
    setup({ model: base });
    expect(screen.getByText("1-2")).toBeInTheDocument();
    expect(screen.getByText("Week Record")).toBeInTheDocument();
    expect(screen.getByText("Cancellations").parentElement).toHaveTextContent("3");
  });

  it("shows the rep with its bar and no dashed mark until a cancel is armed", () => {
    const { container, rerender } = setup();
    const meter = screen.getByRole("meter", { name: "Scrim rep" });
    expect(meter).toHaveAttribute("aria-valuenow", "50");
    expect(container.querySelector('[data-slot="scrim-rep-ghost"]')).toBeNull();
    rerender(
      <ScrimWeekList model={model()} selectedId="volume" teamNameById={TEAMS} weekdayLabels={WEEKDAYS} ghostReputation={45} onSelect={() => {}} />,
    );
    expect(container.querySelector('[data-slot="scrim-rep-ghost"]')).not.toBeNull();
    expect(screen.getByRole("meter", { name: "Scrim rep" })).toHaveAccessibleDescription("Dashed mark: 45 after any follow-up.");
  });
});

describe("ScrimWeekList keyboard", () => {
  it("keeps one tab stop, on the selected cell", () => {
    setup({ selectedId: "slot:1" });
    const stops = screen.getAllByRole("button").filter((button) => button.tabIndex === 0);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toHaveTextContent("Wed B");
  });

  it("moves between cells with the arrows without selecting them", () => {
    const { onSelect } = setup({ selectedId: "objective" });
    const objective = screen.getByRole("button", { name: /Objective/ });
    objective.focus();
    fireEvent.keyDown(objective, { key: "ArrowRight" });
    expect(screen.getByRole("button", { name: /Volume/ })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowRight" });
    expect(screen.getByRole("button", { name: /Report/ })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowLeft" });
    expect(screen.getByRole("button", { name: /Volume/ })).toHaveFocus();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("moves down and up by visual row, keeping the column", () => {
    setup({ selectedId: "objective" });
    const objective = screen.getByRole("button", { name: /Objective/ });
    objective.focus();
    fireEvent.keyDown(objective, { key: "ArrowDown" });
    expect(screen.getByRole("button", { name: /Volume/ })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
    expect(screen.getByRole("button", { name: /Wed A/ })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowRight" });
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
    expect(screen.getByRole("button", { name: /Thu B/ })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowUp" });
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowUp" });
    expect(screen.getByRole("button", { name: /Report/ })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowUp" });
    expect(screen.getByRole("button", { name: /Objective/ })).toHaveFocus();
  });

  it("leaves Enter and Space to the button so a key press selects once", () => {
    const { onSelect } = setup();
    const button = screen.getByRole("button", { name: /Thu A/ });
    button.focus();
    expect(fireEvent.keyDown(button, { key: "Enter" })).toBe(true);
    expect(fireEvent.keyDown(button, { key: " " })).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("ScrimWeekList texts", () => {
  it("speaks the app language", async () => {
    await i18n.changeLanguage("es");
    setup();
    expect(screen.getByRole("button", { name: /Objetivo/ })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Semana de scrims" })).toBeInTheDocument();
  });
});
