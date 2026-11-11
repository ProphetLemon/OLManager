import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GameStateData, StaffData } from "@/store/gameStore";
import { StaffTabV2 } from "@/ui-v2/dashboard/tabs/StaffTabV2";

const releaseStaff = vi.fn();

vi.mock("@/services/staffService", () => ({
  hireStaff: vi.fn(),
  releaseStaff: (...args: unknown[]) => releaseStaff(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params && "name" in params
        ? `${key}|${String(params.name)}${params.role ? `|${String(params.role)}` : ""}`
        : key,
    i18n: { language: "en" },
  }),
}));

function createStaff(overrides: Partial<StaffData> = {}): StaffData {
  return {
    id: "staff-1",
    first_name: "Alex",
    last_name: "Coach",
    date_of_birth: "1985-03-01",
    nationality: "ES",
    role: "Coach",
    attributes: { coaching: 70, judging_ability: 50, judging_potential: 55, physiotherapy: 30 },
    team_id: "team-1",
    specialization: null,
    wage: 30000,
    contract_end: null,
    ...overrides,
  };
}

function createGameState(staff: StaffData[]): GameStateData {
  return {
    clock: { current_date: "2026-08-10T00:00:00Z", start_date: "2026-07-01T00:00:00Z" },
    manager: { id: "manager-1", team_id: "team-1" },
    teams: [{ id: "team-1", name: "Alpha FC", competition_id: null }],
    players: [],
    staff,
    leagues: [],
  } as unknown as GameStateData;
}

function renderTab(onGameUpdate = vi.fn()) {
  render(<StaffTabV2 gameState={createGameState([createStaff()])} onGameUpdate={onGameUpdate} />);
  return screen.getByRole("button", { name: /^staff\.releaseStaffNamed\|/ });
}

describe("StaffTabV2 release confirmation", () => {
  beforeEach(() => {
    releaseStaff.mockReset();
    releaseStaff.mockResolvedValue({ staff: [] });
  });

  it("names the person in the accessible name of the fire button", () => {
    const fire = renderTab();
    expect(fire.getAttribute("aria-label")).toMatch(/Alex/);
  });

  it("opens a dialog naming the person and role, without calling the API", async () => {
    fireEvent.click(renderTab());
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/staff\.releaseConfirmTitle\|.*Alex/);
    expect(dialog).toHaveTextContent(/staff\.releaseConfirmMessage\|.*Alex.*\|staff\.roles\.Coach/);
    expect(releaseStaff).not.toHaveBeenCalled();
  });

  it("focuses the cancel button by default", async () => {
    fireEvent.click(renderTab());
    const cancel = await screen.findByRole("button", { name: "common.cancel" });
    await waitFor(() => expect(cancel).toHaveFocus());
  });

  it("cancel closes the dialog without a call and restores focus to the fire button", async () => {
    const fire = renderTab();
    fire.focus();
    fireEvent.click(fire);
    fireEvent.click(await screen.findByRole("button", { name: "common.cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(releaseStaff).not.toHaveBeenCalled();
    await waitFor(() => expect(fire).toHaveFocus());
  });

  it("Escape closes the dialog without a call and restores focus to the fire button", async () => {
    const fire = renderTab();
    fire.focus();
    fireEvent.click(fire);
    const cancel = await screen.findByRole("button", { name: "common.cancel" });
    fireEvent.keyDown(cancel, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(releaseStaff).not.toHaveBeenCalled();
    await waitFor(() => expect(fire).toHaveFocus());
  });

  it("confirming releases the person once", async () => {
    const onGameUpdate = vi.fn();
    fireEvent.click(renderTab(onGameUpdate));
    fireEvent.click(await screen.findByRole("button", { name: "staff.releaseConfirmAction" }));
    await waitFor(() => expect(onGameUpdate).toHaveBeenCalledTimes(1));
    expect(releaseStaff).toHaveBeenCalledTimes(1);
    expect(releaseStaff).toHaveBeenCalledWith("staff-1");
  });
});
