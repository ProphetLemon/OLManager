import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { ScrimVolumePane, type ScrimVolumePaneProps } from "./ScrimVolumePane";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

afterEach(async () => {
  await i18n.changeLanguage("en");
});

function props(over: Partial<ScrimVolumePaneProps> = {}): ScrimVolumePaneProps {
  return {
    title: "Volume",
    onBack: vi.fn(),
    capacity: 6,
    weekdayLabels: WEEKDAYS,
    disabled: false,
    autofillDisabled: false,
    blockedText: null,
    assistant: false,
    onVolume: vi.fn(),
    onAutofill: vi.fn(),
    onAssistant: vi.fn(),
    onFinalize: vi.fn(),
    ...over,
  };
}

function setup(over: Partial<ScrimVolumePaneProps> = {}) {
  const p = props(over);
  const utils = render(<ScrimVolumePane {...p} />);
  return { ...p, ...utils, again: (next: Partial<ScrimVolumePaneProps>) => utils.rerender(<ScrimVolumePane {...p} {...next} />) };
}

const volumes = () => within(screen.getByRole("group", { name: "Weekly Volume" })).getAllByRole("button");
const finalize = () => screen.getByRole("button", { name: /Finalize Setup/ });
const switchEl = () => screen.getByRole("switch", { name: /Assistant/ });

