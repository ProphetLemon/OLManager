// @vitest-environment node
// The women's and marginalised-genders events enter the pool (scripts/world/lib/pool-events.mjs). The tournament rows are the real Leaguepedia
// rows of the research (women-events-2026-11-23); the 2023 Equal Esports Cup rows had no IsQualifier column there, so it is set from their names.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PEOPLE_FILTER, fetchPoolInputs } from "../../../scripts/world/lib/pool-fetch.mjs";
import { CAP_EXEMPT_PAGES, LISTED_EVENTS, LISTED_SINCE } from "../../../scripts/world/lib/pool-events.mjs";
import { cargoClasses, classifyTournaments, normalizeTournament, personFromRow, qualifierSplit } from "../../../scripts/world/lib/pool-scope.mjs";
import { DEFAULT_POOL_SINCE, selectPool } from "../../../scripts/world/lib/pool.mjs";
import { context, read, root, row, stubClient, world, type Row } from "./poolFixtures";

const rows = read<Row[]>(path.join(root, "scripts/world/fixtures/pool-women/tournaments.json"));
const page = (name: string) => rows.find((r) => r.OverviewPage === name)!;
// A league that is not on the list: two tournaments in the window and a third one before it.
const plain = (n: number, start: string): Row => ({ ...page("Our Party 23-24"), OverviewPage: `Plain Cup ${n}`, Name: `Plain Cup ${n}`, League: "Plain Cup", DateStart: start, Date: start });
// Roster entries per tournament: the six Goddess Tour pages as the research counted them, and a few listed qualifiers.
const entry = (OverviewPage: string, n: number): Row => ({ OverviewPage, n: String(n) });
const entries: Row[] = [
  entry("Ignis Cup 2024/Split 1/Goddess Tour 1", 87), entry("Ignis Cup 2024/Split 1/Goddess Tour 2", 76), entry("Ignis Cup 2024/Split 2/Goddess Tour 1", 62),
  entry("Ignis Cup 2024/Split 2/Goddess Tour 2", 57), entry("Ignis Cup 2024/Split 3/Goddess Tour 1", 50), entry("Ignis Cup 2024/Split 3/Goddess Tour 2", 61),
  entry("Equal Esports Cup 2024/Open Qualifier", 88), entry("Equal Esports Cup 2023/Open Qualifier 1", 90), entry("Equal Esports Cup 2023/Closed Qualifier 1", 16), entry("Storm Takeover 2024/Open Qualifier", 42),
];
const run = (extra: Row[] = []) => fetchPoolInputs({ client: stubClient({ tournaments: [...rows, ...extra], entries }) });

describe("the list of events", () => {
  it("holds the 14 confirmed events, each with the source that says so", () => {
    expect(LISTED_EVENTS).toHaveLength(14);
    for (const event of LISTED_EVENTS) expect(event.source).toMatch(/\S/);
    expect(LISTED_SINCE).toBe("2023-06-01");
    expect(LISTED_SINCE < DEFAULT_POOL_SINCE).toBe(true);
  });
});

describe("an allowlisted event", () => {
  it("passes the official-or-seasonal test and the three-tournaments test", async () => {
    const { classes } = await run();
    // One-off, not official, no split: La Faille (1 tournament), SheRivals, Defiance; Storm Takeover has two.
    for (const name of ["La Faille 2025", "SheRivals 2024", "Defiance 2024", "Storm Takeover 2024", "Equal Esports Cup 2024/League Phase", "GIRLGAMER 2024 Mexico City Festival"]) {
      expect(classes.get(name), name).toMatchObject({ listed: true, recommended: true, loose: true });
    }
  });

  it("is not passed by a probable, inferred or mixed event, nor by an ordinary one-off", async () => {
    const { classes } = await run();
    for (const name of ["MichiTorneos Fem 2024 Winter", "Empresses Showdown", "Spring Dawn Tournament", "Our Party 23-24", "Tunisian Super League Female/2024 Season"]) {
      expect(classes.get(name), name).toMatchObject({ listed: false, recommended: false });
    }
  });

  it("lists a GIRLGAMER edition by its page, not the whole league", async () => {
    const { tournaments } = await run();
    const pages = tournaments.map((t: { page: string }) => t.page);
    expect(pages).toContain("GIRLGAMER 2024 Mexico City Festival");
    expect(pages).not.toContain("GIRLGAMER 2023 Daejeon Festival");
  });

  it("keeps a small qualifier of the event and drops its open ones", async () => {
    const { view } = await run();
    const kept = view.kept.map((t: { page: string }) => t.page);
    const capped = view.capped.map((t: { page: string }) => t.page);
    expect(kept).toEqual(expect.arrayContaining(["Equal Esports Cup 2023/Closed Qualifier 1", "Storm Takeover 2024/Open Qualifier"]));
    expect(capped).toEqual(expect.arrayContaining(["Equal Esports Cup 2023/Open Qualifier 1", "Equal Esports Cup 2024/Open Qualifier"]));
  });
});

