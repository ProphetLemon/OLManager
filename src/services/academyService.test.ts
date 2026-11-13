import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import {
  acquireAcademyTeam,
  getAcademyAcquisitionOptions,
} from "./academyService";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

describe("academyService", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it("loads academy acquisition options from the backend authority", async () => {
    const response = {
      parent_team_id: "team-1",
      acquisition_allowed: true,
      blocked_reason: null,
      options: [
        {
          source_team_id: "mkoi-fenix",
          name: "Movistar KOI Fénix",
          short_name: "MKOI F",
          logo_url: "https://cdn.example/logo.webp",
          erl_league_id: "nlc",
          erl_league_name: "NLC",
          country_code: "GB",
          assignment_rule: "Domestic",
          fallback_reason: null,
          reputation: 4,
          development_level: 4,
          acquisition_cost: 260000,
        },
      ],
    };
    mockedInvoke.mockResolvedValueOnce(response);

    await expect(getAcademyAcquisitionOptions("team-1")).resolves.toMatchObject({
      parent_team_id: "team-1",
      acquisition_allowed: true,
      blocked_reason: null,
      options: [
        expect.objectContaining({
          source_team_id: "mkoi-fenix",
          source_team_name: "Movistar KOI Fénix",
          source_team_short_name: "MKOI F",
          source_team_logo_url: "https://cdn.example/logo.webp",
          league_name: "NLC",
        }),
      ],
    });
    expect(mockedInvoke).toHaveBeenCalledWith("get_academy_acquisition_options", {
      parentTeamId: "team-1",
    });
  });

  it("normalizes missing acquisition option arrays to an empty list", async () => {
    mockedInvoke.mockResolvedValueOnce({
      parent_team_id: "team-1",
      acquisition_allowed: true,
      blocked_reason: null,
    });

    await expect(getAcademyAcquisitionOptions("team-1")).resolves.toMatchObject({
      options: [],
      blocked_reason: null,
    });
  });

  it("keeps blocked reasons from the backend instead of computing rules locally", async () => {
    const response = {
      parent_team_id: "team-2",
      acquisition_allowed: false,
      blocked_reason: "Insufficient funds for all eligible academy options",
      options: [
        {
          source_team_id: "kcool",
          name: "Karmine Corp Blue",
          short_name: "KCB",
          logo_url: null,
          erl_league_id: "lfl",
          erl_league_name: "LFL",
          country_code: "FR",
          assignment_rule: "Fallback",
          fallback_reason: null,
          reputation: 5,
          development_level: 4,
          acquisition_cost: 300000,
        },
      ],
    };
    mockedInvoke.mockResolvedValueOnce(response);

    await expect(getAcademyAcquisitionOptions("team-2")).resolves.toMatchObject({
      acquisition_allowed: false,
      blocked_reason: "Insufficient funds for all eligible academy options",
      options: [
        expect.objectContaining({
          assignment_rule: "Fallback",
          fallback_reason: null,
          source_team_name: "Karmine Corp Blue",
        }),
      ],
    });
    expect(mockedInvoke).toHaveBeenCalledWith("get_academy_acquisition_options", {
      parentTeamId: "team-2",
    });
  });

  it("acquires an academy through the backend command with the selected source team", async () => {
    const updatedGame = { teams: [{ id: "mkoi-fenix" }] };
    mockedInvoke.mockResolvedValueOnce(updatedGame);

    await expect(
      acquireAcademyTeam({
        parent_team_id: "team-1",
        source_team_id: "mkoi-fenix",
        custom_name: "Movistar KOI Fénix Academy",
        custom_short_name: "MKOI F",
          custom_logo_url: "https://cdn.example/custom-logo.webp",
      }),
    ).resolves.toBe(updatedGame);
    expect(mockedInvoke).toHaveBeenCalledWith("acquire_academy_team", {
      request: {
        parentTeamId: "team-1",
        sourceTeamId: "mkoi-fenix",
        customName: "Movistar KOI Fénix Academy",
        customShortName: "MKOI F",
        customLogoUrl: "https://cdn.example/custom-logo.webp",
      },
    });
  });
});
