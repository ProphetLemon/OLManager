import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PlayerData } from "@/store/gameStore";
import HomeRosterLineupCard from "@/ui-v2/_legacy/components/home/HomeRosterLineupCard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/players/playerPhotos", () => ({
  resolvePlayerPhoto: (id: string) => `/resolved/${id}.webp`,
}));

describe("HomeRosterLineupCard photos", () => {
  it("resolves the player photo through the shared resolver", () => {
    const player = {
      id: "player-123",
      match_name: "Linked",
      natural_position: "MID",
      position: "MID",
      profile_image_url: null,
      attributes: {},
    } as unknown as PlayerData;

    render(<HomeRosterLineupCard roster={[player]} />);

    const img = screen.getByAltText("Linked") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("/resolved/player-123.webp");
  });
});