describe("the earlier date", () => {
  it("applies to the allowlist only: the 2023 Equal Esports Cup is in, an unlisted 2023 tournament is not", async () => {
    const { tournaments } = await run();
    const pages = tournaments.map((t: { page: string }) => t.page);
    expect(pages).toContain("Equal Esports Cup 2023");
    expect(pages).toContain("Equal Esports Cup 2023/Closed Qualifier 1");
    expect(pages).not.toContain("GIRLGAMER 2023 Cape Town Festival");
    const withPlain = await run([plain(1, "2023-08-01"), plain(2, "2023-12-01"), plain(3, "2024-01-01")]);
    expect(withPlain.tournaments.map((t: { page: string }) => t.page)).not.toContain("Plain Cup 1");
  });

  it("does not let a tournament before the pool's limit make a league recurring", async () => {
    const { classes } = await run([plain(1, "2023-08-01"), plain(2, "2023-12-01"), plain(3, "2024-01-01")]);
    expect(classes.get("Plain Cup 2")).toMatchObject({ loose: false });
  });

  it("asks for the tournaments and their roster sizes from the earlier date, and for each class from its own", async () => {
    const client = stubClient({ tournaments: rows, entries });
    await fetchPoolInputs({ client });
    for (const call of client.calls.filter((c) => c.tables === "Tournaments=T,Leagues=L" || c.tables === "TournamentPlayers=TP,Tournaments=T")) expect(call.where).toContain(`"${LISTED_SINCE}"`);
    const people = client.calls.filter((c) => c.tables.includes("Players=P") && !c.tables.includes("PlayerRedirects"));
    const listed = people.filter((c) => c.where.includes('"Equal Esports Cup"'));
    expect(listed.length).toBeGreaterThan(0);
    for (const call of listed) expect(call.where).toContain(`T.DateStart >= "${LISTED_SINCE}"`);
    const official = people.filter((c) => c.where.includes('"Ignis Cup"'));
    expect(official.length).toBeGreaterThan(0);
    for (const call of official) expect(call.where).toContain(`T.DateStart >= "${DEFAULT_POOL_SINCE}"`);
  });

  it("is the limit for everything when --pool-since is given, earlier or later than the listed date", async () => {
    for (const since of ["2022-01-01", "2025-01-01"]) {
      const client = stubClient({ tournaments: rows, entries });
      const { tournaments } = await fetchPoolInputs({ client, since, listedFrom: since });
      for (const call of client.calls.filter((c) => c.where?.includes("DateStart"))) {
        expect(call.where).toContain(`"${since}"`);
        expect(call.where).not.toContain(`"${LISTED_SINCE}"`);
        expect(call.where).not.toContain(`"${DEFAULT_POOL_SINCE}"`);
      }
      const pages = tournaments.map((t: { page: string }) => t.page);
      expect(pages.includes("Equal Esports Cup 2024/League Phase")).toBe(since < "2024-05-03");
      expect(pages.includes("Equal Esports Cup 2023")).toBe(since < "2023-09-20");
    }
  });

  it("starts the listed events at 2023-06-01 and the rest at the default when no --pool-since is given", async () => {
    const client = stubClient({ tournaments: rows, entries });
    await fetchPoolInputs({ client });
    const dates = client.calls.map((c) => c.where ?? "");
    expect(dates.some((w) => w.includes(`"${LISTED_SINCE}"`))).toBe(true);
    expect(dates.some((w) => w.includes(`"${DEFAULT_POOL_SINCE}"`))).toBe(true);
  });
});

