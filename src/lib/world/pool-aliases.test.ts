// @vitest-environment node
// The pool follows a player's old names (Leaguepedia `PlayerRedirects`): roster rows and scoreboard rows keep the name used at the time.
// Rows are the research rows for Vicky (women-scene-2026-11-23: s1 redirects, s2 roster entries and games) and Sakkuromi, who was never renamed.
import { describe, expect, it } from "vitest";
import { fetchPoolInputs } from "../../../scripts/world/lib/pool-fetch.mjs";
import * as scope from "../../../scripts/world/lib/pool-scope.mjs";
import { row, stubClient, type Row } from "./poolFixtures";

const redirects: Row[] = [
  { AllName: "Indiff", OverviewPage: "Vicky", ID: "Indiff" },
  { AllName: "Indifferent", OverviewPage: "Vicky", ID: "Indifferent" },
  { AllName: "Sakkuromi", OverviewPage: "Sakkuromi", ID: "Sakkuromi" },
  { AllName: "Vicky", OverviewPage: "Vicky", ID: "Vicky" },
];
// Games since 2023-11-12 per scoreboard link: 6 under her page, 17 and 3 under the old names (26 in all).
const games: Row[] = [{ Link: "Indiff", n: "17" }, { Link: "Indifferent", n: "3" }, { Link: "Sakkuromi", n: "12" }, { Link: "Vicky", n: "6" }];
const vicky = (n: string, extra: Row = {}) => row({ player: "Vicky", ign: "Vicky", name: "Victoria de la Torre Serna", country: "Spain", birth: "1998-11-03", prole: "Support", rmin: "Support", rmax: "Support", n, last: "2026-11-14", lmin: "", tmin: "Secondary", toff: "0", loff: "", ...extra });
const sakkuromi = row({ player: "Sakkuromi", ign: "Sakkuromi", name: "Sonia Nieto Fonte", country: "Spain", birth: "2002-04-25", prole: "Bot", rmin: "Bot", rmax: "Bot", n: "5", last: "2026-06-20", lmin: "", tmin: "Secondary", toff: "0", loff: "" });
/** The people rows of the official class only, so a person is counted once. */
const official = (rows: Row[]) => (params: Row) => (params.where.includes('T.IsOfficial="1"') ? rows : []);
// Five roster entries under her own name; ten under "Indifferent" (8) and "Indiff" (2), which the join through PlayerRedirects returns.
const aliasRows = [vicky("8", { alias: "Indifferent" }), vicky("2", { alias: "Indiff" })];
const run = (options: Parameters<typeof stubClient>[0] = {}) => fetchPoolInputs({ client: stubClient({ redirects, games, peopleFor: official([vicky("5"), sakkuromi]), aliasPeople: aliasRows, ...options }) });

describe("aliasTargets", () => {
  it("maps each old name to the one page that claims it, and ignores a page's own name", () => {
    const { targets, ambiguous } = scope.aliasTargets(redirects);
    expect([...targets]).toEqual([["Indiff", "Vicky"], ["Indifferent", "Vicky"]]);
    expect(ambiguous).toEqual([]);
  });

  it("leaves out a name two pages claim, and reports it", () => {
    const { targets, ambiguous } = scope.aliasTargets([...redirects, { AllName: "Twin", OverviewPage: "A" }, { AllName: "Twin", OverviewPage: "B" }, { AllName: "Twin", OverviewPage: "A" }]);
    expect(targets.has("Twin")).toBe(false);
    expect(ambiguous).toEqual(["Twin"]);
    expect(targets.get("Indiff")).toBe("Vicky");
  });
});

describe("foldGames", () => {
  const folded = () => scope.foldGames(new Map(games.map((g) => [g.Link, Number(g.n)] as [string, number])), scope.aliasTargets(redirects).targets);

  it("adds the games under old names to the player's page: Vicky has 26, not 6", () => {
    expect(folded().get("Vicky")).toBe(26);
    expect(folded().has("Indiff")).toBe(false);
  });

  it("leaves a player who was never renamed as she was", () => {
    expect(folded().get("Sakkuromi")).toBe(12);
  });

  it("does not fold a name that is itself a known page, nor one two pages claim", () => {
    const targets = scope.aliasTargets([...redirects, { AllName: "Twin", OverviewPage: "A" }, { AllName: "Twin", OverviewPage: "B" }]).targets;
    const counts = new Map([["Indiff", 17], ["Twin", 4]]);
    const out = scope.foldGames(counts, targets, (name: string) => name === "Indiff");
    expect([...out]).toEqual([["Indiff", 17], ["Twin", 4]]);
  });
});

