import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { GameStateData, StaffData } from "@/store/gameStore";
import StaffProfileV2 from "./StaffProfileV2";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));

vi.mock("react-i18next", async () => {
  const { translateFromEnglish } = await import("@/test-i18n");
  return { useTranslation: () => ({ t: translateFromEnglish, i18n: { language: "en" } }) };
});

const staff: StaffData = {
  id: "staff-1",
  first_name: "Ana",
  last_name: "Ruiz",
  date_of_birth: "1985-03-01",
  nationality: "ES",
  role: "Coach",
  attributes: { coaching: 70, judging_ability: 50, judging_potential: 55, physiotherapy: 30 },
  team_id: "team-1",
  specialization: null,
  wage: 30000,
  contract_end: null,
} as StaffData;

const game = {
  manager: { team_id: "team-1" },
  clock: { current_date: "2025-06-19" },
  teams: [{ id: "team-1", name: "Night Owls" }],
  staff: [staff],
} as unknown as GameStateData;

describe("StaffProfileV2 Back (R41)", () => {
  it("is named after where Back lands, keeps its visible word and hides its icon", () => {
    const onClose = vi.fn();
    render(<StaffProfileV2 gameState={game} staffId="staff-1" backTo="Staff" onClose={onClose} />);

    const back = screen.getByRole("button", { name: "Back to Staff" });
    expect(back).toHaveTextContent(/^Back$/);
    expect(back.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    fireEvent.click(back);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("is named by its visible word when the page is shown on its own", () => {
    render(<StaffProfileV2 gameState={game} staffId="staff-1" onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });
});
