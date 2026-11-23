import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { ScrimObjectivePane, type ScrimObjectivePaneProps } from "./ScrimObjectivePane";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

function setup(props: Partial<ScrimObjectivePaneProps> = {}) {
  const onSelect = vi.fn();
  const onBack = vi.fn();
  const utils = render(
    <ScrimObjectivePane title="Objective" onBack={onBack} objective="EarlyGame" disabled={false} blockedText={null} onSelect={onSelect} {...props} />,
  );
  return { onSelect, onBack, ...utils };
}

const NAMES = [
  "No objective set",
  "Prepare draft vs next rival",
  "Expand champion pool",
  "Fix early game",
  "Improve teamfights",
  "Polish macro and objectives",
  "Stabilize mental",
];

const choices = () => within(screen.getByRole("group", { name: "Weekly objective" })).getAllByRole("button");

describe("ScrimObjectivePane in its frame", () => {
  it("has one heading, the frame's title, and no second heading under it", () => {
    setup();
    const headings = screen.getAllByRole("heading");
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("Objective");
    expect(headings[0]).toHaveAttribute("tabindex", "-1");
    expect(screen.queryByText(/Define what you want to learn this week/)).toBeNull();
  });

  it("has a real back control that goes back", () => {
    const { onBack } = setup();
    const back = screen.getByRole("button", { name: "Back: Objective" });
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("draws no card around the whole view", () => {
    const { container } = setup();
    const body = container.querySelector('[data-slot="scrim-view-body"]') as HTMLElement;
    expect(body.className).not.toContain("bg-card");
    expect(container.querySelector('[data-slot="scrim-objective-pane"]')?.className).not.toContain("bg-");
  });
});

describe("ScrimObjectivePane choices", () => {
  it("offers the seven objectives in reading order, as one labelled group of buttons", () => {
    setup();
    expect(choices().map((button) => button.textContent)).toEqual(NAMES);
  });

  it("gives each choice one stroke icon of its own and keeps it at least the touch size", () => {
    setup();
    for (const button of choices()) {
      expect(button.querySelectorAll('[data-slot="objective-icon"]')).toHaveLength(1);
      expect(button.className).toContain("min-h-[var(--hit)]");
    }
    const icons = choices().map((button) => button.querySelector('[data-slot="objective-icon"]')?.getAttribute("class"));
    expect(new Set(icons.map((icon) => icon?.match(/lucide-[a-z-]+/)?.[0])).size).toBe(7);
  });

  it("marks the chosen one with a check and an outline, and every other with a hollow ring", () => {
    const { container } = setup();
    const chosen = screen.getByRole("button", { name: "Fix early game" });
    expect(chosen).toHaveAttribute("aria-pressed", "true");
    expect(choices().filter((button) => button.getAttribute("aria-pressed") === "true")).toHaveLength(1);
    expect(chosen.className).toContain("border-club");
    const checks = container.querySelectorAll('[data-slot="choice-check"]');
    expect(checks).toHaveLength(1);
    expect(chosen).toContainElement(checks[0] as HTMLElement);
    expect(container.querySelectorAll('[data-slot="choice-ring"]')).toHaveLength(6);
    for (const other of choices().filter((button) => button !== chosen)) {
      expect(other.querySelector('[data-slot="choice-ring"]')).not.toBeNull();
      expect(other.querySelector('[data-slot="choice-check"]')).toBeNull();
    }
  });

  it("draws no box around a choice that is not chosen", () => {
    setup();
    for (const other of choices().filter((button) => button.getAttribute("aria-pressed") === "false")) {
      expect(other.className).toContain("border-transparent");
      expect(other.className).not.toMatch(/\bbg-/);
    }
  });

  it("marks No objective set as chosen when there is none", () => {
    setup({ objective: null });
    expect(screen.getByRole("button", { name: "No objective set" })).toHaveAttribute("aria-pressed", "true");
  });

  it("saves with one tap and maps No objective to null", () => {
    const { onSelect } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Improve teamfights" }));
    expect(onSelect).toHaveBeenLastCalledWith("Teamfighting");
    fireEvent.click(screen.getByRole("button", { name: "No objective set" }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("does not choose on an arrow key: only a press does", () => {
    const { onSelect } = setup();
    const choice = screen.getByRole("button", { name: "Improve teamfights" });
    choice.focus();
    for (const key of ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"]) fireEvent.keyDown(choice, { key });
    expect(onSelect).not.toHaveBeenCalled();
    expect(choice.tagName).toBe("BUTTON");
    fireEvent.click(choice);
    expect(onSelect).toHaveBeenCalledWith("Teamfighting");
  });

  it("says every label in full in the longest language, never cut", async () => {
    await i18n.changeLanguage("es");
    setup();
    const longest = screen.getByRole("button", { name: "Preparar el draft contra el próximo rival" });
    expect(longest).toHaveTextContent("Preparar el draft contra el próximo rival");
    for (const button of within(screen.getByRole("group", { name: "Objetivo semanal" })).getAllByRole("button")) expect(button.innerHTML).not.toMatch(/truncate|line-clamp/);
  });
});

describe("ScrimObjectivePane impact", () => {
  it("says the impact of the chosen objective once, headed Impact", () => {
    const { rerender, onSelect, onBack } = setup();
    const sentence = screen.getAllByText(/Improves lane control, early tempo, and first rotations\./);
    expect(sentence).toHaveLength(1);
    expect(sentence[0]).toHaveTextContent(/^Impact/);
    rerender(<ScrimObjectivePane title="Objective" onBack={onBack} objective={null} disabled={false} blockedText={null} onSelect={onSelect} />);
    expect(screen.getAllByText(/No focus impact data/)).toHaveLength(1);
    expect(screen.getByText(/No focus impact data/)).toHaveTextContent(/^Impact/);
  });
});

describe("ScrimObjectivePane locked, assistant and saving", () => {
  it("says why it is locked in the top row, and keeps every choice in place, aria-disabled, focusable and not dimmed", () => {
    const { onSelect, container } = setup({ disabled: true, blockedText: "Setup locked once block starts" });
    const lock = screen.getByText("Setup locked once block starts");
    const top = container.querySelector('[data-slot="scrim-view-top"]') as HTMLElement;
    expect(top).toContainElement(lock);
    const choice = screen.getByRole("button", { name: "Expand champion pool" });
    expect(choice).toHaveAttribute("aria-disabled", "true");
    expect(choice).not.toBeDisabled();
    expect(choice.className).not.toMatch(/opacity/);
    choice.focus();
    expect(choice).toHaveFocus();
    fireEvent.click(choice);
    expect(onSelect).not.toHaveBeenCalled();
    for (const button of choices()) expect(button).toHaveAttribute("aria-disabled", "true");
  });

  it("shows the assistant's sentence as the reason when the assistant handles scrims", () => {
    const { onSelect } = setup({ disabled: true, blockedText: "Assistant is handling scrims" });
    expect(screen.getByText("Assistant is handling scrims")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Fix early game" }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("while a save runs keeps its place, does nothing on a press and says no reason", () => {
    const { onSelect, container } = setup({ disabled: true, blockedText: null });
    expect(container.querySelector('[data-slot="phone-lock-line"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Improve teamfights" }));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
