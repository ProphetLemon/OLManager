import { describe, expect, it } from "vitest";
import type { FixtureData, GameStateData, PlayerData, TeamData } from "@/store/types";
import { getScoreboardData, separateOpponentPalette } from "./scoreboard";

const ROLES = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"] as const;

function player(id: string, teamId: string, role: string, ovr: number, extra: Partial<PlayerData> = {}): PlayerData {
  return {
    id,
    match_name: id.toUpperCase(),
    team_id: teamId,
    position: role,
    natural_position: role,
    lol_ovr: ovr,
    ...extra,
  } as unknown as PlayerData;
}

function team(id: string, colors: [string, string], extra: Partial<TeamData> = {}): TeamData {
  return {
    id,
    name: `Team ${id}`,
    short_name: id.toUpperCase(),
    logo_url: null,
    colors: { primary: colors[0], secondary: colors[1] },
    form: [],
    active_lineup_ids: [],
    ...extra,
  } as unknown as TeamData;
}

// Custom clubs take their authored colours as-is, which keeps palettes deterministic.
const CUSTOM = (slug: string) => `lec-custom-${slug}`;

function fixture(extra: Partial<FixtureData> = {}): FixtureData {
  return {
    id: "f1",
    matchday: 3,
    date: "2026-03-10",
    home_team_id: "me",
    away_team_id: "opp",
    match_type: "League",
    status: "Scheduled",
    result: null,
    ...extra,
  } as FixtureData;
}

function roster(teamId: string, base: number): PlayerData[] {
  return ROLES.map((role, i) => player(`${teamId}-${role}`, teamId, role, base + i));
}

function state(overrides: { fixtures?: FixtureData[]; teams?: TeamData[]; players?: PlayerData[]; date?: string } = {}) {
  return {
    clock: { current_date: overrides.date ?? "2026-03-08T00:00:00Z", start_date: "2026-01-01" },
    manager: { team_id: "me" },
    user_competition_id: "lec",
    teams:
      overrides.teams ??
      [
        team(CUSTOM("me"), ["#2563eb", "#f59e0b"], { id: "me", name: "Me", short_name: "ME" }),
        team(CUSTOM("opp"), ["#dc2626", "#16a34a"], { id: "opp", name: "Opp", short_name: "OPP", form: ["W", "L", "W", "W", "L", "D"] }),
      ],
    players: overrides.players ?? [...roster("me", 70), ...roster("opp", 60)],
    leagues: [
      {
        id: "l1",
        name: "LEC",
        season: 4,
        competition_id: "lec",
        standings: [],
        fixtures: overrides.fixtures ?? [fixture()],
      },
    ],
  } as unknown as GameStateData;
}

// Palettes follow the custom-club rule only when id or logo mark the team as custom.
function customTeams(mePrimary: string, oppPrimary: string, oppSecondary: string): TeamData[] {
  return [
    team("me", ["#000000", "#000000"], { name: "Me", short_name: "ME", logo_url: "data:image/svg+xml;base64,AA==", colors: { primary: mePrimary, secondary: "#f59e0b" } }),
    team("opp", ["#000000", "#000000"], { name: "Opp", short_name: "OPP", logo_url: "data:image/svg+xml;base64,AA==", colors: { primary: oppPrimary, secondary: oppSecondary }, form: ["W", "L", "W", "W", "L", "D"] }),
  ];
}

const HC = { highContrast: false };

