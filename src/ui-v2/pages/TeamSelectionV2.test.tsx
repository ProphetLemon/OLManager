import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ROSTER_RECHECK_AFTER_MS,
  resetRosterUpdatesForTests,
  useRosterUpdateStore,
  type RosterUpdateStatus,
} from "@/store/rosterUpdateStore";
import { previewInvoke } from "@/ui-v2/pages/customTeam/founders/foundersTestKit";
import type { PreviewCall } from "@/ui-v2/pages/customTeam/founders/foundersTestKit";

const mocks = vi.hoisted(() => ({
  loadLeagueSelectionData: vi.fn(),
  selectTeam: vi.fn(),
  joinLeague: vi.fn(),
  navigate: vi.fn(),
  setGameState: vi.fn(),
  setGameActive: vi.fn(),
  getWorldOverlayInfo: vi.fn(),
  updateWorldOverlay: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("@/services/worldOverlayService", () => ({
  getWorldOverlayInfo: mocks.getWorldOverlayInfo,
  updateWorldOverlay: mocks.updateWorldOverlay,
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

vi.mock("react-i18next", async () => {
  const { translateFromEnglish } = await import("@/test-i18n");
  return {
    initReactI18next: { type: "3rdParty", init: vi.fn() },
    useTranslation: () => ({ i18n: { language: "en" }, t: translateFromEnglish }),
  };
});

vi.mock("@/store/gameStore", () => ({
  useGameStore: () => ({
    setGameState: mocks.setGameState,
    setGameActive: mocks.setGameActive,
  }),
}));

vi.mock("@/ui-v2/_legacy/components/teamSelection/teamSelection.helpers", () => ({
  loadLeagueSelectionData: mocks.loadLeagueSelectionData,
  selectTeam: mocks.selectTeam,
  joinLeagueWithCustomTeam: mocks.joinLeague,
  getTeamLogoPath: () => "",
  getReputationLabel: () => ({ labelKey: "teamSelect.repAverage", variant: "secondary" }),
  formatFinance: (value: number) => `€${value}`,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

vi.mock("@/ui-v2/_legacy/components/dashboard/FloatingBugButton", () => ({
  default: () => <button type="button">Report a bug</button>,
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

/** Identity, badge and mode steps, then the founding squad step once its preview is in. */
async function walkWizard(mode: "join" | "replace" = "replace") {
  fireEvent.change(screen.getByLabelText("Club name"), { target: { value: "Ray Esports" } });
  fireEvent.change(screen.getByLabelText("Country"), { target: { value: "ES" } });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  if (mode === "replace") fireEvent.click(screen.getByRole("radio", { name: "Replace a club" }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByTestId("founder-mid");
}

let previewCalls: PreviewCall[] = [];

function rosterInfo(asOf: string) {
  return {
    as_of: asOf,
    origin: "bundled" as const,
    source: {
      name: "Leaguepedia",
      url: "https://lol.fandom.com",
      license: "CC BY-SA 3.0",
      license_url: "https://www.fandom.com/licensing",
      attribution: "Roster data from Leaguepedia, available under CC BY-SA 3.0.",
    },
    player_ops: 0,
    staff_ops: 0,
    updated: false,
  };
}

/** The roster check as the screen finds it: `status`, finished `ageMs` ago. */
function setRosterCheck(status: RosterUpdateStatus, ageMs = 0) {
  useRosterUpdateStore.setState({ status, lastCheckedAt: Date.now() - ageMs });
}

describe("TeamSelectionV2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    previewCalls = [];
    const preview = previewInvoke(previewCalls);
    mocks.invoke.mockImplementation(async (command: string, args?: unknown) =>
      command === "preview_founding_squad" ? preview(command, args) : customGame(),
    );
    resetRosterUpdatesForTests();
    // A started check never settles, so it stays visible; most tests open the
    // screen right after a successful one.
    mocks.getWorldOverlayInfo.mockReturnValue(new Promise(() => {}));
    mocks.updateWorldOverlay.mockReturnValue(new Promise(() => {}));
    setRosterCheck("upToDate");
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

  it("hosts the bug report button in the roster footer on every step", async () => {
    const TeamSelectionV2 = (await import("./TeamSelectionV2")).default;
    render(
      <MemoryRouter>
        <TeamSelectionV2 />
      </MemoryRouter>,
    );

    const inFooter = () =>
      within(screen.getByTestId("roster-overlay-actions")).getByRole("button", { name: "Report a bug" });

    // League list.
    await screen.findByRole("button", { name: /LES/i });
    expect(inFooter()).toBeInTheDocument();

    // Team list.
    fireEvent.click(screen.getByRole("button", { name: /LES/i }));
    await screen.findByRole("button", { name: /Create your team/i });
    expect(inFooter()).toBeInTheDocument();

    // Custom team.
    fireEvent.click(screen.getByRole("button", { name: /Create your team/i }));
    await screen.findByLabelText("Club name");
    expect(inFooter()).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Report a bug" })).toHaveLength(1);
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
    fireEvent.click(screen.getByRole("button", { name: /^Confirm$/ }));

    await waitFor(() => {
      expect(screen.getByText("Could not select team")).toBeInTheDocument();
    });
    expect(
      screen.getByText("No active competition manifests available; cannot select a team safely"),
    ).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalledWith("/dashboard");
  });

  describe("Confirm while a roster check runs", () => {
    async function openTeamWithConfirm() {
      const TeamSelectionV2 = (await import("./TeamSelectionV2")).default;
      render(
        <MemoryRouter>
          <TeamSelectionV2 />
        </MemoryRouter>,
      );
      fireEvent.click(await screen.findByRole("button", { name: /LEC/i }));
      fireEvent.click(await screen.findByRole("button", { name: /G2 Esports/i }));
      return screen.getByRole("button", { name: /^Confirm$/ });
    }

    it("stays in the tab order, marked unavailable", async () => {
      setRosterCheck("checking");

      const confirm = await openTeamWithConfirm();

      expect(confirm).not.toBeDisabled();
      expect(confirm).toHaveAttribute("aria-disabled", "true");
    });

    it("does nothing when pressed", async () => {
      setRosterCheck("checking");
      const confirm = await openTeamWithConfirm();

      fireEvent.click(confirm);

      expect(mocks.selectTeam).not.toHaveBeenCalled();
      expect(mocks.updateWorldOverlay).not.toHaveBeenCalled();
    });

    it("says why it waits, in a visible hint that describes it", async () => {
      setRosterCheck("checking");

      const confirm = await openTeamWithConfirm();

      expect(screen.getByText("Waiting for the roster check…")).toBeVisible();
      expect(confirm).toHaveAccessibleDescription("Waiting for the roster check…");
    });

    it("becomes available, without the hint, when the check ends", async () => {
      setRosterCheck("checking");
      const confirm = await openTeamWithConfirm();

      act(() => setRosterCheck("upToDate"));

      expect(confirm).not.toHaveAttribute("aria-disabled");
      expect(confirm).not.toHaveAccessibleDescription();
      expect(screen.queryByText("Waiting for the roster check…")).not.toBeInTheDocument();
      fireEvent.click(confirm);
      await waitFor(() => expect(mocks.selectTeam).toHaveBeenCalled());
    });
  });

  it("does not re-check the rosters when the last check succeeded under an hour ago", async () => {
    setRosterCheck("upToDate", ROSTER_RECHECK_AFTER_MS - 60_000);
    const TeamSelectionV2 = (await import("./TeamSelectionV2")).default;

    render(
      <MemoryRouter>
        <TeamSelectionV2 />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: /LEC/i });

    expect(mocks.updateWorldOverlay).not.toHaveBeenCalled();
  });

  it.each([
    ["failed", 0],
    ["upToDate", ROSTER_RECHECK_AFTER_MS + 60_000],
  ] as const)("re-checks the rosters automatically when the last check %s (%i ms ago)", async (status, age) => {
    setRosterCheck(status, age);
    const TeamSelectionV2 = (await import("./TeamSelectionV2")).default;

    render(
      <MemoryRouter>
        <TeamSelectionV2 />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: /LEC/i });

    expect(mocks.updateWorldOverlay).toHaveBeenCalledTimes(1);
    expect(mocks.updateWorldOverlay).toHaveBeenCalledWith({ automatic: true });
  });

  it("shows the roster date from the store, with no Update rosters button", async () => {
    useRosterUpdateStore.setState({ info: rosterInfo("2026-06-22") });
    const TeamSelectionV2 = (await import("./TeamSelectionV2")).default;

    render(
      <MemoryRouter>
        <TeamSelectionV2 />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Rosters as of June 22, 2026")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /update rosters/i })).not.toBeInTheDocument();
  });

  it("retries on the manual path after the automatic re-check fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    useRosterUpdateStore.setState({ info: rosterInfo("2026-06-22") });
    setRosterCheck("failed");
    mocks.updateWorldOverlay.mockRejectedValueOnce("offline");
    const TeamSelectionV2 = (await import("./TeamSelectionV2")).default;

    render(
      <MemoryRouter>
        <TeamSelectionV2 />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));

    expect(mocks.updateWorldOverlay).toHaveBeenNthCalledWith(1, { automatic: true });
    expect(mocks.updateWorldOverlay).toHaveBeenLastCalledWith();
    // Retry stays in place, unavailable, while its check runs.
    expect(screen.getByRole("button", { name: "Retry" })).toHaveAttribute("aria-disabled", "true");
  });

  it.each(["upToDate", "updated"] as const)("keeps Confirm enabled when the check ended as %s", async (status) => {
    setRosterCheck(status);
    const TeamSelectionV2 = (await import("./TeamSelectionV2")).default;

    render(
      <MemoryRouter>
        <TeamSelectionV2 />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /LEC/i }));
    fireEvent.click(await screen.findByRole("button", { name: /G2 Esports/i }));

    expect(screen.getByRole("button", { name: /^Confirm$/ })).toBeEnabled();
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
      await openWizard();
      await walkWizard();
      fireEvent.click(screen.getByRole("button", { name: "Create club" }));

      await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/dashboard"));
      expect(mocks.selectTeam).toHaveBeenCalledWith("les-b", "en", {
        name: "Ray Esports",
        short_name: "RAY",
        primary_color: "#f97316",
        secondary_color: "#18181b",
        country: "ES",
        // The seed of the last preview travels with the spec, so the install equals what was shown.
        founding_seed: previewCalls[previewCalls.length - 1].seed,
      });
      // selectedTeamId was never set; the lineup must come from the generated club.
      expect(mocks.invoke).toHaveBeenCalledWith("set_active_lineup", {
        playerIds: ["ray-0", "ray-1", "ray-2", "ray-3", "ray-4"],
      });
    });

    it("joins the league without a teamId and builds the lineup from manager.team_id", async () => {
      mocks.joinLeague.mockResolvedValue(customGame());
      await openWizard();
      await walkWizard("join");
      fireEvent.click(screen.getByRole("button", { name: "Create club" }));

      await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/dashboard"));
      expect(mocks.joinLeague).toHaveBeenCalledTimes(1);
      expect(mocks.joinLeague).toHaveBeenCalledWith("les", "en", {
        name: "Ray Esports",
        short_name: "RAY",
        primary_color: "#f97316",
        secondary_color: "#18181b",
        country: "ES",
        founding_seed: previewCalls[previewCalls.length - 1].seed,
      });
      expect(mocks.selectTeam).not.toHaveBeenCalled();
      expect(Object.keys(previewCalls[previewCalls.length - 1])).not.toContain("replacedTeamId");
      expect(mocks.invoke).toHaveBeenCalledWith("set_active_lineup", {
        playerIds: ["ray-0", "ray-1", "ray-2", "ray-3", "ray-4"],
      });
    });

    it("localizes a backend refusal of the join on the mode step", async () => {
      mocks.joinLeague.mockRejectedValue("Competition 'les' does not accept custom clubs");
      await openWizard();
      await walkWizard("join");
      fireEvent.click(screen.getByRole("button", { name: "Create club" }));

      expect(
        await screen.findByText(
          "This league does not accept new clubs. Go back and choose another league or an existing team.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Join or replace" })).toBeInTheDocument();
      expect(screen.queryByText(/does not accept custom clubs/)).not.toBeInTheDocument();
      expect(mocks.navigate).not.toHaveBeenCalledWith("/dashboard");
    });

    it("never calls the join command for a replaced slot", async () => {
      mocks.selectTeam.mockResolvedValue(customGame());
      await openWizard();
      await walkWizard("replace");
      fireEvent.click(screen.getByRole("button", { name: "Create club" }));

      await waitFor(() => expect(mocks.selectTeam).toHaveBeenCalled());
      expect(mocks.joinLeague).not.toHaveBeenCalled();
    });

    it("keeps the wizard open and localizes a backend rejection", async () => {
      mocks.selectTeam.mockRejectedValue("Another team already uses this name");
      await openWizard();
      await walkWizard();
      fireEvent.click(screen.getByRole("button", { name: "Create club" }));

      expect(await screen.findByText("Another club already uses this name.")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Identity" })).toBeInTheDocument();
      expect(mocks.navigate).not.toHaveBeenCalledWith("/dashboard");
    });

    it("shows a founder rejection of the install on the squad step, not as raw JSON", async () => {
      const raw = JSON.stringify({ kind: "invalid_field", role: "MID", field: "nick", reason: "taken" });
      mocks.selectTeam.mockRejectedValue(raw);
      await openWizard();
      await walkWizard();
      fireEvent.click(screen.getByRole("button", { name: "Create club" }));

      expect(
        await screen.findByText("Squad rejected. Mid, Nick: Another player already uses this name."),
      ).toBeInTheDocument();
      expect(screen.queryByText(raw)).not.toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Founding squad" })).toBeInTheDocument();
    });

    it("returns to the team grid on Escape from the wizard", async () => {
      await openWizard();
      fireEvent.keyDown(screen.getByLabelText("Club name"), { key: "Escape" });

      expect(await screen.findByRole("button", { name: /Create your team/i })).toBeInTheDocument();
      expect(screen.queryByLabelText("Club name")).not.toBeInTheDocument();
    });

    it("disables Create club while a roster check runs", async () => {
      setRosterCheck("checking");
      await openWizard();
      await walkWizard();
      expect(screen.getByRole("button", { name: "Create club" })).toBeDisabled();
    });
  });
});
