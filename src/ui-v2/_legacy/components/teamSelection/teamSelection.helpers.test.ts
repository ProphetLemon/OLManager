import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";

import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import {
  formatFinance,
  getReputationLabel,
  joinLeagueWithCustomTeam,
  loadLeagueSelectionData,
  selectTeam,
} from "@/ui-v2/_legacy/components/teamSelection/teamSelection.helpers";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

describe("getReputationLabel", () => {
  const cases: [number, string, string, string][] = [
    [800, "World Class", "Clase Mundial", "secondary"],
    [650, "Strong", "Fuerte", "default"],
    [450, "Average", "Medio", "secondary"],
    [100, "Developing", "En Desarrollo", "destructive"],
  ];

  it.each(cases)("maps reputation %i to a translatable tier key", (rep, enLabel, esLabel, variant) => {
    const tier = getReputationLabel(rep);
    const lookup = (dict: unknown) =>
      tier.labelKey.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], dict);
    expect(lookup(en)).toBe(enLabel);
    expect(lookup(es)).toBe(esLabel);
    expect(tier.variant).toBe(variant);
  });
});

describe("teamSelection.helpers", () => {
  it("returns league selection data", async () => {
    const data = {
      competitions: [
        {
          id: "lec",
          name: "LEC",
          region: "Europe",
          logo: null,
          tier: 1,
          team_count: 1,
          teams: [
            {
              id: "g2",
              name: "G2 Esports",
              short_name: "G2",
              logo_url: null,
              country: "Germany",
              ovr: 80,
            },
          ],
        },
      ],
    };

    mockedInvoke.mockResolvedValue(data);

    await expect(loadLeagueSelectionData()).resolves.toBe(data);
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
  });

  it("selectTeam omits customTeam when absent", async () => {
    mockedInvoke.mockReset();
    mockedInvoke.mockResolvedValue({});
    await selectTeam("les-a", "es");
    expect(mockedInvoke).toHaveBeenCalledWith("select_team", { teamId: "les-a", lang: "es" });
    expect(Object.keys(mockedInvoke.mock.calls[0][1] as object)).not.toContain("customTeam");
    await selectTeam("les-a");
    expect(mockedInvoke).toHaveBeenLastCalledWith("select_team", { teamId: "les-a", lang: "en" });
  });

  it("selectTeam passes the custom team spec through in snake_case", async () => {
    mockedInvoke.mockReset();
    mockedInvoke.mockResolvedValue({});
    const spec = {
      name: "Ray Gaming",
      short_name: "RAY",
      primary_color: "#f97316",
      secondary_color: "#18181b",
      country: "ES",
    };
    await selectTeam("les-a", "es", spec);
    expect(mockedInvoke).toHaveBeenCalledWith("select_team", {
      teamId: "les-a",
      lang: "es",
      customTeam: spec,
    });
  });

  it("joinLeagueWithCustomTeam sends the competition and the spec, with no teamId", async () => {
    mockedInvoke.mockReset();
    mockedInvoke.mockResolvedValue({});
    const spec = {
      name: "Rayo Esports",
      short_name: "RAY",
      primary_color: "#f97316",
      secondary_color: "#111111",
      country: "ES",
      founding_seed: 7,
    };
    await joinLeagueWithCustomTeam("les", "en", spec);
    expect(mockedInvoke).toHaveBeenCalledWith("select_team", {
      lang: "en",
      joinsCompetitionId: "les",
      customTeam: spec,
    });
    expect(Object.keys(mockedInvoke.mock.calls[0][1] as object)).not.toContain("teamId");
    await joinLeagueWithCustomTeam("les", undefined, spec);
    expect(mockedInvoke).toHaveBeenLastCalledWith("select_team", expect.objectContaining({ lang: "en" }));
  });
});

describe("formatFinance in the game language", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it.each([
    ["es", "€1,5M"],
    ["en", "€1.5M"],
  ])("writes millions in %s", async (language, expected) => {
    await i18n.changeLanguage(language);
    expect(formatFinance(1_500_000)).toBe(expected);
    expect(formatFinance(250_000)).toBe("€250K");
  });
});
