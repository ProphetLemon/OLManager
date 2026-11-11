import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GameStateData, StaffData } from "@/store/gameStore";
import { StaffTabV2 } from "@/ui-v2/dashboard/tabs/StaffTabV2";

const hireStaff = vi.fn();
const releaseStaff = vi.fn();

vi.mock("@/services/staffService", () => ({
  hireStaff: (...args: unknown[]) => hireStaff(...args),
  releaseStaff: (...args: unknown[]) => releaseStaff(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params?.count != null ? `${key} ${params.count}` : key),
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

describe("StaffTabV2 hire and release errors", () => {
  beforeEach(() => {
    hireStaff.mockReset();
    releaseStaff.mockReset();
  });

  it("shows a translated message, never the raw error, when a hire fails", async () => {
    hireStaff.mockRejectedValue(new Error("Failed to record staff hiring transaction: ZeroAmount"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <StaffTabV2
        gameState={createGameState([createStaff({ id: "coach-free", team_id: null })])}
        onGameUpdate={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /staff\.available 1/ }));
    fireEvent.click(screen.getByTitle("staff.hireStaff"));

    const alert = await waitFor(() => screen.getByRole("alert"));
    expect(alert).toHaveTextContent("staff.errors.generic");
    expect(alert).not.toHaveTextContent("ZeroAmount");
  });

  it("translates a coded refusal from the backend", async () => {
    releaseStaff.mockRejectedValue(JSON.stringify({ kind: "staff", reason: "owner_not_fireable" }));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(<StaffTabV2 gameState={createGameState([createStaff()])} onGameUpdate={vi.fn()} />);
    fireEvent.click(screen.getByTitle("staff.releaseStaff"));
    fireEvent.click(await screen.findByRole("button", { name: "staff.releaseConfirmAction" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("staff.errors.owner_not_fireable"));
  });
});
