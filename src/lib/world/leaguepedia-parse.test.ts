// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  classifyRole,
  findTeamSections,
  isDisambiguation,
  parseInfobox,
  parseIntro,
  teamNameFromIntro,
} from "../../../scripts/world/lib/leaguepedia-parse.mjs";
import { MediaWikiClient } from "../../../scripts/world/lib/mediawiki-client.mjs";
import { fetchTeamRoster } from "../../../scripts/world/lib/pipeline.mjs";
import { lookupPlayerStatus } from "../../../scripts/world/lib/player-status.mjs";
import { FIXTURES } from "./fixtures";

const client = () => new MediaWikiClient({ cacheDir: FIXTURES.cacheDir, offline: true });

describe("Leaguepedia roster parsing (recorded pages)", () => {
  it("reads the active roster with names, roles, countries and contract dates", async () => {
    const roster = await fetchTeamRoster(client(), "Team Vitality");
    expect(roster.error).toBeUndefined();
    const fiesta = roster.players.find((p) => p.ign === "FIESTA");
    expect(fiesta).toMatchObject({
      page: "FIESTA (An Hyeon-seo)",
      realName: "An Hyeon-seo",
      country: "South Korea",
      kind: "starter",
      position: "Mid",
    });
    expect(fiesta?.contractEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(roster.players.map((p) => p.position)).toContain("ADC");
  });

  it("reads the current staff table and flags inactive entries", async () => {
    const { staff } = await fetchTeamRoster(client(), "Team Vitality");
    const pad = staff.find((s) => s.ign === "Pad");
    expect(pad).toMatchObject({ realName: "Patrick Suckow-Breum", roleLabel: "Head Coach", country: "Denmark", inactive: false });
  });

  it("classifies substitute, trainee and inactive roles separately from starters", () => {
    expect(classifyRole("Top Laner")).toMatchObject({ kind: "starter", position: "Top" });
    expect(classifyRole("Bot Laner")).toMatchObject({ kind: "starter", position: "ADC" });
    expect(classifyRole("Sub/Jun")).toMatchObject({ kind: "sub", position: "Jungle" });
    expect(classifyRole("Trn/Sup")).toMatchObject({ kind: "trainee", position: "Support" });
    expect(classifyRole("IA/Mid")).toMatchObject({ kind: "inactive", position: "Mid" });
    expect(classifyRole("Streamer").kind).toBe("unknown");
  });

  it("finds the Active and Organization > Current sections", () => {
    const sections = [
      { line: "Player Roster", number: "2", index: "5" },
      { line: "Active", number: "2.1", index: "6" },
      { line: "Former", number: "2.2", index: "7" },
      { line: "Organization", number: "3", index: "9" },
      { line: "Current", number: "3.1", index: "10" },
    ];
    expect(findTeamSections(sections)).toEqual({ active: "6", staff: "10" });
    expect(findTeamSections([{ line: "History", number: "1", index: "1" }])).toEqual({ active: null, staff: null });
  });

  it("detects a retired player from the infobox and the lead sentence", async () => {
    const status = await lookupPlayerStatus(client(), { match_name: "Ice", full_name: "Yoon Sang-hoon" });
    expect(status).toMatchObject({ found: true, isRetired: true, title: "Ice (Yoon Sang-hoon)" });
  });

  it("treats 'previously' as no current team but not as retirement", async () => {
    const status = await lookupPlayerStatus(client(), { match_name: "Humanoid", full_name: "Marek Brázda" });
    expect(status).toMatchObject({ found: true, isRetired: false, state: "previously" });
  });

  it("skips disambiguation pages and parses infobox fields", () => {
    expect(isDisambiguation("{{DisambigPage\n|player1=Ice (A)\n}}")).toBe(true);
    const infobox = parseInfobox(
      "{{Infobox Player\n|isretired=No\n|id=Soboro\n|name=Lim Seong-min\n|country=South Korea\n|birth_date_year=2004\n|birth_date_month=March\n|birth_date_day=09\n}}\n== Bio ==",
    );
    expect(infobox).toMatchObject({ isRetired: false, name: "Lim Seong-min", birthDate: "2004-03-09" });
  });

  it("parses the lead sentence", () => {
    const intro = parseIntro("<p>Ice is a Korean esports player, currently mid laner for Cloud9 .</p>");
    expect(intro).toEqual({ state: "currently", teamText: "mid laner for Cloud9" });
    expect(teamNameFromIntro(intro.teamText)).toBe("Cloud9");
    expect(parseIntro("<p>Nothing useful here.</p>").state).toBeNull();
  });
});
