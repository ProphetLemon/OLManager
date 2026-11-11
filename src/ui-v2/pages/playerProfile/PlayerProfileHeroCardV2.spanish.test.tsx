import { render, screen } from "@testing-library/react";
import i18next from "i18next";
import { describe, expect, it, vi } from "vitest";
import type { PlayerData } from "@/store/gameStore";

import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";

vi.mock("@/lib/playerProfile/helpers", () => ({
  formatPlayerMarketValue: () => "€1M",
  formatPlayerWage: () => "€50K/yr",
}));

vi.mock("@/lib/players/playerPhotos", () => ({
  resolvePlayerPhoto: () => null,
}));

vi.mock("@/lib/teams/teamLogos", () => ({
  resolveTeamLogo: () => null,
}));

vi.mock("@/lib/players/roleIcons", () => ({
  ROLE_ICON_PATHS: {},
}));

vi.mock("@/ui-v2/pages/playerProfile/PlayerProfileScoutActionV2", () => ({
  default: () => null,
}));

vi.mock("@/ui-v2/components/ui/country-flag", () => ({
  CountryFlag: () => null,
}));

vi.mock("@/lib/playerProfile/scouting", () => ({
  PlayerProfileScoutStatus: {},
  ScoutAvailability: {},
}));

const MOCK_PLAYER: PlayerData = {
  id: "player-1",
  match_name: "TestPlayer",
  nationality: "KR",
  condition: 80,
  morale: 75,
  fitness: 85,
  market_value: 1_000_000,
  wage: 50_000,
  team_id: "team-1",
  position: "MID",
  alternate_positions: [],
  potential_revealed: 80,
  potential_research_eta_days: null,
  transfer_listed: true,
  loan_listed: true,
  status: "Active",
  injury_days_remaining: 0,
  contract_expires: "2026-12-31",
  traits: [],
  role_flexibility: {},
  growth: 0,
  ovr: 75,
} as unknown as PlayerData;


async function renderHero(overrides: Record<string, unknown>) {
  const instance = i18next.createInstance();
  await instance.init({
    lng: "es",
    fallbackLng: "en",
    resources: { en: { translation: en }, es: { translation: es } },
    interpolation: { escapeValue: false },
  });
  const PlayerProfileHeroCardV2 = (await import("./PlayerProfileHeroCardV2")).default;
  return render(
    <PlayerProfileHeroCardV2
      player={{ ...MOCK_PLAYER, ...overrides } as PlayerData}
      ovr={75}
      age={22}
      teamName="Test Team"
      annualSuffix="/año"
      language="es"
      isOwnClub
      scoutAvailability={"none" as any}
      scoutStatus={"none" as any}
      scoutError={null}
      onScout={vi.fn()}
      onStartPotentialResearch={vi.fn()}
      t={instance.t.bind(instance) as never}
    />,
  );
}

describe("PlayerProfileHeroCardV2 in the Spanish UI", () => {
  it("offers to start the potential research in Spanish", async () => {
    await renderHero({ potential_revealed: null, potential_research_eta_days: null });
    expect(screen.getByText("Iniciar investigación de potencial")).toBeInTheDocument();
    expect(screen.queryByText(/Start Potential Research/i)).toBeNull();
  });

  it("shows the research progress in Spanish", async () => {
    await renderHero({ potential_revealed: null, potential_research_eta_days: 3 });
    expect(screen.getByText("Progreso de la investigación (7 fases)")).toBeInTheDocument();
    expect(screen.queryByText(/Research progress/)).toBeNull();
  });

  it("writes the listing badges and the alternate positions in Spanish", async () => {
    await renderHero({ alternate_positions: ["TOP"] });
    expect(screen.getByText("Transferible")).toBeInTheDocument();
    expect(screen.getByText("Cedible")).toBeInTheDocument();
    expect(screen.getByText(/^También juega:/)).toBeInTheDocument();
    expect(screen.queryByText(/Transfer Listed|Loan Listed|Also plays/)).toBeNull();
  });
});
