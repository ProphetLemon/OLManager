import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PlayerData, ScoutingAssignment, StaffData, TeamData } from "@/store/gameStore";
import ScoutingAssignmentsListV2 from "@/ui-v2/dashboard/tabs/ScoutingAssignmentsListV2";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/players/playerPhotos", () => ({
  resolvePlayerPhoto: (id: string) => `/resolved/${id}.webp`,
}));

describe("ScoutingAssignmentsListV2", () => {
  it("shows the player avatar resolved through the shared resolver", () => {
    const player = {
      id: "player-9",
      match_name: "Scouted",
      team_id: null,
      position: "MID",
      natural_position: "MID",
      profile_image_url: "/custom/scouted.webp",
    } as unknown as PlayerData;
    const scout = { id: "scout-1", first_name: "A", last_name: "B" } as unknown as StaffData;
    const assignment = {
      id: "as-1",
      scout_id: "scout-1",
      player_id: "player-9",
      days_remaining: 3,
    } as unknown as ScoutingAssignment;

    render(
      <ScoutingAssignmentsListV2
        assignments={[assignment]}
        scouts={[scout]}
        players={[player]}
        teams={[] as TeamData[]}
      />,
    );

    const img = screen.getByAltText("Scouted") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("/resolved/player-9.webp");
  });
});
