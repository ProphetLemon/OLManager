import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PlayerData } from "@/store/gameStore";

// ─── Mocks ───────────────────────────────────────────────────────────────

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

vi.mock("@/ui-v2/_legacy/components/ui/CountryFlag", () => ({
  CountryFlag: () => null,
}));

vi.mock("@/lib/playerProfile/scouting", () => ({
  PlayerProfileScoutStatus: {},
  ScoutAvailability: {},
}));

const ES_TRANSLATIONS: Record<string, string> = {
  "playerProfile.transferListed": "Transferible",
  "playerProfile.loanListed": "Cedible",
  "playerProfile.alsoPlays": "También juega:",
  "common.age": "Edad",
  "common.ovr": "OVR",
  "common.condition": "Energía",
  "common.fitness": "Estado Físico",
  "common.morale": "Moral",
  "common.potential": "Potencial",
  "common.value": "Valor",
  "common.wage": "Salario",
};

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    i18n: { language: "es" },
    t: (key: string) => ES_TRANSLATIONS[key] ?? key,
  }),
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

// ─── Tests ───────────────────────────────────────────────────────────────

describe("PlayerProfileHeroCardV2", () => {
  it("renders transfer listed and loan listed badges", async () => {
    const PlayerProfileHeroCardV2 = (await import("./PlayerProfileHeroCardV2")).default;
    render(
      <PlayerProfileHeroCardV2
        player={MOCK_PLAYER}
        ovr={75}
        age={22}
        teamName="Test Team"
        annualSuffix="/yr"
        language="es"
        isOwnClub
        scoutAvailability={"none" as any}
        scoutStatus={"none" as any}
        scoutError={null}
        onScout={vi.fn()}
        t={(key: string) => ES_TRANSLATIONS[key] ?? key}
      />,
    );
    expect(screen.getByText("Transferible")).toBeInTheDocument();
    expect(screen.getByText("Cedible")).toBeInTheDocument();
  });

  it("does not render badges when player is not listed", async () => {
    const PlayerProfileHeroCardV2 = (await import("./PlayerProfileHeroCardV2")).default;
    const noTransferPlayer = { ...MOCK_PLAYER, transfer_listed: false, loan_listed: false };
    render(
      <PlayerProfileHeroCardV2
        player={noTransferPlayer}
        ovr={75}
        age={22}
        teamName="Test Team"
        annualSuffix="/yr"
        language="es"
        isOwnClub
        scoutAvailability={"none" as any}
        scoutStatus={"none" as any}
        scoutError={null}
        onScout={vi.fn()}
        t={(key: string) => ES_TRANSLATIONS[key] ?? key}
      />,
    );
    expect(screen.queryByText("Transferible")).not.toBeInTheDocument();
    expect(screen.queryByText("Cedible")).not.toBeInTheDocument();
  });

  it("shows the localized nationality name next to the flag", async () => {
    const PlayerProfileHeroCardV2 = (await import("./PlayerProfileHeroCardV2")).default;
    render(
      <PlayerProfileHeroCardV2
        player={MOCK_PLAYER}
        ovr={75}
        age={22}
        teamName="Test Team"
        annualSuffix="/yr"
        language="es"
        isOwnClub
        scoutAvailability={"none" as any}
        scoutStatus={"none" as any}
        scoutError={null}
        onScout={vi.fn()}
        t={(key: string) => ES_TRANSLATIONS[key] ?? key}
      />,
    );
    expect(screen.getByText("República de Corea")).toBeInTheDocument();
  });
});
