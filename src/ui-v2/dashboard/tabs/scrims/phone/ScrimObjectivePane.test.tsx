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

  it("offers the seven objectives, in the desktop order, as one radio group named by the heading", () => {
    setup();
    const group = screen.getByRole("radiogroup", { name: "Weekly objective" });
    expect(within(group).getAllByRole("radio").map((radio) => radio.closest("label")?.textContent)).toEqual(NAMES);
  });

  it("marks the chosen one with a check as well as the checked state", () => {
    const { container } = setup();
    expect(screen.getByRole("radio", { name: "Fix early game" })).toBeChecked();
    expect(screen.getAllByRole("radio").filter((radio) => (radio as HTMLInputElement).checked)).toHaveLength(1);
    const checks = container.querySelectorAll('[data-slot="choice-check"]');
    expect(checks).toHaveLength(1);
    expect(screen.getByRole("radio", { name: "Fix early game" }).closest("label")).toContainElement(checks[0] as HTMLElement);
  });

  it("saves with one tap and maps No objective to null", () => {
    const { onSelect } = setup();
    fireEvent.click(screen.getByRole("radio", { name: "Improve teamfights" }));
    expect(onSelect).toHaveBeenLastCalledWith("Teamfighting");
    fireEvent.click(screen.getByRole("radio", { name: "No objective set" }));
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
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio.closest("label")?.innerHTML).toContain("min-h-[var(--hit)]");
    }
  });

  it("says why it is locked first and keeps the cards in place, aria-disabled and focusable", () => {
    const { onSelect, container } = setup({ disabled: true, blockedText: "Setup locked once block starts" });
    const lock = screen.getByText("Setup locked once block starts");
    const heading = screen.getByRole("heading", { name: "Weekly objective" });
    expect(heading.compareDocumentPosition(lock) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector("p")).toBe(lock.closest("p"));
    const radio = screen.getByRole("radio", { name: "Expand champion pool" });
    expect(radio).toHaveAttribute("aria-disabled", "true");
    expect(radio).not.toBeDisabled();
    radio.focus();
    expect(radio).toHaveFocus();
    fireEvent.click(radio);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
