import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadLeagueSelectionData: vi.fn(),
  selectTeam: vi.fn(),
  navigate: vi.fn(),
  setGameState: vi.fn(),
  setGameActive: vi.fn(),
  rosterStatus: "idle" as string,
  useRosterOverlay: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("@/hooks/useRosterOverlay", () => ({
  useRosterOverlay: (options?: unknown) => {
    mocks.useRosterOverlay(options);
    return {
      info: null,
      status: mocks.rosterStatus,
      error: null,
      update: vi.fn(),
    };
  },
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (_key: string, options?: string | Record<string, unknown>) => {
      if (typeof options === "string") return options;
      const template = String(options?.defaultValue ?? _key);
      return template.replace(/{{(\w+)}}/g, (_m, name) => String(options?.[name] ?? ""));
    },
  }),
}));

vi.mock("@/store/gameStore", () => ({
  useGameStore: () => ({
    setGameState: mocks.setGameState,
    setGameActive: mocks.setGameActive,
  }),
}));

vi.mock("@/ui-v2/_legacy/components/teamSelection/teamSelection.helpers", () => ({
  loadLeagueSelectionData: mocks.loadLeagueSelectionData,
  selectTeam: mocks.selectTeam,
  getTeamLogoPath: () => "",
  getReputationLabel: () => ({ label: "Media", variant: "secondary" }),
  formatFinance: (value: number) => `€${value}`,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

vi.mock("@/lib/players/lolIdentity", () => ({
  resolvePlayerLolRole: (player: { role: string }) => player.role,
}));

vi.mock("@/lib/players/lolPlayerStats", () => ({
  calculateLolOvr: (player: { ovr: number }) => player.ovr,
}));

function lesTeam(id: string, name: string, short: string, reputation: number) {
  return {
    id,
    name,
    short_name: short,
    logo_url: null,
    country: "ES",
    finance: 1000,
    reputation,
    colors: null,
    ovr: null,
    player_count: 5,
  };
}

const ROLES = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"];

/** A started game whose managed club (`les-custom-ray`) differs from the slot it replaced. */
function customGame() {
  return {
    manager: { team_id: "les-custom-ray", first_name: "A", last_name: "B", nickname: "" },
    teams: [{ id: "les-custom-ray" }, { id: "les-b" }],
    players: [
      ...ROLES.map((role, i) => ({ id: `ray-${i}`, team_id: "les-custom-ray", role, ovr: 60 })),
      ...ROLES.map((role, i) => ({ id: `other-${i}`, team_id: "les-b", role, ovr: 70 })),
    ],
  };
}

async function openWizard() {
  const TeamSelectionV2 = (await import("./TeamSelectionV2")).default;
  render(
    <MemoryRouter>
      <TeamSelectionV2 />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("button", { name: /LES/i }));
  fireEvent.click(await screen.findByRole("button", { name: /Create your team/i }));
}

function walkWizard() {
  fireEvent.change(screen.getByLabelText("Club name"), { target: { value: "Ray Esports" } });
  fireEvent.change(screen.getByLabelText("Country"), { target: { value: "ES" } });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
}

describe("TeamSelectionV2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rosterStatus = "idle";
    mocks.loadLeagueSelectionData.mockResolvedValue({
      competitions: [
        {
          id: "lec",
          name: "LEC",
          region: "Europe",
          logo: null,
          tier: 1,
          legacy: false,
          active: true,
          team_count: 1,
          teams: [
            {
              id: "lec-g2",
              name: "G2 Esports",
              short_name: "G2",
              logo_url: null,
              country: "Germany",
              finance: 1000,
              reputation: 750,
              colors: null,
              ovr: null,
              player_count: 5,
            },
          ],
        },
        {
          id: "les",
          name: "LES",
          region: "Spain",
          logo: null,
          tier: 2,
          legacy: false,
          active: true,
          team_count: 2,
          custom_team_allowed: true,
          teams: [
            { ...lesTeam("les-a", "Falke Esports", "FAL", 300) },
            { ...lesTeam("les-b", "Other Club", "OTH", 180) },
          ],
        },
      ],
    });
  });

  it("shows the backend error when team confirmation fails", async () => {
    mocks.selectTeam.mockRejectedValue(
      "No active competition manifests available; cannot select a team safely",
    );

    const TeamSelectionV2 = (await import("./TeamSelectionV2")).default;

    render(
      <MemoryRouter>
        <TeamSelectionV2 />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /LEC/i }));
    fireEvent.click(await screen.findByRole("button", { name: /G2 Esports/i }));
    fireEvent.click(screen.getByRole("button", { name: /Confirmar/i }));

    await waitFor(() => {
      expect(screen.getByText("Could not select team")).toBeInTheDocument();
    });
    expect(
      screen.getByText("No active competition manifests available; cannot select a team safely"),
    ).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalledWith("/dashboard");
  });

  it("disables Confirm while the roster update is in flight", async () => {
    mocks.rosterStatus = "updating";
    const TeamSelectionV2 = (await import("./TeamSelectionV2")).default;

    render(
      <MemoryRouter>
        <TeamSelectionV2 />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /LEC/i }));
    fireEvent.click(await screen.findByRole("button", { name: /G2 Esports/i }));
    const confirm = screen.getByRole("button", { name: /Confirmar/i });

    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(mocks.selectTeam).not.toHaveBeenCalled();
  });

  it("asks the roster hook for the automatic check when the screen opens", async () => {
    const TeamSelectionV2 = (await import("./TeamSelectionV2")).default;

    render(
      <MemoryRouter>
        <TeamSelectionV2 />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: /LEC/i });

    expect(mocks.useRosterOverlay).toHaveBeenCalledWith({ autoCheck: true });
  });

  it("disables Confirm while the automatic roster check runs", async () => {
    mocks.rosterStatus = "checking";
    const TeamSelectionV2 = (await import("./TeamSelectionV2")).default;

    render(
      <MemoryRouter>
        <TeamSelectionV2 />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /LEC/i }));
    fireEvent.click(await screen.findByRole("button", { name: /G2 Esports/i }));
    const confirm = screen.getByRole("button", { name: /Confirmar/i });

    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(mocks.selectTeam).not.toHaveBeenCalled();
  });

  it.each(["checkFailed", "idle", "updated"])("keeps Confirm enabled when the check ended as %s", async (status) => {
    mocks.rosterStatus = status;
    const TeamSelectionV2 = (await import("./TeamSelectionV2")).default;

    render(
      <MemoryRouter>
        <TeamSelectionV2 />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /LEC/i }));
    fireEvent.click(await screen.findByRole("button", { name: /G2 Esports/i }));

    expect(screen.getByRole("button", { name: /Confirmar/i })).toBeEnabled();
  });

  describe("create your team", () => {
    it("shows the create card only in leagues that allow a custom club", async () => {
      const TeamSelectionV2 = (await import("./TeamSelectionV2")).default;
      render(
        <MemoryRouter>
          <TeamSelectionV2 />
        </MemoryRouter>,
      );

      fireEvent.click(await screen.findByRole("button", { name: /LEC/i }));
      await screen.findByRole("button", { name: /G2 Esports/i });
      expect(screen.queryByRole("button", { name: /Create your team/i })).not.toBeInTheDocument();
    });

    it("offers the create card in a league that allows it", async () => {
      const TeamSelectionV2 = (await import("./TeamSelectionV2")).default;
      render(
        <MemoryRouter>
          <TeamSelectionV2 />
        </MemoryRouter>,
      );

      fireEvent.click(await screen.findByRole("button", { name: /LES/i }));
      expect(await screen.findByRole("button", { name: /Create your team/i })).toBeInTheDocument();
    });

    it("confirms the replaced slot with the spec and builds the lineup from manager.team_id", async () => {
      mocks.selectTeam.mockResolvedValue(customGame());
      mocks.invoke.mockResolvedValue(customGame());
      await openWizard();
      walkWizard();
      fireEvent.click(screen.getByRole("button", { name: "Create club" }));

      await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/dashboard"));
      expect(mocks.selectTeam).toHaveBeenCalledWith("les-b", "en", {
        name: "Ray Esports",
        short_name: "RAY",
        primary_color: "#f97316",
        secondary_color: "#18181b",
        country: "ES",
      });
      // selectedTeamId was never set; the lineup must come from the generated club.
      expect(mocks.invoke).toHaveBeenCalledWith("set_active_lineup", {
        playerIds: ["ray-0", "ray-1", "ray-2", "ray-3", "ray-4"],
      });
    });

    it("keeps the wizard open and localizes a backend rejection", async () => {
      mocks.selectTeam.mockRejectedValue("Another team already uses this name");
      await openWizard();
      walkWizard();
      fireEvent.click(screen.getByRole("button", { name: "Create club" }));

      expect(await screen.findByText("Another club already uses this name.")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Identity" })).toBeInTheDocument();
      expect(mocks.navigate).not.toHaveBeenCalledWith("/dashboard");
    });

    it("returns to the team grid on Escape from the wizard", async () => {
      await openWizard();
      fireEvent.keyDown(screen.getByLabelText("Club name"), { key: "Escape" });

      expect(await screen.findByRole("button", { name: /Create your team/i })).toBeInTheDocument();
      expect(screen.queryByLabelText("Club name")).not.toBeInTheDocument();
    });

    it("disables Create club while the roster overlay is updating", async () => {
      mocks.rosterStatus = "updating";
      await openWizard();
      walkWizard();
      expect(screen.getByRole("button", { name: "Create club" })).toBeDisabled();
    });
  });
});
