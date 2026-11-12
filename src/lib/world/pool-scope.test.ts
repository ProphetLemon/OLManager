// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildIndex, playerEntity, staffEntity } from "../../../scripts/world/lib/match.mjs";
import {
  CLASS_FILTERS,
  MAX_LIST_CHARS,
  OPEN_QUALIFIER_ENTRIES,
  cargoClasses,
  chunkNames,
  classifyTournaments,
  describePerson,
  evenSample,
  fieldCoverage,
  gameStatus,
  gameTeamKeys,
  isStaffLabel,
  mergePerson,
  normalizeTournament,
  pageClauses,
  personFromRow,
  playerPosition,
  qualifierSplit,
  seasonalLeagues,
  share,
  summarizePeople,
  tierFromAggregates,
  tournamentDays,
  type Person,
  type Tournament,
} from "../../../scripts/world/lib/pool-scope.mjs";

const fixtureDir = path.resolve(__dirname, "../../../scripts/world/fixtures/pool-scope");
const readFixture = <T,>(name: string): T => JSON.parse(fs.readFileSync(path.join(fixtureDir, name), "utf8")) as T;

const tournaments: Tournament[] = readFixture<Record<string, unknown>[]>("tournaments.json").map(normalizeTournament);
const byName = (name: string) => {
  const found = tournaments.find((t) => t.name === name);
  if (!found) throw new Error(`fixture has no tournament ${name}`);
  return found;
};
const classes = classifyTournaments(tournaments);
const classOf = (name: string) => classes.get(byName(name).page)!;

describe("normalizeTournament and tournamentDays", () => {
  it("reads the flags and the league's curated level from a Cargo row", () => {
    const t = byName("LES 2027 Promotion");
    expect(t).toMatchObject({ official: true, qualifier: true, leagueLevel: "Secondary", leagueOfficial: true, league: "Liga Española de League of Legends" });
  });

  it("counts whole days between start and end, and zero when a date is missing or reversed", () => {
    const base = byName("PRM 2nd Division 25-26 Winter");
    expect(tournamentDays(base)).toBe(29);
    expect(tournamentDays({ ...base, end: "" })).toBe(0);
    expect(tournamentDays({ ...base, end: "2000-01-01" })).toBe(0);
  });
});

describe("classifyTournaments on recorded Leaguepedia rows", () => {
  it("keeps an official promotion stage in every filter even though Leaguepedia marks it a qualifier", () => {
    expect(classOf("LES 2027 Promotion")).toMatchObject({ strict: true, recommended: true, loose: true });
    expect(classOf("PRM 1st Division 2027 Promotion")).toMatchObject({ strict: true, recommended: true, loose: true });
  });

  it("keeps an unflagged second division from the recommended filter up, not the strict one", () => {
    expect(classOf("PRM 2nd Division 25-26 Winter")).toMatchObject({ strict: false, recommended: true, loose: true });
  });

  it("keeps a first division flagged unofficial on the tournament but official on its league", () => {
    expect(classOf("PRM 1st Division 2025 Winter")).toMatchObject({ strict: true, recommended: true });
  });

  it("leaves an unflagged cup out of the strict and recommended filters", () => {
    expect(classOf("PRM Pokal 2025").recommended).toBe(false);
    expect(classOf("PRM Pokal 2025").strict).toBe(false);
  });

  it("lets the loose filter take non-qualifier tournaments of a recurring league that is neither official nor seasonal", () => {
    const loose = tournaments.filter((t) => classes.get(t.page)!.loose && !classes.get(t.page)!.recommended);
    expect(loose.length).toBeGreaterThan(0);
    for (const t of loose) expect(t.qualifier).toBe(false);
  });

  it("drops a short unofficial online event from every filter", () => {
    expect(classOf("VININE Summer Face-Off 2024")).toMatchObject({ strict: false, recommended: false, loose: false });
  });

  it("drops one-off events whose league has fewer than three tournaments, even when flagged official", () => {
    const first = tournaments.filter((t) => t.league === "First Stand");
    expect(first.length).toBeLessThan(3);
    for (const t of first) expect(classes.get(t.page)!.strict).toBe(false);
  });

  it("never includes showmatches or cup-qualifier level tournaments", () => {
    for (const t of tournaments.filter((x) => /show/i.test(x.level) || x.level === "Qualifier")) {
      expect(classes.get(t.page)).toMatchObject({ strict: false, recommended: false, loose: false });
    }
  });

  it("nests the filters: strict inside recommended inside loose", () => {
    for (const c of classes.values()) {
      if (c.strict) expect(c.recommended).toBe(true);
      if (c.recommended) expect(c.loose).toBe(true);
    }
  });

  it("finds the leagues that run in several splits", () => {
    const seasonal = seasonalLeagues(tournaments);
    expect(seasonal.has("Prime League 1st Division")).toBe(true);
    expect(seasonal.has("VININE")).toBe(false);
  });
});

