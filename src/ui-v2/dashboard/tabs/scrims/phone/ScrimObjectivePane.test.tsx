import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { ScrimObjectivePane, type ScrimObjectivePaneProps } from "./ScrimObjectivePane";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

function setup(props: Partial<ScrimObjectivePaneProps> = {}) {
  const onSelect = vi.fn();
  const utils = render(<ScrimObjectivePane objective="EarlyGame" disabled={false} blockedText={null} onSelect={onSelect} {...props} />);
  return { onSelect, ...utils };
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

describe("ScrimObjectivePane", () => {
  it("has the heading and the intro", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Weekly objective" })).toBeInTheDocument();
    expect(screen.getByText(/Define what you want to learn this week/)).toBeInTheDocument();
  });

  it("offers the seven objectives, in the desktop order, as one labelled group of buttons", () => {
    setup();
    const group = screen.getByRole("group", { name: "Weekly objective" });
    expect(within(group).getAllByRole("button").map((button) => button.textContent)).toEqual(NAMES);
  });

  it("marks the chosen one with a check as well as the checked state", () => {
    const { container } = setup();
    expect(screen.getByRole("button", { name: "Fix early game" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("button").filter((button) => button.getAttribute("aria-pressed") === "true")).toHaveLength(1);
    const checks = container.querySelectorAll('[data-slot="choice-check"]');
    expect(checks).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Fix early game" })).toContainElement(checks[0] as HTMLElement);
  });

  it("saves with one tap and maps No objective to null", () => {
    const { onSelect } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Improve teamfights" }));
    expect(onSelect).toHaveBeenLastCalledWith("Teamfighting");
    fireEvent.click(screen.getByRole("button", { name: "No objective set" }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("says the impact of the chosen objective in the eighth cell", () => {
    const { rerender, onSelect } = setup();
    expect(screen.getByText(/Improves lane control, early tempo, and first rotations\./)).toHaveTextContent(/^Impact/);
    rerender(<ScrimObjectivePane objective={null} disabled={false} blockedText={null} onSelect={onSelect} />);
    expect(screen.getByText(/No focus impact data/)).toHaveTextContent(/^Impact/);
  });

  it("keeps every card at least the touch size", () => {
    setup();
    for (const button of screen.getAllByRole("button")) {
      expect(button.className).toContain("min-h-[var(--hit)]");
    }
  });

  it("says why it is locked first and keeps the cards in place, aria-disabled and focusable", () => {
    const { onSelect, container } = setup({ disabled: true, blockedText: "Setup locked once block starts" });
    const lock = screen.getByText("Setup locked once block starts");
    const heading = screen.getByRole("heading", { name: "Weekly objective" });
    expect(heading.compareDocumentPosition(lock) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector("p")).toBe(lock.closest("p"));
    const radio = screen.getByRole("button", { name: "Expand champion pool" });
    expect(radio).toHaveAttribute("aria-disabled", "true");
    expect(radio).not.toBeDisabled();
    radio.focus();
    expect(radio).toHaveFocus();
    fireEvent.click(radio);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("does not choose on an arrow key: only a press does", () => {
    const { onSelect } = setup();
    const choice = screen.getByRole("button", { name: "Improve teamfights" });
    choice.focus();
    for (const key of ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"]) fireEvent.keyDown(choice, { key });
    expect(onSelect).not.toHaveBeenCalled();
    // Enter and Space on a native button fire this click.
    expect(choice.tagName).toBe("BUTTON");
    fireEvent.click(choice);
    expect(onSelect).toHaveBeenCalledWith("Teamfighting");
  });
});
