// @vitest-environment node
// Pool adds carry an ISO-2 nationality whenever Leaguepedia gives a country the game can name (tracker row 118).
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildPoolOps } from "../../../scripts/world/lib/pool.mjs";
import { countryToIso2 } from "../../../scripts/world/lib/text.mjs";
import { baselines, row, select } from "./poolFixtures";

const opsFor = (overrides: Record<string, string>) => {
  const selection = select([row({ player: "Candidate", ign: "Candidate", rmin: "Mid", rmax: "Mid", prole: "Mid", ...overrides })]);
  return buildPoolOps({ selection, tournamentIndex: new Map(), games: null, baselines });
};

describe("Leaguepedia country spellings the pool met", () => {
  it.each([
    ["Moldova", "MD"],
    ["DR Congo", "CD"],
    ["Republic of Ireland", "IE"],
  ])("%s resolves to %s", (country, iso2) => {
    expect(countryToIso2(country)).toBe(iso2);
  });
});

describe("pool nationality", () => {
  it("fills the ISO-2 code of a spelling the country table lacked", () => {
    const { players } = opsFor({ country: "Moldova" });
    expect(players).toHaveLength(1);
    expect(players[0].op.player.nationality).toBe("MD");
    expect(players[0].note).not.toContain("nationality unresolved");
  });

  it("falls back to the primary nationality when the country does not resolve", () => {
    const { players } = opsFor({ country: "Atlantis", nat: "Australia" });
    expect(players[0].op.player.nationality).toBe("AU");
  });

  it("keeps the country when both resolve", () => {
    const { players } = opsFor({ country: "Republic of Ireland", nat: "Australia" });
    expect(players[0].op.player.nationality).toBe("IE");
  });

  it("leaves the nationality empty and says so when Leaguepedia names no country", () => {
    const { players } = opsFor({ country: "", nat: "" });
    expect(players[0].op.player.nationality).toBe("");
    expect(players[0].note).toContain("nationality unresolved");
  });

  it("applies the same fallback to staff", () => {
    const { staff } = opsFor({ country: "Atlantis", nat: "Denmark", prole: "Coach", rmin: "Head Coach", rmax: "Head Coach" });
    expect(staff).toHaveLength(1);
    expect(staff[0].op.staff.nationality).toBe("DK");
  });
});

describe("the shipped overlay", () => {
  // Leaguepedia's Players pages name no country (Country and NationalityPrimary empty) for these free agents, so their flag stays empty.
  const NO_LEAGUEPEDIA_COUNTRY = [
    "DEK", "Dengleng", "Kibear", "Lagneia", "Likable", "Murasame", "OmulFinn", "Poren", "Rank", "Sovereign", "Sym", "Xiao Yu", "Zeusman", "eHopp", "m0chi",
  ];
  const overlay = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../assets/world/roster-overlay.json"), "utf8"));

  it("has an ISO-2 nationality on every teamless player add except the people Leaguepedia has no country for", () => {
    const teamless = overlay.players.filter((op: { op: string; player?: { team_id: string | null } }) => op.op === "add" && !op.player?.team_id);
    const empty = teamless.filter((op: { player: { nationality: string } }) => !op.player.nationality).map((op: { player: { match_name: string } }) => op.player.match_name);
    expect(empty.sort()).toEqual([...NO_LEAGUEPEDIA_COUNTRY].sort());
    for (const op of teamless) expect(op.player.nationality).toMatch(/^([A-Z]{2})?$/);
  });
});
