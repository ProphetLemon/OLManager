// @vitest-environment node
// The women's and marginalised-genders events enter the pool (scripts/world/lib/pool-events.mjs). The tournament rows are the real Leaguepedia
// rows of the research (women-events-2026-11-23); the 2023 Equal Esports Cup rows had no IsQualifier column there, so it is set from their names.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fetchPoolInputs } from "../../../scripts/world/lib/pool-fetch.mjs";
import { CAP_EXEMPT_PAGES, LISTED_EVENTS, LISTED_SINCE } from "../../../scripts/world/lib/pool-events.mjs";
import { cargoClasses, classifyTournaments, normalizeTournament, qualifierSplit } from "../../../scripts/world/lib/pool-scope.mjs";
import { DEFAULT_POOL_SINCE } from "../../../scripts/world/lib/pool.mjs";
import { read, root, row, select, stubClient, type Row } from "./poolFixtures";

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

  it("moves with --pool-since only when that goes further back", async () => {
    const early = stubClient({ tournaments: rows, entries });
    await fetchPoolInputs({ client: early, since: "2022-01-01" });
    expect(early.calls[0].where).toContain('"2022-01-01"');
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
  const staffRow = row({ player: "A Coach", ign: "A Coach", rmin: "Head Coach", rmax: "Head Coach", prole: "", lmin: "", tmin: "Secondary", toff: "0", loff: "" });
  const noPage = row({ player: "No Page", ign: "", lmin: "", tmin: "Secondary", toff: "0", loff: "" });

  it("include their staff by the path the pool already has, and nobody without a Players page", () => {
    const selection = select([staffRow, noPage]);
    expect(selection.staff.map((e: { page: string }) => e.page)).toEqual(["A Coach"]);
    expect(selection.statuses.get("No Page")).toMatchObject({ state: "excluded", code: "no-players-page" });
  });

  it("take the lowest tier's default rating, since these events are not official", () => {
    expect(select([staffRow]).staff[0].person.tier).toBe(3);
  });
});
