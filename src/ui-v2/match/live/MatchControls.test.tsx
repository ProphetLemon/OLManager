import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";

import { MatchControls, SPEEDS, type MatchControlsProps } from "./MatchControls";

const css = readFileSync(resolve(__dirname, "liveMatch.css"), "utf8");

function setup(extra: Partial<MatchControlsProps> = {}) {
  const handlers = {
    onTogglePlay: vi.fn(),
    onSpeedChange: vi.fn(),
    onSkip: vi.fn(),
    onReset: vi.fn(),
  };
  const view = render(<MatchControls running speed={4} {...handlers} {...extra} />);
  return { ...view, ...handlers };
}

const options = () => screen.getByRole("button", { name: "Match options" });

/** Opens the options menu the way a pointer does. */
async function openMenu(name = "Match options") {
  const trigger = screen.getByRole("button", { name });
  act(() => trigger.focus());
  fireEvent.mouseDown(trigger);
  fireEvent.mouseUp(trigger);
  fireEvent.click(trigger);
  await screen.findByRole("menu");
  await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "true"));
  return trigger;
}

async function askFor(item: "Skip match" | "Reset match") {
  await openMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: item }));
  return screen.findByRole("alertdialog");
}

describe("pause and play", () => {
  it("offers Pause while the match runs and Play while it is paused, and presses once", () => {
    const { onTogglePlay, rerender, ...rest } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(onTogglePlay).toHaveBeenCalledTimes(1);
    rerender(<MatchControls running={false} speed={4} {...rest} onTogglePlay={onTogglePlay} />);
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
  });

  it("is the one filled button, at touch size", () => {
    setup();
    const pause = screen.getByRole("button", { name: "Pause" });
    expect(pause.className).toContain("bg-club");
    expect(pause.className).toContain("h-[var(--hit)]");
  });
});

