import { fireEvent, render, screen } from "@testing-library/react";
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

const owner = createStaff({
  id: "owner-1",
  first_name: "Ibai",
  last_name: "Llanos",
  role: "Owner",
  wage: 0,
  date_of_birth: "1990-01-01",
});

describe("StaffTabV2 cards", () => {
  beforeEach(() => {
    hireStaff.mockReset();
    releaseStaff.mockReset();
  });

  it("shows the age of a staff member with a real birth date", () => {
    render(<StaffTabV2 gameState={createGameState([createStaff()])} onGameUpdate={vi.fn()} />);

    expect(screen.getByText("common.age 41")).toBeInTheDocument();
  });

  it("shows no age for the placeholder birth date or a missing one", () => {
    render(
      <StaffTabV2
        gameState={createGameState([
          createStaff({ id: "placeholder", first_name: "Plain", date_of_birth: "1990-01-01" }),
          createStaff({ id: "missing", first_name: "Blank", date_of_birth: "" }),
        ])}
        onGameUpdate={vi.fn()}
      />,
    );

    expect(screen.queryByText(/common\.age/)).not.toBeInTheDocument();
  });

  it("keeps the club owner visible, labelled, without a fire button or impact chips", () => {
    render(<StaffTabV2 gameState={createGameState([owner, createStaff()])} onGameUpdate={vi.fn()} />);

    expect(screen.getByText("staff.clubOwner")).toBeInTheDocument();
    // One release button, for the coach only.
    expect(screen.getAllByTitle("staff.releaseStaff")).toHaveLength(1);
    // Only the coach card carries impact chips (development, tactics, execution).
    expect(screen.getAllByText("staff.lolImpact.development")).toHaveLength(2); // coach card + team banner
  });

  it("never offers an unattached owner in the market", () => {
    render(
      <StaffTabV2
        gameState={createGameState([
          createStaff({ id: "owner-free", first_name: "Xpeke", role: "Owner", team_id: null }),
          createStaff({ id: "coach-free", first_name: "Free", last_name: "Agent", team_id: null }),
        ])}
        onGameUpdate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /staff\.available 1/ }));

    expect(screen.getByText("Free Agent")).toBeInTheDocument();
    expect(screen.queryByText("Xpeke")).not.toBeInTheDocument();
    expect(screen.getAllByTitle("staff.hireStaff")).toHaveLength(1);
  });
});