describe("cargoClasses", () => {
  const parts = cargoClasses(tournaments, "2023-11-12");
  const joined = (name: keyof typeof parts) => parts[name].join("\n");

  it("maps each Cargo class to the filters that contain it", () => {
    expect(CLASS_FILTERS).toEqual({ official: ["strict", "recommended", "loose"], seasonal: ["recommended", "loose"], other: ["loose"] });
  });

  it("restricts every clause to the window, real leagues and tournaments that are not showmatches or cup qualifiers", () => {
    for (const clause of Object.values(parts).flat()) {
      expect(clause).toContain('T.DateStart >= "2023-11-12"');
      expect(clause).toContain('"Showmatch","Show Match","Qualifier"');
      expect(clause).not.toContain('"VININE"');
    }
  });

  it("puts official leagues in the official class and unflagged seasonal leagues in the seasonal one", () => {
    expect(joined("official")).toContain('"Prime League Pro Division"');
    expect(joined("official")).toContain('T.IsOfficial="1"');
    expect(joined("official")).not.toContain("T.IsQualifier");
    expect(joined("seasonal")).toContain('"Prime League 1st Division"');
    expect(joined("seasonal")).toContain('T.IsQualifier="0"');
    expect(joined("seasonal")).toContain('T.IsOfficial="0"');
  });

  it("keeps the other class to leagues with loose-only tournaments", () => {
    const loose = new Set(tournaments.filter((t) => classes.get(t.page)!.loose && !classes.get(t.page)!.recommended).map((t) => t.league));
    for (const league of loose) expect(joined("other")).toContain(`"${league}"`);
    expect(joined("other")).not.toContain('"Prime League Pro Division"');
  });

  it("splits long league lists so no clause outgrows the URL limit, and escapes quotes", () => {
    const many: Tournament[] = Array.from({ length: 400 }, (_, i) => ({
      ...tournaments[0], page: `p${i}`, league: i === 0 ? 'Say "Hi"' : `League number ${i}`, official: true, level: "Secondary",
    }));
    const official = cargoClasses(many.flatMap((t) => [t, { ...t, page: `${t.page}b` }, { ...t, page: `${t.page}c` }]), "2024-01-01").official;
    expect(official.length).toBeGreaterThan(1);
    for (const clause of official) expect(clause.length).toBeLessThan(MAX_LIST_CHARS + 600);
    expect(official.join("")).toContain('"Say \\"Hi\\""');
  });
});

describe("open qualifiers", () => {
  const entryCount = new Map<string, number>([
    [byName("LES 2027 Promotion").page, 27],
    [byName("PRM 1st Division 2027 Promotion").page, 25],
  ]);

  it("treats a strict qualifier-flagged tournament up to the threshold as a promotion-size stage and a larger one as open", () => {
    const strictQualifiers = tournaments.filter((t) => classes.get(t.page)!.strict && t.qualifier);
    expect(strictQualifiers.length).toBeGreaterThan(1);
    const big = new Map(entryCount).set(strictQualifiers[0].page, OPEN_QUALIFIER_ENTRIES + 1);
    const split = qualifierSplit(tournaments, classes, big);
    expect(split.open).toContain(strictQualifiers[0].page);
    expect(split.small).toContain(byName("LES 2027 Promotion").page);
    expect(split.small).not.toContain(strictQualifiers[0].page);
  });

  it("counts a tournament with no recorded roster as small, and ignores non-qualifiers and tournaments outside the strict filter", () => {
    const split = qualifierSplit(tournaments, classes, new Map());
    expect(split.open).toEqual([]);
    for (const page of split.small) expect(tournaments.find((t) => t.page === page)).toMatchObject({ qualifier: true });
    expect(split.small).not.toContain(byName("PRM 2nd Division 25-26 Winter").page);
  });

  it("selects tournaments by page in chunked clauses that keep the sorted order", () => {
    const pages = Array.from({ length: 120 }, (_, i) => `Some League 2025/Split ${String(i).padStart(3, "0")}`);
    const clauses = pageClauses(pages);
    expect(clauses.length).toBeGreaterThan(1);
    expect(clauses.join("")).toContain('"Some League 2025/Split 000"');
    expect(chunkNames(pages).flat()).toEqual([...pages].sort());
    expect(pageClauses([])).toEqual([]);
  });
});