describe("speed", () => {
  it("offers x1 x2 x4 x8 x12 with the engine's values and marks only the current one", () => {
    expect(SPEEDS.map((entry) => [entry.id, entry.value])).toEqual([
      ["x1", 4],
      ["x2", 8],
      ["x4", 16],
      ["x8", 32],
      ["x12", 48],
    ]);
    setup({ speed: 16 });
    const group = screen.getByRole("radiogroup", { name: "Simulation Speed" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((radio) => radio.textContent)).toEqual(["x1", "x2", "x4", "x8", "x12"]);
    expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual(["false", "false", "true", "false", "false"]);
  });

  it("reports the engine's value of the speed that was picked", () => {
    const { onSpeedChange } = setup();
    fireEvent.click(screen.getByRole("radio", { name: "x12" }));
    expect(onSpeedChange).toHaveBeenCalledTimes(1);
    expect(onSpeedChange).toHaveBeenCalledWith(48);
  });

  it("marks the current speed with more than colour: bold, the bar and an underline", () => {
    setup({ speed: 8 });
    const current = screen.getByRole("radio", { name: "x2" });
    expect(current.className).toContain("font-bold");
    expect(current.className).toContain("border-b-2");
    expect(css).toMatch(/\.arena-speed \[role="radio"\]\[aria-checked="true"\] \{[^}]*text-decoration: underline/);
  });

  it("says what the speed means in match seconds, with the singular rules", () => {
    const { rerender, ...rest } = setup({ speed: 48 });
    expect(screen.getByText("x12 = 48 match seconds per second")).toBeInTheDocument();
    rerender(<MatchControls running speed={4} {...rest} />);
    expect(screen.getByText("x1 = 4 match seconds per second")).toBeInTheDocument();
  });
});

describe("skip and reset", () => {
  it("keeps both out of sight until the options menu is open, and Reset marked as destructive", async () => {
    setup();
    expect(screen.queryByRole("button", { name: /skip|reset/i })).toBeNull();
    expect(options()).toHaveAttribute("aria-haspopup", "menu");
    await openMenu();
    expect(screen.getByRole("menuitem", { name: "Skip match" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Reset match" }).className).toContain("text-destructive");
    expect(screen.getByRole("menuitem", { name: "Skip match" }).className).not.toContain("text-destructive");
  });

  it("opens a modal dialog for Skip with the new copy, and nothing is called yet", async () => {
    const { onSkip, onReset } = setup();
    const dialog = await askFor("Skip match");
    expect(dialog).toHaveAccessibleName("Skip to the end?");
    expect(dialog).toHaveAccessibleDescription(
      "The rest of this match is played at once and the result is shown. You will not see it play out.",
    );
    expect(dialog).not.toHaveTextContent(/minute 0|re-simulate/i);
    expect(onSkip).not.toHaveBeenCalled();
    expect(onReset).not.toHaveBeenCalled();
  });

  it("puts focus on Cancel and makes the rest of the screen inert", async () => {
    setup();
    const dialog = await askFor("Skip match");
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    await waitFor(() => expect(cancel).toHaveFocus());
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "x1" })).toBeNull();
  });

  it("calls onSkip once, with nothing, when Skip is confirmed, and closes", async () => {
    const { onSkip, onReset } = setup();
    const dialog = await askFor("Skip match");
    fireEvent.click(within(dialog).getByRole("button", { name: "Show the result" }));
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledWith();
    expect(onReset).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("calls nothing when Skip is cancelled, and returns focus to the options button", async () => {
    const { onSkip, onReset, onTogglePlay } = setup();
    const dialog = await askFor("Skip match");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(onSkip).not.toHaveBeenCalled();
    expect(onReset).not.toHaveBeenCalled();
    expect(onTogglePlay).not.toHaveBeenCalled();
    await waitFor(() => expect(options()).toHaveFocus());
  });

  it("closes on Escape without calling anything, and returns focus to the options button", async () => {
    const { onSkip, onReset } = setup();
    const dialog = await askFor("Skip match");
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    await waitFor(() => expect(cancel).toHaveFocus());
    fireEvent.keyDown(cancel, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(onSkip).not.toHaveBeenCalled();
    expect(onReset).not.toHaveBeenCalled();
    await waitFor(() => expect(options()).toHaveFocus());
  });

  it("asks before a reset with its own words, and calls onReset once only when confirmed", async () => {
    const { onSkip, onReset } = setup();
    const dialog = await askFor("Reset match");
    expect(dialog).toHaveAccessibleName("Start this match again?");
    expect(dialog).toHaveAccessibleDescription(/goes back to minute 0/);
    expect(onReset).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Start again" }));
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledWith();
    expect(onSkip).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("does not reset when the reset dialog is cancelled", async () => {
    const { onReset } = setup();
    const dialog = await askFor("Reset match");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(onReset).not.toHaveBeenCalled();
  });
});

describe("after the winner", () => {
  it("disables Pause, every speed and the options menu", () => {
    setup({ disabled: true });
    expect(screen.getByRole("button", { name: "Pause" })).toBeDisabled();
    for (const radio of screen.getAllByRole("radio")) expect(radio).toBeDisabled();
    expect(options()).toBeDisabled();
  });

  it("enables them again while the match runs", () => {
    setup({ disabled: false });
    expect(screen.getByRole("button", { name: "Pause" })).toBeEnabled();
    expect(screen.getAllByRole("radio").every((radio) => !(radio as HTMLButtonElement).disabled)).toBe(true);
    expect(options()).toBeEnabled();
  });
});

describe("in the Spanish UI", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("es");
  });
  afterAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("speaks Spanish through the dialog and shows no raw key", async () => {
    const { container } = setup({ speed: 48 });
    expect(screen.getByRole("button", { name: "Pausa" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Velocidad de Simulación" })).toBeInTheDocument();
    expect(screen.getByText("x12 = 48 segundos de partida por segundo")).toBeInTheDocument();
    await openMenu("Opciones de la partida");
    fireEvent.click(screen.getByRole("menuitem", { name: "Saltar partida" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveAccessibleName("¿Saltar hasta el final?");
    expect(within(dialog).getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Ver el resultado" })).toBeInTheDocument();
    expect(`${container.textContent}${dialog.textContent}`).not.toMatch(/onAir\.match\./);
  });
});

describe("MatchControls speed note", () => {
  it("is the description and tooltip of the speed group, so it survives being hidden", () => {
    setup({ speed: 32 });
    const group = screen.getByRole("radiogroup", { name: "Simulation Speed" });
    const note = document.getElementById(group.getAttribute("aria-describedby") ?? "");
    expect(note).not.toBeNull();
    expect(note).toHaveTextContent("x8 = 32 match seconds per second");
    expect(group).toHaveAccessibleDescription("x8 = 32 match seconds per second");
    expect(group).toHaveAttribute("title", "x8 = 32 match seconds per second");
  });

  it("describes nothing when the speed is not one of the listed ones", () => {
    setup({ speed: 5 });
    const group = screen.getByRole("radiogroup", { name: "Simulation Speed" });
    expect(group).not.toHaveAttribute("aria-describedby");
    expect(group).not.toHaveAttribute("title");
  });
});