describe("the entry cap", () => {
  it("is lifted for the four Goddess Tour pages the research names, and the other two stay under it anyway", async () => {
    const { view } = await run();
    const kept = new Map(view.kept.map((t: { page: string; entries: number }) => [t.page, t.entries]));
    expect(CAP_EXEMPT_PAGES).toHaveLength(4);
    for (const [name, n] of ([["Split 1/Goddess Tour 1", 87], ["Split 1/Goddess Tour 2", 76], ["Split 2/Goddess Tour 1", 62], ["Split 3/Goddess Tour 2", 61], ["Split 2/Goddess Tour 2", 57], ["Split 3/Goddess Tour 1", 50]] as [string, number][])) {
      expect(kept.get(`Ignis Cup 2024/${name}`), name).toBe(n);
    }
  });

  it("is lifted for nothing else: another official qualifier of 87 entries is still an open qualifier", () => {
    const list = [...rows, { ...page("Ignis Cup 2024/Split 1/Goddess Tour 1"), OverviewPage: "Ignis Cup 2025/Split 1/Goddess Tour 1" }].map(normalizeTournament);
    const counts = new Map<string, number>([["Ignis Cup 2025/Split 1/Goddess Tour 1", 87], ["Ignis Cup 2024/Split 1/Goddess Tour 1", 87]]);
    const split = qualifierSplit(list, classifyTournaments(list), counts);
    expect(split.small).toContain("Ignis Cup 2024/Split 1/Goddess Tour 1");
    expect(split.open).toContain("Ignis Cup 2025/Split 1/Goddess Tour 1");
  });

  it("is not lifted for a listed event's open qualifier", () => {
    const list = rows.map(normalizeTournament);
    const split = qualifierSplit(list, classifyTournaments(list), new Map([["Equal Esports Cup 2024/Open Qualifier", 88]]));
    expect(split.open).toContain("Equal Esports Cup 2024/Open Qualifier");
  });
});

describe("the Cargo clauses", () => {
  const list = rows.map(normalizeTournament);
  const parts = cargoClasses(list, DEFAULT_POOL_SINCE);

  it("fetch the listed leagues and pages in a class of their own, from the earlier date", () => {
    const listed = parts.listed.join("\n");
    expect(listed).toContain('"Equal Esports Cup"');
    expect(listed).toContain('"La Faille"');
    expect(listed).toContain('T.OverviewPage IN ("GIRLGAMER 2024 Mexico City Festival")');
    expect(listed).not.toContain('"Our Party"');
    for (const clause of parts.listed) {
      expect(clause).toContain(`T.DateStart >= "${LISTED_SINCE}"`);
      expect(clause).toContain('T.IsQualifier="0"');
    }
  });

  it("keep the listed leagues out of the other classes, so nobody is counted twice", () => {
    for (const name of ["official", "seasonal", "other"] as const) {
      const clauses = parts[name].filter((c: string) => !c.includes(`"League of Legends Game Changers"`));
      for (const clause of clauses) expect(clause).not.toContain('"Equal Esports Cup"');
    }
    // An official listed league is read by the official class, from the earlier date.
    const lgc = parts.official.find((c: string) => c.includes('"League of Legends Game Changers"'))!;
    expect(lgc).toContain(`T.DateStart >= "${LISTED_SINCE}"`);
    const ignis = parts.official.find((c: string) => c.includes('"Ignis Cup"'))!;
    expect(ignis).toContain(`T.DateStart >= "${DEFAULT_POOL_SINCE}"`);
  });
});

describe("the people of those events", () => {
  // Rows as the people query returns them for the listed class (a non-official league) and for the official class (Game Changers).
  const coach = row({ player: "A Coach", ign: "A Coach", rmin: "Head Coach", rmax: "Head Coach", prole: "", lmin: "", tmin: "Secondary", toff: "0", loff: "" });
  const gameChanger = row({ player: "A Player", ign: "A Player", lmin: "", tmin: "Secondary", toff: "1", loff: "" });
  const peopleFor = (params: Row) => (params.where.includes('"Equal Esports Cup"') ? [coach] : params.where.includes('"League of Legends Game Changers"') ? [gameChanger] : []);
  const read = async () => {
    const client = stubClient({ tournaments: rows, entries, peopleFor });
    return { client, inputs: await fetchPoolInputs({ client }) };
  };

  it("are asked for with the Players-page filter, so nobody without a Players page is returned", async () => {
    const { client } = await read();
    const listed = client.calls.filter((c) => c.tables.includes("Players=P") && c.where.includes('"Equal Esports Cup"'));
    expect(listed.length).toBeGreaterThan(0);
    for (const call of listed) expect(call.where).toContain(PEOPLE_FILTER);
    expect(PEOPLE_FILTER).toContain("P.ID IS NOT NULL");
  });

  it("include their staff by the path the pool already has", async () => {
    const { inputs } = await read();
    const selection = selectPool({ people: inputs.people, context, world });
    expect(selection.staff.map((e: { page: string }) => e.page)).toContain("A Coach");
  });

  it("keep the pool's default rating rule: the tier follows Leaguepedia's own flags, 3 for a league it does not call official, 2 for Game Changers", async () => {
    const { inputs } = await read();
    expect(inputs.people.get("A Coach")!.tier).toBe(3);
    expect(inputs.people.get("A Player")!.tier).toBe(2);
  });

  it("refuses a roster row that has no Players page, if one ever comes back", () => {
    const selection = selectPool({ people: new Map([["No Page", personFromRow(row({ player: "No Page", ign: "" }))]]), context, world });
    expect(selection.statuses.get("No Page")).toMatchObject({ state: "excluded", code: "no-players-page" });
  });
});