describe("mergePerson", () => {
  const row = { player: "A", ign: "A", name: "A A", prole: "", rmin: "Coach", rmax: "Coach", last: "2025-01-01", n: "2", lmin: "Secondary", tmin: "Secondary", toff: "0", loff: "No", region: "EMEA", res: "EMEA" };

  it("combines the rows of one person from two classes: roles, last date, entry counts and the best tier", () => {
    const merged = mergePerson(personFromRow(row), personFromRow({ ...row, rmin: "Top", rmax: "Top", last: "2026-01-01", n: "3", lmin: "Primary" }));
    expect(merged).toMatchObject({ kind: "player", position: "Top", lastStart: "2026-01-01", entries: 5, tier: 1 });
    expect(merged.roles).toEqual(["Coach", "Top"]);
  });
});

describe("roles", () => {
  it("maps position labels, taking the first of a list", () => {
    expect(playerPosition("Top")).toBe("Top");
    expect(playerPosition("Jungle, Mid")).toBe("Jungle");
    expect(playerPosition("ADC")).toBe("Bot");
    expect(playerPosition("Coach")).toBeNull();
    expect(playerPosition("")).toBeNull();
  });

  it("tells staff labels from positions", () => {
    expect(isStaffLabel("Head Coach")).toBe(true);
    expect(isStaffLabel("Analyst")).toBe(true);
    expect(isStaffLabel("Support")).toBe(false);
    expect(isStaffLabel("")).toBe(false);
  });

  it("treats a person with only staff labels as staff and keeps the first label", () => {
    expect(describePerson(["Head Coach", "Coach"], "Coach")).toEqual({ kind: "staff", position: null, staffLabel: "Head Coach" });
  });

  it("treats anybody who ever held a position as a player, reading comma lists", () => {
    expect(describePerson(["Top,Jungle,Mid", "Coach"], "")).toEqual({ kind: "player", position: "Top", staffLabel: null });
  });

  it("falls back to the profile role when the roster names nothing, and to an unknown position last", () => {
    expect(describePerson([""], "Mid")).toMatchObject({ kind: "player", position: "Mid" });
    expect(describePerson([], "Analyst")).toMatchObject({ kind: "staff", staffLabel: "Analyst" });
    expect(describePerson([], "")).toEqual({ kind: "player", position: null, staffLabel: null });
  });
});

describe("personFromRow and summarizePeople", () => {
  const send0o = {
    player: "Send0o", ign: "Send0o", name: "Rosendo Fuentes Bóveda", country: "Spain", nat: "Spain", birth: "", res: "EMEA", prole: "Top",
    team: "Veni Vidi Vici (Spanish Team)", rmin: "Top", rmax: "Top,Jungle,Mid", last: "2026-09-23", n: "18", lmin: "Secondary", tmin: "Secondary", toff: "1", loff: "Yes", region: "EMEA",
  };

  it("builds a person from one aggregated Cargo row", () => {
    expect(personFromRow(send0o)).toMatchObject({
      page: "Send0o", kind: "player", position: "Top", tier: 2, region: "EMEA", lastStart: "2026-09-23", entries: 18,
      profile: { ign: "Send0o", country: "Spain", birthDate: "", residency: "EMEA" },
    });
  });

  it("picks the tier from the best level seen", () => {
    expect(tierFromAggregates({ leagueLevelMin: "Primary" })).toBe(1);
    expect(tierFromAggregates({ tournamentLevelMin: "Primary" })).toBe(1);
    expect(tierFromAggregates({ leagueLevelMin: "Secondary", leagueOfficial: "Yes" })).toBe(2);
    expect(tierFromAggregates({ tournamentOfficial: "1" })).toBe(2);
    expect(tierFromAggregates({})).toBe(3);
  });

  it("counts players by position and staff by label, with a region fallback to the tournament region", () => {
    const people = [
      personFromRow(send0o),
      personFromRow({ ...send0o, player: "Coachy", rmin: "Head Coach", rmax: "Head Coach", prole: "Coach", res: "", region: "Korea", toff: "0", loff: "No", lmin: "", tmin: "Secondary" }),
      personFromRow({ ...send0o, player: "Nobody", rmin: "", rmax: "", prole: "" }),
    ];
    const summary = summarizePeople(people);
    expect(summary).toMatchObject({ people: 3, players: 2, staff: 1, byPosition: { Top: 1, "(none)": 1 }, byStaffLabel: { "Head Coach": 1 } });
    expect(summary.byRegion.staff).toEqual({ Korea: 1 });
    expect(summary.byTier).toEqual({ "tier 2": 2, "tier 3": 1 });
  });

  it("drops excluded people before counting", () => {
    const people = [personFromRow(send0o), personFromRow({ ...send0o, player: "Other" })];
    expect(summarizePeople(people, { exclude: (p: Person) => p.page === "Other" }).people).toBe(1);
  });
});