describe("ScrimVolumePane in its frame", () => {
  it("has one heading, the frame's title, and a back control that goes back", () => {
    const { onBack } = setup();
    const headings = screen.getAllByRole("heading");
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("Volume");
    fireEvent.click(screen.getByRole("button", { name: "Back: Volume" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("draws no card around the whole view", () => {
    const { container } = setup();
    expect((container.querySelector('[data-slot="scrim-view-body"]') as HTMLElement).className).not.toContain("bg-card");
    expect(container.querySelector('[data-slot="scrim-volume-pane"]')?.className).not.toContain("bg-");
  });
});

describe("ScrimVolumePane volumes", () => {
  it("offers 2, 4 and 6, each with its number and its days in words", () => {
    setup();
    expect(volumes().map((button) => button.textContent)).toEqual(["2Wed", "4Wed, Thu", "6Wed, Thu, Fri"]);
    expect(volumes().map((button) => button.getAttribute("aria-label"))).toEqual(["Volume 2: Wed", "Volume 4: Wed, Thu", "Volume 6: Wed, Thu, Fri"]);
  });

  it("draws the days as pips: as many filled as blocks, six places in all, hidden from assistive technology", () => {
    setup();
    const filled = volumes().map((button) => {
      const pips = button.querySelector('[data-slot="volume-pips"]') as HTMLElement;
      expect(pips).toHaveAttribute("aria-hidden", "true");
      expect(pips.querySelectorAll('[data-slot="volume-pip"]')).toHaveLength(6);
      return pips.querySelectorAll('[data-slot="volume-pip"][data-filled="true"]').length;
    });
    expect(filled).toEqual([2, 4, 6]);
  });

  it("marks the chosen volume with an outline and a check and every other with a hollow ring", () => {
    const { container } = setup();
    const six = screen.getByRole("button", { name: /^Volume 6/ });
    expect(six).toHaveAttribute("aria-pressed", "true");
    expect(six.className).toContain("border-club");
    expect(container.querySelectorAll('[data-slot="choice-check"]')).toHaveLength(1);
    expect(six.querySelector('[data-slot="choice-check"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-slot="choice-ring"]')).toHaveLength(2);
    for (const other of volumes().filter((button) => button !== six)) {
      expect(other).toHaveAttribute("aria-pressed", "false");
      expect(other.className).toContain("border-transparent");
      expect(other.querySelector('[data-slot="choice-ring"]')).not.toBeNull();
    }
  });

  it("saves another volume with one tap, and does not choose on an arrow key", () => {
    const { onVolume } = setup();
    const four = screen.getByRole("button", { name: /^Volume 4/ });
    four.focus();
    for (const key of ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"]) fireEvent.keyDown(four, { key });
    expect(onVolume).not.toHaveBeenCalled();
    fireEvent.click(four);
    expect(onVolume).toHaveBeenCalledWith(4);
  });
});

describe("ScrimVolumePane Rellenar", () => {
  it("is one outlined button of the touch size that fills the plans", () => {
    const { onAutofill } = setup();
    const button = screen.getByRole("button", { name: "Autofill" });
    expect(button.className).toContain("h-[var(--hit)]");
    expect(button.className).toContain("border-muted-foreground");
    expect(button.className).not.toMatch(/\bbg-club/);
    fireEvent.click(button);
    expect(onAutofill).toHaveBeenCalledTimes(1);
  });

  it("stays in place, aria-disabled and focusable and not dimmed, when it is off", () => {
    const { onAutofill } = setup({ autofillDisabled: true });
    const button = screen.getByRole("button", { name: "Autofill" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    expect(button.className).not.toMatch(/opacity/);
    fireEvent.click(button);
    expect(onAutofill).not.toHaveBeenCalled();
  });
});

describe("ScrimVolumePane assistant", () => {
  it("is a switch that says its state by position, a check and words", () => {
    const { onAssistant, container, again } = setup();
    expect(switchEl()).toHaveAttribute("aria-checked", "false");
    expect(switchEl()).toHaveTextContent("Delegation: Manual");
    expect(container.querySelector('[data-slot="toggle-check"]')).toBeNull();
    fireEvent.click(switchEl());
    expect(onAssistant).toHaveBeenCalledWith(true);

    again({ assistant: true });
    expect(switchEl()).toHaveAttribute("aria-checked", "true");
    expect(switchEl()).toHaveTextContent("Delegation: Auto");
    expect(container.querySelector('[data-slot="toggle-check"]')).not.toBeNull();
    fireEvent.click(switchEl());
    expect(onAssistant).toHaveBeenLastCalledWith(false);
  });

  it("with the assistant on, replaces Rellenar and Confirmar with one read-only block of its two sentences", () => {
    setup({ assistant: true, blockedText: "Assistant is handling scrims" });
    expect(screen.queryByRole("button", { name: "Autofill" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Finalize/ })).toBeNull();
    expect(screen.getAllByText("Assistant is handling scrims")).toHaveLength(1);
    expect(screen.getByText(/In Assistant mode, Continue advances 1 day/)).toBeInTheDocument();
    expect(document.querySelector('[data-slot="scrim-assistant-block"]')).not.toBeNull();
  });
});

describe("ScrimVolumePane Confirmar", () => {
  it("holds its sentence in full on the left and itself, outlined and never club-filled, at the right end", () => {
    const { onFinalize, container } = setup();
    const button = finalize();
    const sentence = screen.getByText("Finalizing locks this week's setup. It reopens next Monday.");
    expect(button).not.toHaveTextContent("Finalizing locks");
    expect(button.className).toContain("border-foreground");
    expect(button.className).not.toMatch(/\bbg-(club|primary)/);
    const row = button.parentElement as HTMLElement;
    expect(row).toContainElement(sentence);
    expect(sentence.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row.lastElementChild).toBe(button);
    expect(row.contains(screen.getByRole("button", { name: "Autofill" }))).toBe(false);
    expect(container.querySelector('[data-slot="scrim-view-top"]')).not.toContainElement(button);
    fireEvent.click(button);
    expect(onFinalize).toHaveBeenCalledTimes(1);
  });

  it("is diagonal from Rellenar: in the last row, in another row than Rellenar and not next to it", () => {
    setup();
    const rows = Array.from(document.querySelectorAll('[data-slot="volume-row"]'));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContainElement(screen.getByRole("button", { name: "Autofill" }));
    expect(rows[1]).toContainElement(finalize());
    const controls = Array.from(document.querySelectorAll("button"));
    const at = (needle: string) => controls.findIndex((control) => (control.textContent ?? "").includes(needle));
    expect(at("Autofill")).toBeLessThan(at("Finalize Setup"));
    // The switch sits between them, so the two buttons are never neighbours.
    expect(controls[at("Autofill") + 1]).toBe(switchEl());
  });
});

describe("ScrimVolumePane locked and saving", () => {
  it("says why in the top row and keeps every control in place, aria-disabled, focusable and not dimmed", () => {
    const { onVolume, onFinalize, onAutofill, container } = setup({ disabled: true, autofillDisabled: true, blockedText: "Setup locked once block starts" });
    expect(container.querySelector('[data-slot="scrim-view-top"]')).toContainElement(screen.getByText("Setup locked once block starts"));
    const four = screen.getByRole("button", { name: /^Volume 4/ });
    const rellenar = screen.getByRole("button", { name: "Autofill" });
    for (const control of [four, finalize(), rellenar]) {
      expect(control).toHaveAttribute("aria-disabled", "true");
      expect(control).not.toBeDisabled();
      expect(control.className).not.toMatch(/opacity/);
    }
    four.focus();
    expect(four).toHaveFocus();
    fireEvent.click(four);
    fireEvent.click(finalize());
    fireEvent.click(rellenar);
    expect(onVolume).not.toHaveBeenCalled();
    expect(onFinalize).not.toHaveBeenCalled();
    expect(onAutofill).not.toHaveBeenCalled();
  });

  it("keeps the assistant switch usable while the setup is locked", () => {
    const { onAssistant } = setup({ disabled: true, autofillDisabled: true, blockedText: "x" });
    expect(switchEl()).not.toHaveAttribute("aria-disabled");
    fireEvent.click(switchEl());
    expect(onAssistant).toHaveBeenCalledWith(true);
  });

  it("while a save runs does nothing on a press and says no reason", () => {
    const { onVolume, container } = setup({ disabled: true, autofillDisabled: true, blockedText: null });
    expect(container.querySelector('[data-slot="phone-lock-line"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Volume 2/ }));
    expect(onVolume).not.toHaveBeenCalled();
  });
});
