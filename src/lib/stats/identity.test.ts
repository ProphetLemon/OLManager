// @vitest-environment node
import { describe, expect, it } from "vitest";
import { matchPlayers, roleOfPosition } from "../../../scripts/stats/lib/identity.mjs";
import type { GamePlayer } from "../../../scripts/stats/lib/game-world.mjs";
import type { PlayerIndex } from "../../../scripts/stats/lib/normalize.mjs";

const ATTRS = { mechanics: 70, laning: 70, teamfighting: 70, macro_play: 70, consistency: 70, shotcalling: 70, champion_pool: 70, discipline: 70, mental_resilience: 70 };

function player(id: string, matchName: string, over: Partial<GamePlayer> = {}): GamePlayer {
  return {
    id, match_name: matchName, full_name: matchName, team_id: "lec-team-g2", competition: "lec", position: "Mid", attributes: ATTRS,
    potential_base: 75, market_value: 1, wage: 1, authoredOvr: 70, isFlat50: false, isAllZero: false, ...over,
  };
}
function entry(over: Partial<PlayerIndex[string]> = {}): PlayerIndex[string] {
  return {
    names: ["Caps"], teams: [{ team: "G2 Esports", competition: "lec", games: 40, lastDate: "2026-06-01" }], roles: { Mid: 40 }, games: 40,
    firstDate: "2025-01-10", lastDate: "2026-06-01", ...over,
  };
}
const teamMap = { schemaVersion: 1, teams: { "lec-team-g2": { title: "G2 Esports", name: "G2 Esports", competition: "lec" }, "lec-team-fnc": { title: "Fnatic", name: "Fnatic", competition: "lec" } } };
const run = (index: PlayerIndex, players: GamePlayer[], pins: Record<string, string | null> = {}) => matchPlayers({ index, players, teamMap, pins });

describe("roleOfPosition", () => {
  it("maps the game's ADC to the Leaguepedia Bot role", () => {
    expect(roleOfPosition("ADC")).toBe("Bot");
    expect(roleOfPosition("Bot")).toBe("Bot");
    expect(roleOfPosition("Top")).toBe("Top");
    expect(roleOfPosition("nonsense")).toBeNull();
  });
});

describe("matchPlayers", () => {
  it("matches by IGN and team, ignoring the parenthetical of the Link", () => {
    const r = run({ "Caps (Rasmus Winther)": entry() }, [player("p1", "CAPS")]);
    expect(r.matches).toEqual([{ link: "Caps (Rasmus Winther)", playerId: "p1", via: "team" }]);
    expect(r.review).toEqual([]);
    expect(r.unmatched).toEqual([]);
  });

  it("falls back to the same role and competition when the team is not mapped", () => {
    const r = run({ Caps: entry({ teams: [{ team: "Some Unmapped Team", competition: "lec", games: 5, lastDate: "2026-06-01" }] }) }, [player("p1", "Caps")]);
    expect(r.matches).toEqual([{ link: "Caps", playerId: "p1", via: "role-competition" }]);
  });

  it("matches through any seen in-game name", () => {
    const r = run({ "Kim Doe": entry({ names: ["Kimmy", "KD"] }) }, [player("p1", "kimmy")]);
    expect(r.matches.map((m: { playerId: string }) => m.playerId)).toEqual(["p1"]);
  });

  it("uses the team of the latest games", () => {
    const teams = [
      { team: "Fnatic", competition: "lec", games: 3, lastDate: "2026-08-01" },
      { team: "G2 Esports", competition: "lec", games: 50, lastDate: "2025-06-01" },
    ];
    const index = { Caps: entry({ teams, roles: { Top: 53 } }) };
    expect(run(index, [player("g2", "Caps", { team_id: "lec-team-g2", position: "Mid" })]).matches).toEqual([]);
    expect(run(index, [player("fnc", "Caps", { team_id: "lec-team-fnc", position: "Mid" })]).matches).toHaveLength(1);
  });

  it("sends a name match with the wrong team and the wrong role to review", () => {
    const r = run({ Caps: entry({ roles: { Top: 40 } }) }, [player("p1", "Caps", { team_id: "lec-team-fnc", competition: "lec", position: "Mid" })]);
    expect(r.matches).toEqual([]);
    expect(r.review).toHaveLength(1);
    expect(r.review[0]).toMatchObject({ link: "Caps", reason: "team_and_role_mismatch" });
    expect(r.review[0].candidates[0]).toMatchObject({ id: "p1", teamOk: false, roleCompetitionOk: false });
  });

  it("sends two qualifying players with the same IGN to review", () => {
    const r = run({ Caps: entry() }, [player("p1", "Caps"), player("p2", "caps")]);
    expect(r.matches).toEqual([]);
    expect(r.review[0].reason).toBe("ambiguous_game_players");
    expect(r.review[0].candidates.map((c: { id: string }) => c.id)).toEqual(["p1", "p2"]);
  });

  it("keeps the one that qualifies when a namesake is on another team and role", () => {
    const other = player("p2", "Caps", { team_id: "lec-team-fnc", position: "Top" });
    const r = run({ Caps: entry() }, [player("p1", "Caps"), other]);
    expect(r.matches).toEqual([{ link: "Caps", playerId: "p1", via: "team" }]);
  });

  it("sends two links that claim the same player to review", () => {
    const r = run({ Caps: entry(), "Caps (Brazilian Player)": entry() }, [player("p1", "Caps")]);
    expect(r.matches).toEqual([]);
    expect(r.review.map((x: { reason: string }) => x.reason)).toEqual(["ambiguous_links", "ambiguous_links"]);
  });

  it("lists links with no IGN candidate as unmatched, most games first", () => {
    const r = run({ Nobody: entry({ games: 10, names: ["Nobody"] }), Ghost: entry({ games: 90, names: ["Ghost"] }) }, [player("p1", "Someone")]);
    expect(r.unmatched.map((u: { link: string }) => u.link)).toEqual(["Ghost", "Nobody"]);
    expect(r.unmatched[0]).toMatchObject({ games: 90, team: "G2 Esports", competition: "lec" });
  });

  it("never matches free agents automatically", () => {
    const r = run({ Caps: entry() }, [player("p1", "Caps", { team_id: null, competition: null })]);
    expect(r.matches).toEqual([]);
    expect(r.review[0].reason).toBe("team_and_role_mismatch");
  });

  it("applies pins: forced id, null to never match, and reports unknown ids", () => {
    const players = [player("p1", "Caps"), player("p2", "Other", { team_id: "lec-team-fnc" })];
    const forced = run({ Caps: entry({ names: ["Caps"] }) }, players, { Caps: "p2" });
    expect(forced.matches).toEqual([{ link: "Caps", playerId: "p2", via: "pin" }]);
    const never = run({ Caps: entry() }, players, { Caps: null });
    expect(never.matches).toEqual([]);
    expect(never.review).toEqual([]);
    expect(never.unmatched).toEqual([]);
    const bad = run({ Caps: entry() }, players, { Caps: "p-missing", Gone: "p1" });
    expect(bad.pinIssues).toEqual(['Caps: pinned player "p-missing" is not in the game world', 'Gone: link is not in the Leaguepedia index']);
    expect(bad.matches).toEqual([]);
  });

  it("does not let an automatic match steal a pinned player", () => {
    const r = run({ Caps: entry(), Pinned: entry({ names: ["Pinned"] }) }, [player("p1", "Caps")], { Pinned: "p1" });
    expect(r.matches).toEqual([{ link: "Pinned", playerId: "p1", via: "pin" }]);
    expect(r.review).toEqual([]);
  });
});