describe("sampling and shares", () => {
  it("samples evenly and deterministically", () => {
    const list = Array.from({ length: 100 }, (_, i) => i);
    expect(evenSample(list, 4)).toEqual([12, 37, 62, 87]);
    expect(evenSample([1, 2], 5)).toEqual([1, 2]);
  });

  it("reports a share with its count and percentage", () => {
    expect(share([1, 2, 3, 4], (n) => n > 3)).toEqual({ count: 1, total: 4, pct: 25 });
    expect(share([], () => true)).toEqual({ count: 0, total: 0, pct: 0 });
  });
});

describe("gameStatus", () => {
  const players = [
    { id: "lec-p1", match_name: "Caps", full_name: "Rasmus Winther", nationality: "Denmark", date_of_birth: "1999-11-17", position: "Mid", team_id: null, competition: "lec", shard: "lec", raw: {} },
  ];
  const staff = [
    { id: "lec-s1", nickname: "Mithy", first_name: "Alvar", last_name: "Martin Falero", role: "HeadCoach", nationality: "Spain", team_id: null, competition: "lec", shard: "lec", raw: {} },
  ];
  const context = {
    playerIndex: buildIndex(players.map(playerEntity)),
    staffIndex: buildIndex(staff.map(staffEntity)),
    overrides: { players: [], staff: [], rejections: [] },
    teamKeys: gameTeamKeys({ teams: { "lec-g2": { title: "G2 Esports" }, "lec-x": { title: null }, "lec-y": {} } }),
  };
  const person = (profile: Record<string, string>, kind: "player" | "staff" = "player") => ({ page: profile.ign, profile, kind });

  it("reads the game's team titles, ignoring unmapped teams", () => {
    expect([...gameTeamKeys({ teams: { a: { title: "G2 Esports" }, b: { title: null } } })]).toEqual(["g2esports"]);
    expect(gameTeamKeys(undefined).size).toBe(0);
  });

  it("recognises a player already in the game by IGN and real name", () => {
    expect(gameStatus(person({ ign: "Caps", name: "Rasmus Winther", country: "Denmark" }), context)).toEqual({ status: "in-game", id: "lec-p1" });
  });

  it("recognises staff against the staff index", () => {
    expect(gameStatus(person({ ign: "Mithy", name: "Alvar Martin Falero", country: "Spain" }, "staff"), context)).toEqual({ status: "in-game", id: "lec-s1" });
  });

  it("leaves someone on a team the game has to the roster overlay", () => {
    expect(gameStatus(person({ ign: "Newbie", name: "Some One", country: "France", team: "G2 Esports" }), context)).toEqual({ status: "on-game-team" });
    expect(gameStatus(person({ ign: "Newbie", name: "Some One", currentTeams: "Other, G2 Esports" }), context)).toEqual({ status: "on-game-team" });
  });

  it("flags a same-name match with no birth date as uncertain, not as new", () => {
    expect(gameStatus(person({ ign: "Caper", name: "Rasmus Winther", country: "Denmark" }), context).status).toBe("uncertain");
  });

  it("calls everybody else new", () => {
    expect(gameStatus(person({ ign: "Send0o", name: "Sergio", country: "Spain", team: "Veni Vidi Vici" }), context)).toEqual({ status: "new" });
  });
});

describe("fieldCoverage", () => {
  it("checks the profile page, birth date, country, residency, a usable role and games", () => {
    const player = { profile: { ign: "Send0o", birthDate: "2001-05-04", country: "Spain", residency: "EMEA" }, kind: "player" as const, position: "Top", staffLabel: null };
    expect(fieldCoverage(player, 12)).toEqual({ profilePage: true, birthDate: true, country: true, residency: true, role: true, anyGames: true, tenGames: true });
    expect(fieldCoverage({ ...player, profile: {}, position: null }, 0)).toEqual({ profilePage: false, birthDate: false, country: false, residency: false, role: false, anyGames: false, tenGames: false });
  });

  it("accepts only staff labels the game can hold as a role", () => {
    const staff = (label: string) => ({ profile: {}, kind: "staff" as const, position: null, staffLabel: label });
    expect(fieldCoverage(staff("Head Coach"), 0).role).toBe(true);
    expect(fieldCoverage(staff("Analyst"), 0).role).toBe(true);
    expect(fieldCoverage(staff("Manager"), 0).role).toBe(false);
  });
});