describe("fetchPoolInputs with old names", () => {
  it("counts Vicky's roster entries and games under every name she used", async () => {
    const inputs = await run();
    expect(inputs.people.get("Vicky")).toMatchObject({ entries: 15, kind: "player", position: "Support" });
    expect(inputs.games!.get("Vicky")).toBe(26);
  });

  it("changes nothing for a player who was never renamed", async () => {
    const withNames = await run();
    const without = await run({ redirects: [], aliasPeople: [] });
    expect(withNames.people.get("Sakkuromi")).toEqual(without.people.get("Sakkuromi"));
    expect(withNames.games!.get("Sakkuromi")).toBe(12);
    expect(without.games!.get("Vicky")).toBe(6);
  });

  it("gives a name two pages claim to nobody, and does not throw", async () => {
    const twin = { AllName: "Twin", OverviewPage: "A" };
    const rows = [row({ player: "A", ign: "A", alias: "Twin", n: "4" }), row({ player: "B", ign: "B", alias: "Twin", n: "4" })];
    const inputs = await run({ redirects: [...redirects, twin, { AllName: "Twin", OverviewPage: "B" }], aliasPeople: [...aliasRows, ...rows], games: [...games, { Link: "Twin", n: "9" }] });
    expect(inputs.people.has("A")).toBe(false);
    expect(inputs.people.has("B")).toBe(false);
    expect(inputs.games!.get("Twin")).toBe(9);
    expect(inputs.aliases.ambiguous).toEqual(["Twin"]);
    expect(inputs.people.get("Vicky")!.entries).toBe(15);
  });

  it("does not move the rows of a name that is a page of its own", async () => {
    const dual = row({ player: "Dual", ign: "Dual", n: "2" });
    const inputs = await run({
      redirects: [...redirects, { AllName: "Dual", OverviewPage: "Vicky" }], peopleFor: official([vicky("5"), sakkuromi, dual]),
      aliasPeople: [...aliasRows, vicky("7", { alias: "Dual" })], games: [...games, { Link: "Dual", n: "5" }],
    });
    expect(inputs.people.get("Vicky")!.entries).toBe(15);
    expect(inputs.people.get("Dual")!.entries).toBe(2);
    expect(inputs.games!.get("Dual")).toBe(5);
    expect(inputs.games!.get("Vicky")).toBe(26);
  });

  it("makes no person of a redirect that points at a page with no Players row", async () => {
    const inputs = await run({ redirects: [...redirects, { AllName: "Ghost Name", OverviewPage: "No Page" }], games: [...games, { Link: "Ghost Name", n: "3" }] });
    expect(inputs.people.has("No Page")).toBe(false);
    expect(inputs.people.has("Ghost Name")).toBe(false);
  });

  it("falls back to the old behaviour with a warning when the redirects cannot be read", async () => {
    const client = stubClient({ failRedirects: true, games, peopleFor: official([vicky("5"), sakkuromi]), aliasPeople: aliasRows });
    const inputs = await fetchPoolInputs({ client });
    expect(inputs.warnings.some((w: string) => w.includes("redirects unavailable"))).toBe(true);
    expect(inputs.people.get("Vicky")!.entries).toBe(5);
    expect(inputs.games!.get("Vicky")).toBe(6);
    expect(client.calls.some((c) => c.tables.includes("PlayerRedirects=PR,"))).toBe(false);
  });

  it("reads the redirects once, and joins them to the people only when there are old names", async () => {
    const client = stubClient({ redirects, games, peopleFor: official([vicky("5")]), aliasPeople: aliasRows });
    await fetchPoolInputs({ client });
    expect(client.calls.filter((c) => c.tables === "PlayerRedirects=PR")).toHaveLength(1);
    const joined = client.calls.filter((c) => c.tables.includes("PlayerRedirects=PR,"));
    expect(joined.length).toBeGreaterThan(0);
    for (const call of joined) expect(call.where).toContain("PR.AllName<>PR.OverviewPage");
    const plain = stubClient();
    await fetchPoolInputs({ client: plain });
    expect(plain.calls.filter((c) => c.tables.includes("PlayerRedirects=PR,"))).toHaveLength(0);
  });
});
