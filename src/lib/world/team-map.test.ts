// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildTeamMap, loadTeamMap, summarizeTeamMap, titleVariants } from "../../../scripts/world/lib/team-map.mjs";
import { loadWorld } from "../../../scripts/world/lib/world.mjs";
import { FIXTURES } from "./fixtures";

const world = loadWorld(FIXTURES.dataDir);

/** Fake wiki: knows which titles exist, which are redirects and which are team pages. */
function fakeClient(pages: Record<string, { team?: boolean; redirectTo?: string }>) {
  const requested: string[][] = [];
  return {
    requested,
    stats: { network: 0, cacheHits: 0, retries: 0 },
    async get(params: Record<string, string>) {
      const titles = params.titles.split("|");
      requested.push(titles);
      const result: any = { query: { pages: {}, redirects: [] } };
      titles.forEach((title, i) => {
        const target = pages[title]?.redirectTo ?? title;
        if (pages[title]?.redirectTo) result.query.redirects.push({ from: title, to: target });
        const page = pages[target];
        result.query.pages[String(i)] = page
          ? { title: target, categories: page.team ? [{ title: "Category:Teams" }] : [{ title: "Category:Disambiguations" }] }
          : { title: target, missing: "" };
      });
      return result;
    },
  };
}

describe("buildTeamMap", () => {
  const lck = (name: string) => [...world.teams.values()].find((t) => t.name === name)!.id;

  it("maps exact titles, follows redirects, tries variants and flags non-team pages", async () => {
    const client = fakeClient({
      "Kiwoom DRX": { team: true },
      "Dplus KIA": { redirectTo: "Dplus Kia" },
      "Dplus Kia": { team: true },
      "KT Rolster": { team: false },
      "Gen.G": { team: true },
    });
    const fixtureWorld = { ...world, teams: new Map(world.teams) };
    fixtureWorld.teams.set("lck-gen", { id: "lck-gen", name: "Gen.G Esports", short_name: "GEN", country: "KR", team_kind: "Main", competition: "lck" });
    fixtureWorld.teams.set("lck-dplus", { id: "lck-dplus", name: "Dplus KIA", short_name: "DK", country: "KR", team_kind: "Main", competition: "lck" });
    fixtureWorld.competitions = fixtureWorld.competitions.map((c) => (c.id === "lck" ? { ...c, teamIds: [...c.teamIds, "lck-gen", "lck-dplus"] } : c));

    const map = await buildTeamMap({ client: client as never, world: fixtureWorld, competitions: ["lck"] });
    expect(map.teams[lck("Kiwoom DRX")]).toMatchObject({ title: "Kiwoom DRX", via: "exact" });
    expect(map.teams["lck-dplus"]).toMatchObject({ title: "Dplus Kia", via: "redirect" });
    expect(map.teams["lck-gen"]).toMatchObject({ title: "Gen.G", via: "variant" });
    expect(map.teams[lck("KT Rolster")]).toMatchObject({ title: null });
    expect(map.teams[lck("KT Rolster")].reason).toMatch(/not a team page/);
    expect(summarizeTeamMap(map).lck.mapped).toBe(3);
  });

  it("flags two game teams resolving to one page instead of guessing", async () => {
    const client = fakeClient({ "Fnatic": { team: true }, "Fnatic Rising": { redirectTo: "Fnatic" } });
    const twin = { ...world, teams: new Map(world.teams) };
    twin.teams.set("lec-rising", { id: "lec-rising", name: "Fnatic Rising", short_name: "FNR", country: "GB", team_kind: "Main", competition: "lec" });
    twin.competitions = twin.competitions.map((c) => (c.id === "lec" ? { ...c, teamIds: ["lec-fnatic", "lec-rising"] } : c));
    const map = await buildTeamMap({ client: client as never, world: twin, competitions: ["lec"] });
    expect(map.teams["lec-fnatic"].title).toBeNull();
    expect(map.teams["lec-fnatic"].reason).toMatch(/ambiguous/);
    expect(map.teams["lec-rising"].title).toBeNull();
  });

  it("keeps manually reviewed entries untouched", async () => {
    const client = fakeClient({});
    const existing = { teams: { "lec-fnatic": { title: "Fnatic (manual)", name: "Fnatic", competition: "lec", manual: true } } };
    const map = await buildTeamMap({ client: client as never, world, competitions: ["lec"], existing: existing as never });
    expect(map.teams["lec-fnatic"]).toEqual(existing.teams["lec-fnatic"]);
  });

  it("offers suffix variants and loads the committed map format", () => {
    expect(titleVariants("Gen.G Esports")).toContain("Gen.G");
    const file = path.join(os.tmpdir(), `team-map-${process.pid}.json`);
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, teams: {} }));
    expect(loadTeamMap(file).teams).toEqual({});
    expect(loadTeamMap(`${file}.missing`).teams).toEqual({});
    fs.rmSync(file);
    expect(Object.keys(loadTeamMap(FIXTURES.teamMap).teams).length).toBeGreaterThan(0);
  });
});