describe("getScoreboardData", () => {
  it("returns null without a fixture, a league or the opposing team", () => {
    expect(getScoreboardData(state({ fixtures: [] }), HC)).toBeNull();
    expect(getScoreboardData({ ...state(), leagues: [] } as unknown as GameStateData, HC)).toBeNull();
    expect(getScoreboardData(state({ teams: [team("me", ["#2563eb", "#f59e0b"])] }), HC)).toBeNull();
  });

  it("ignores completed fixtures and picks the next open one", () => {
    const data = getScoreboardData(
      state({ fixtures: [fixture({ id: "done", status: "Completed" }), fixture({ id: "next", date: "2026-03-20" })] }),
      HC,
    );
    expect(data?.fixtureId).toBe("next");
  });

  it("reports the Playoffs kind and best-of for a playoff fixture", () => {
    const data = getScoreboardData(state({ fixtures: [fixture({ match_type: "Playoffs", best_of: 5 })] }), HC);
    expect(data?.kind).toBe("Playoffs");
    expect(data?.bestOf).toBe(5);
  });

  it("counts days from the game clock and reports 0 on match day", () => {
    expect(getScoreboardData(state(), HC)?.daysToGo).toBe(2);
    expect(getScoreboardData(state({ date: "2026-03-10T08:30:00Z" }), HC)?.daysToGo).toBe(0);
    expect(getScoreboardData(state({ date: "2026-04-01" }), HC)?.daysToGo).toBe(0);
  });

  describe("rest round", () => {
    const rounds = [
      fixture({ id: "md6-a", matchday: 6, date: "2026-03-10", home_team_id: "x", away_team_id: "y" }),
      fixture({ id: "md7-me", matchday: 7, date: "2026-03-17" }),
    ];

    it("flags the matchday the club sits out when the league plays before its next fixture", () => {
      expect(getScoreboardData(state({ fixtures: rounds }), HC)?.restsOnMatchday).toBe(6);
    });

    it("is null when the club plays in the league's next round, as in an even league", () => {
      const evenLeague = [
        fixture({ id: "md6-me", matchday: 6, date: "2026-03-10" }),
        fixture({ id: "md6-b", matchday: 6, date: "2026-03-10", home_team_id: "x", away_team_id: "y" }),
        fixture({ id: "md7-me", matchday: 7, date: "2026-03-17" }),
      ];
      expect(getScoreboardData(state({ fixtures: evenLeague }), HC)?.restsOnMatchday).toBeNull();
      expect(getScoreboardData(state(), HC)?.restsOnMatchday).toBeNull();
    });

    it("ignores played rounds, friendlies and a non-league next fixture", () => {
      const played = [{ ...rounds[0], status: "Completed" as const }, rounds[1]];
      expect(getScoreboardData(state({ fixtures: played }), HC)?.restsOnMatchday).toBeNull();
      const friendlyElsewhere = [{ ...rounds[0], match_type: "Friendly" as const }, rounds[1]];
      expect(getScoreboardData(state({ fixtures: friendlyElsewhere }), HC)?.restsOnMatchday).toBeNull();
      const playoffNext = [rounds[0], { ...rounds[1], match_type: "Playoffs" as const }];
      expect(getScoreboardData(state({ fixtures: playoffNext }), HC)?.restsOnMatchday).toBeNull();
    });
  });

  it("reflects home or away and competition info", () => {
    const away = getScoreboardData(state({ fixtures: [fixture({ home_team_id: "opp", away_team_id: "me" })] }), HC);
    expect(away?.isHome).toBe(false);
    expect(away?.opponent.teamId).toBe("opp");
    expect(away).toMatchObject({ competitionName: "LEC", season: 4, matchday: 3, date: "2026-03-10", bestOf: null });
  });

  it("uses five saved lineup ids and de-duplicates the fallback when one is missing", () => {
    const players = [...roster("me", 70), player("me-MID-star", "me", "MID", 99), ...roster("opp", 60)];
    const saved = ["me-TOP", "me-JUNGLE", "me-MID-star", "me-ADC", "me-SUPPORT"];
    const withSaved = state({
      players,
      teams: [team("me", ["#2563eb", "#f59e0b"], { name: "Me", short_name: "ME", active_lineup_ids: saved }), team("opp", ["#dc2626", "#16a34a"], { name: "Opp", short_name: "OPP" })],
    });
    expect(getScoreboardData(withSaved, HC)?.you.lineup.map((p) => p.playerId)).toEqual(saved);

    const broken = state({
      players,
      teams: [
        team("me", ["#2563eb", "#f59e0b"], { name: "Me", short_name: "ME", active_lineup_ids: ["me-TOP", "ghost", "me-MID-star", "me-TOP", "me-SUPPORT"] }),
        team("opp", ["#dc2626", "#16a34a"], { name: "Opp", short_name: "OPP" }),
      ],
    });
    const ids = getScoreboardData(broken, HC)!.you.lineup.map((p) => p.playerId);
    expect(ids).toEqual(["me-TOP", "me-JUNGLE", "me-MID-star", "me-ADC", "me-SUPPORT"]);
    expect(new Set(ids).size).toBe(5);
  });

  it("falls back to the best OVR per role and shows empty plates for a missing role", () => {
    const players = [
      player("a", "opp", "TOP", 55),
      player("b", "opp", "TOP", 80),
      player("c", "opp", "MID", 65),
      ...roster("me", 70),
    ];
    const lineup = getScoreboardData(state({ players }), HC)!.opponent.lineup;
    expect(lineup.map((p) => p.role)).toEqual([...ROLES]);
    expect(lineup[0]).toMatchObject({ playerId: "b", name: "B", ovr: 80 });
    expect(lineup[1]).toMatchObject({ playerId: null, name: "—", ovr: null, photo: null });
    expect(getScoreboardData(state({ players }), HC)!.opponent.lineupOvr).toBe(72.5);
  });

  it("averages the lineup OVR to one decimal and trims form to the last five", () => {
    const data = getScoreboardData(state(), HC)!;
    expect(data.you.lineupOvr).toBe(72);
    expect(data.opponent.form).toEqual(["L", "W", "W", "L", "D"]);
    expect(data.you.form).toEqual([]);
  });

  it("tolerates missing players and teams arrays", () => {
    const sparse = { ...state(), players: undefined } as unknown as GameStateData;
    expect(getScoreboardData(sparse, HC)?.you.lineupOvr).toBeNull();
  });

  it("keeps the opponent's own accent when it is distinct from ours", () => {
    const data = getScoreboardData(state({ teams: customTeams("#2563eb", "#dc2626", "#16a34a") }), HC)!;
    expect(data.opponent.palette.source).toBe("custom");
    expect(data.opponent.palette.accent).not.toBe(data.you.palette.accent);
  });

  it("swaps a clashing opponent accent for its secondary", () => {
    const data = getScoreboardData(state({ teams: customTeams("#2563eb", "#2767e8", "#dc2626") }), HC)!;
    expect(data.opponent.palette.source).toBe("secondary");
    expect(data.opponent.palette.accent).toBe(data.opponent.palette.secondary ?? "");
    expect(data.opponent.palette.foreground).toMatch(/^#/);
  });

  it("falls back to neutral zinc when the secondary clashes too", () => {
    const data = getScoreboardData(state({ teams: customTeams("#2563eb", "#2767e8", "#2a68ea") }), HC)!;
    expect(data.opponent.palette.source).toBe("neutral");
  });

  it("never lets an opponent on the fallback orange wear it", () => {
    // Greys carry no chroma, so the opponent resolves to the generic fallback orange.
    const teams = [
      team("me", ["#2563eb", "#f59e0b"], { name: "Me", short_name: "ME", logo_url: "data:image/svg+xml;base64,AA==" }),
      team("opp", ["#888888", "#999999"], { name: "Zzz Unknown Club", short_name: "ZZZ" }),
    ];
    const data = getScoreboardData(state({ teams }), HC)!;
    expect(data.opponent.palette.source).toBe("neutral");
    expect(data.opponent.palette.accent).not.toBe("#f97316");
  });
});

describe("separateOpponentPalette", () => {
  const you = { accent: "#2563eb", accentText: "#7aa2ff", foreground: "#ffffff", secondary: null, source: "custom" };
  it("returns the opponent untouched when far from our accent", () => {
    const opp = { ...you, accent: "#dc2626", source: "logo" };
    expect(separateOpponentPalette(you, opp, false)).toBe(opp);
  });
  it("replaces a fallback opponent even when the colours differ", () => {
    const opp = { ...you, accent: "#f97316", source: "fallback" };
    expect(separateOpponentPalette(you, opp, false).source).toBe("neutral");
  });
});
