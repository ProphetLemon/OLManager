import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SoloQDecaySettings } from "@/api/types";
import { useGameStore } from "@/store/gameStore";
import SoloqDecaySettingV2 from "./SoloqDecaySettingV2";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("react-i18next", async () => {
  const { translateFromEnglish } = await import("@/test-i18n");
  return { useTranslation: () => ({ i18n: { language: "en" }, t: translateFromEnglish }) };
});

const PRESETS: SoloQDecaySettings["presets"] = [
  { mode: "Off", decay_per_idle_day: 0, bank_days: 0, recovery_per_played_day: 0 },
  { mode: "Soft", decay_per_idle_day: 25, bank_days: 21, recovery_per_played_day: 50 },
  { mode: "Real", decay_per_idle_day: 50, bank_days: 14, recovery_per_played_day: 100 },
  { mode: "Harsh", decay_per_idle_day: 75, bank_days: 7, recovery_per_played_day: 150 },
];

function engine(mode: SoloQDecaySettings["mode"]): SoloQDecaySettings {
  return { mode, presets: PRESETS };
}

function mockEngine(initial: SoloQDecaySettings["mode"]) {
  vi.mocked(invoke).mockImplementation(async (command: string, args?: unknown) => {
    if (command === "get_soloq_decay_settings") return engine(initial);
    if (command === "set_soloq_decay_mode") return engine((args as { mode: SoloQDecaySettings["mode"] }).mode);
    return null;
  });
}

describe("SoloqDecaySettingV2", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    useGameStore.setState({ hasActiveGame: false });
  });

  it("is disabled with no save loaded and says new careers start on Real", () => {
    render(<SoloqDecaySettingV2 />);

    expect(screen.getByRole("switch", { name: "SoloQ inactivity decay" })).toBeDisabled();
    for (const radio of screen.getAllByRole("radio")) expect(radio).toBeDisabled();
    expect(screen.getByText(/New careers start on Real/)).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("shows each preset with the three numbers, even with no save", () => {
    render(<SoloqDecaySettingV2 />);

    const harsh = screen.getByRole("radio", { name: /Harsh/ });
    const card = harsh.closest("label") as HTMLElement;
    expect(card).toHaveTextContent("Loss per idle day");
    expect(card).toHaveTextContent("−75 LP");
    expect(card).toHaveTextContent("Grace period");
    expect(card).toHaveTextContent("7 days");
    expect(card).toHaveTextContent("Win back per SoloQ day");
    expect(card).toHaveTextContent("+150 LP");
  });

  it("is enabled with a save and reads the mode from it", async () => {
    useGameStore.setState({ hasActiveGame: true });
    mockEngine("Soft");
    render(<SoloqDecaySettingV2 />);

    await waitFor(() => expect(screen.getByRole("radio", { name: /Soft/ })).toBeChecked());
    expect(screen.getByRole("switch", { name: "SoloQ inactivity decay" })).toBeEnabled();
    expect(screen.getByRole("switch", { name: "SoloQ inactivity decay" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByText(/New careers start on Real/)).not.toBeInTheDocument();
  });

  it("changes the loaded save through set_soloq_decay_mode", async () => {
    useGameStore.setState({ hasActiveGame: true });
    mockEngine("Real");
    render(<SoloqDecaySettingV2 />);
    await waitFor(() => expect(screen.getByRole("radio", { name: /Real/ })).toBeChecked());

    fireEvent.click(screen.getByRole("radio", { name: /Harsh/ }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("set_soloq_decay_mode", { mode: "Harsh" }));
    await waitFor(() => expect(screen.getByRole("radio", { name: /Harsh/ })).toBeChecked());
  });

  it("turns decay off, locks the intensities and restores the last one when switched on", async () => {
    useGameStore.setState({ hasActiveGame: true });
    mockEngine("Harsh");
    render(<SoloqDecaySettingV2 />);
    const toggle = screen.getByRole("switch", { name: "SoloQ inactivity decay" });
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));

    fireEvent.click(toggle);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("set_soloq_decay_mode", { mode: "Off" }));
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
    for (const radio of screen.getAllByRole("radio")) expect(radio).toBeDisabled();
    expect(screen.getByText("Decay is off")).toBeInTheDocument();

    fireEvent.click(toggle);
    await waitFor(() => expect(invoke).toHaveBeenLastCalledWith("set_soloq_decay_mode", { mode: "Harsh" }));
  });

  it("announces a save that failed", async () => {
    useGameStore.setState({ hasActiveGame: true });
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "get_soloq_decay_settings") return engine("Real");
      throw new Error("db locked");
    });
    render(<SoloqDecaySettingV2 />);
    await waitFor(() => expect(screen.getByRole("radio", { name: /Real/ })).toBeChecked());

    fireEvent.click(screen.getByRole("radio", { name: /Soft/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("could not be saved");
    expect(screen.getByRole("radio", { name: /Real/ })).toBeChecked();
  });

  it("explains the rest-day rule", () => {
    render(<SoloqDecaySettingV2 />);
    expect(screen.getByText(/Match days and ordinary rest days change nothing/)).toBeInTheDocument();
  });
});
