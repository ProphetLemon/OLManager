import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { ScrimVolumePane, type ScrimVolumePaneProps } from "./ScrimVolumePane";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

afterEach(async () => {
  await i18n.changeLanguage("en");
});

function setup(props: Partial<ScrimVolumePaneProps> = {}) {
  const handlers = { onVolume: vi.fn(), onAutofill: vi.fn(), onAssistant: vi.fn(), onFinalize: vi.fn() };
  const utils = render(
    <ScrimVolumePane
      capacity={6}
      weekdayLabels={WEEKDAYS}
      disabled={false}
      autofillDisabled={false}
      blockedText={null}
      assistant={false}
      {...handlers}
      {...props}
    />,
  );
  return { ...handlers, ...utils };
}

describe("ScrimVolumePane volumes", () => {
  it("has the heading and the three volumes with their weekdays", () => {
    setup();
    expect(screen.getByRole("heading", { name: "Weekly Volume" })).toBeInTheDocument();
    const group = screen.getByRole("radiogroup", { name: "Weekly Volume" });
    expect(within(group).getAllByRole("radio").map((radio) => radio.closest("label")?.textContent)).toEqual([
      "2Wed",
      "4Wed, Thu",
      "6Wed, Thu, Fri",
    ]);
  });

  it("marks the chosen volume with a check and saves another with one tap", () => {
    const { onVolume, container } = setup();
    expect(screen.getByRole("radio", { name: /^6/ })).toBeChecked();
    expect(container.querySelectorAll('[data-slot="choice-check"]')).toHaveLength(1);
    fireEvent.click(screen.getByRole("radio", { name: /^4/ }));
    expect(onVolume).toHaveBeenCalledWith(4);
  });
});

describe("ScrimVolumePane Autofill", () => {
  it("is one wide outline button", () => {
    const { onAutofill } = setup();
    const button = screen.getByRole("button", { name: "Autofill" });
    expect(button.className).toContain("w-full");
    expect(button.className).toContain("min-h-[var(--hit)]");
    fireEvent.click(button);
    expect(onAutofill).toHaveBeenCalledTimes(1);
  });

  it("stays in place, aria-disabled and focusable, when it is off", () => {
    const { onAutofill } = setup({ autofillDisabled: true });
    const button = screen.getByRole("button", { name: "Autofill" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(onAutofill).not.toHaveBeenCalled();
  });
});

describe("ScrimVolumePane assistant", () => {
  it("is a toggle that says its state by a check and by words", () => {
    const { onAssistant, rerender, container, ...rest } = setup();
    const toggle = screen.getByRole("button", { name: /Assistant/ });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).toHaveTextContent("Delegation: Manual");
    expect(container.querySelector('[data-slot="toggle-check"]')).toBeNull();
    fireEvent.click(toggle);
    expect(onAssistant).toHaveBeenCalledWith(true);

    rerender(
      <ScrimVolumePane
        capacity={6}
        weekdayLabels={WEEKDAYS}
        disabled={false}
        autofillDisabled={false}
        blockedText={null}
        assistant
        onVolume={rest.onVolume}
        onAutofill={rest.onAutofill}
        onAssistant={onAssistant}
        onFinalize={rest.onFinalize}
      />,
    );
    const on = screen.getByRole("button", { name: /Assistant/ });
    expect(on).toHaveAttribute("aria-pressed", "true");
    expect(on).toHaveTextContent("Delegation: Auto");
    expect(container.querySelector('[data-slot="toggle-check"]')).not.toBeNull();
    fireEvent.click(on);
    expect(onAssistant).toHaveBeenLastCalledWith(false);
  });

  it("replaces Autofill and Finalize with one read-only block of the two assistant sentences", () => {
    setup({ assistant: true, blockedText: "Assistant is handling scrims" });
    expect(screen.queryByRole("button", { name: "Autofill" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Finalize/ })).toBeNull();
    expect(screen.getAllByText("Assistant is handling scrims")).toHaveLength(1);
    expect(screen.getByText(/In Assistant mode, Continue advances 1 day/)).toBeInTheDocument();
  });
});

describe("ScrimVolumePane Finalize", () => {
  it("is one 56 px button that holds its label and the sentence", () => {
    const { onFinalize } = setup();
    const button = screen.getByRole("button", { name: /Finalize Setup/ });
    expect(button).toHaveTextContent("Finalizing locks this week's setup. It reopens next Monday.");
    expect(button.className).toContain("h-14");
    fireEvent.click(button);
    expect(onFinalize).toHaveBeenCalledTimes(1);
  });

  it("sits below Autofill and the assistant row", () => {
    setup();
    const order = screen.getAllByRole("button").map((button) => button.textContent ?? "");
    const at = (needle: string) => order.findIndex((text) => text.includes(needle));
    expect(at("Autofill")).toBeLessThan(at("Assistant"));
    expect(at("Assistant")).toBeLessThan(at("Finalize Setup"));
  });
});

describe("ScrimVolumePane locked", () => {
  it("says why first and keeps every control in place, aria-disabled and focusable", () => {
    const { onVolume, onFinalize, onAutofill } = setup({
      disabled: true,
      autofillDisabled: true,
      blockedText: "Setup locked once block starts",
    });
    const heading = screen.getByRole("heading", { name: "Weekly Volume" });
    const lock = screen.getByText("Setup locked once block starts");
    expect(heading.compareDocumentPosition(lock) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const radio = screen.getByRole("radio", { name: /^4/ });
    const finalize = screen.getByRole("button", { name: /Finalize Setup/ });
    for (const control of [radio, finalize, screen.getByRole("button", { name: "Autofill" })]) {
      expect(control).toHaveAttribute("aria-disabled", "true");
      expect(control).not.toBeDisabled();
    }
    fireEvent.click(radio);
    fireEvent.click(finalize);
    fireEvent.click(screen.getByRole("button", { name: "Autofill" }));
    expect(onVolume).not.toHaveBeenCalled();
    expect(onFinalize).not.toHaveBeenCalled();
    expect(onAutofill).not.toHaveBeenCalled();
  });

  it("keeps the assistant toggle usable while the setup is locked", () => {
    const { onAssistant } = setup({ disabled: true, autofillDisabled: true, blockedText: "x" });
    fireEvent.click(screen.getByRole("button", { name: /Assistant/ }));
    expect(onAssistant).toHaveBeenCalledWith(true);
  });
});
