// @vitest-environment node
// Active-pros pool, selection side: what Leaguepedia is asked, who is chosen, with which ids and which free-agent ops.
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { serializeOverlay } from "../../../scripts/world/lib/overlay.mjs";
import { POSITIONS, validateOverlay } from "../../../scripts/world/lib/overlay-schema.mjs";
import { PEOPLE_FILTER, fetchPoolInputs, type PoolInputs } from "../../../scripts/world/lib/pool-fetch.mjs";
import {
  bestLevel, classifyTournaments, mergePerson, normalizeTournament, parseTournaments, personFromRow, qualifierSplit, TOURS_MAX_CHARS,
} from "../../../scripts/world/lib/pool-scope.mjs";
import { PLACEHOLDER_RATING, TIER_OFFSETS, buildPoolOps, isoDate, poolId, poolTournaments, selectPool, tierBaselines } from "../../../scripts/world/lib/pool.mjs";
import { baselines, context, entryRows, overlayOf, peopleOf, row, select, stubClient, tournamentRows, world } from "./poolFixtures";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

describe("fetchPoolInputs", () => {
  let inputs: PoolInputs;
  let client: ReturnType<typeof stubClient>;
  beforeAll(async () => {
    client = stubClient();
    inputs = await fetchPoolInputs({ client, probe: "Send0o" });
  });
  const peopleQueries = () => client.calls.filter((c) => c.tables.includes("Players=P"));

  it("asks for non-retired people with a Players page in every people query, in three disjoint classes", () => {
    expect(peopleQueries()).toHaveLength(3);
    for (const query of peopleQueries()) expect(query.where).toContain(PEOPLE_FILTER);
    expect(PEOPLE_FILTER).toContain('P.IsRetired="0" OR P.IsRetired IS NULL');
    expect(PEOPLE_FILTER).toContain("P.ID IS NOT NULL");
    expect(inputs.requests).toEqual({ official: 1, seasonal: 1, qualifiers: 1 });
  });

  it("keeps promotion stages and drops open qualifiers: no query names a tournament over the 60-entry cap", () => {
    const name = (n: string) => tournamentRows.find((t) => t.Name === n)!.OverviewPage;
    const kept = inputs.view.kept.map((t) => t.name).sort();
    const capped = inputs.view.capped.map((t) => t.name).sort();
    expect(kept).toEqual(["LES 2027 Promotion", "PRM 1st Division 2025 Promotion", "PRM 1st Division 2026 Promotion", "PRM 1st Division 2027 Promotion"]);
    expect(capped).toEqual(["EM 2024 Spring Play-In", "EM 2024 Summer LCQ", "EM 2025 Summer LCQ", "EM 2026 Spring Play-In", "EM 2026 Summer LCQ"]);
    expect(inputs.view).toMatchObject({ keptEntries: 90, cappedEntries: 638 });
    const wheres = peopleQueries().map((c) => c.where).join("\n");
    for (const page of inputs.view.capped.map((t) => t.page)) expect(wheres).not.toContain(page);
    expect(wheres).toContain(`"${name("LES 2027 Promotion")}"`);
    // official tournaments are fetched without their qualifier-flagged ones, which come in by page
    expect(peopleQueries().find((c) => c.where.includes('T.IsOfficial="1"'))!.where).toContain('T.IsQualifier IS NULL OR T.IsQualifier="0"');
  });

  it("moves the cap with its parameter", async () => {
    const strict = await fetchPoolInputs({ client: stubClient(), cap: 20 });
    expect(strict.view.kept.map((t) => t.name).sort()).toEqual(["PRM 1st Division 2025 Promotion", "PRM 1st Division 2026 Promotion"]);
    const loose = await fetchPoolInputs({ client: stubClient(), cap: 500 });
    expect(loose.view.capped).toHaveLength(0);
    expect(loose.view.kept).toHaveLength(9);
  });

  it("merges one person across the classes: entries add up and tournament lists join", () => {
    const send0o = inputs.people.get("Send0o")!;
    expect(send0o).toMatchObject({ entries: 11, tier: 2, bestLevel: "Secondary", kind: "player", position: "Top", region: "EMEA", lastStart: "2026-09-23" });
    expect(send0o.tournaments).toHaveLength(11);
    expect(inputs.games!.get("Send0o")).toBe(106);
  });

  it("turns missing games and probe answers into warnings, not failures", async () => {
    const partial = await fetchPoolInputs({ client: stubClient({ failGames: true, failProbe: true }), probe: "Send0o" });
    expect(partial.games).toBeNull();
    expect(partial.probe).toEqual({ page: "Send0o", entries: null });
    expect(partial.warnings).toHaveLength(2);
    expect(partial.people.size).toBe(inputs.people.size);
  });
});

describe("pool-scope additions", () => {
  it("reads a tournament list and drops a tail the server may have cut", () => {
    expect(parseTournaments("B|A|A")).toEqual({ tournaments: ["A", "B"], truncated: false });
    expect(parseTournaments("")).toEqual({ tournaments: [], truncated: false });
    const long = `${"x".repeat(TOURS_MAX_CHARS - 4)}|cut|tail`;
    expect(parseTournaments(long)).toMatchObject({ truncated: true });
    expect(parseTournaments(long).tournaments).not.toContain("tail");
  });

  it("ranks levels and keeps the best across merged rows", () => {
    expect(bestLevel("Secondary", "Primary")).toBe("Primary");
    expect(bestLevel("", "Minor")).toBe("Minor");
    expect(bestLevel("", "")).toBeNull();
    const merged = mergePerson(personFromRow(row({ lmin: "", tmin: "Secondary", tours: "A" })), personFromRow(row({ lmin: "Primary", tmin: "Primary", tours: "B" })));
    expect(merged).toMatchObject({ bestLevel: "Primary", tournaments: ["A", "B"], toursTruncated: false });
  });

  it("moves the open-qualifier threshold", () => {
    const tournaments = tournamentRows.map(normalizeTournament);
    const classes = classifyTournaments(tournaments);
    const counts = new Map(entryRows.map((r) => [r.OverviewPage, Number(r.n)]));
    expect(qualifierSplit(tournaments, classes, counts).open).toHaveLength(5);
    expect(qualifierSplit(tournaments, classes, counts, 10_000).open).toHaveLength(0);
    expect(poolTournaments(tournaments, classes, counts, 0).kept).toHaveLength(0);
  });
});

describe("selectPool", () => {
  let result: ReturnType<typeof selectPool>;
  beforeAll(async () => {
    const inputs = await fetchPoolInputs({ client: stubClient() });
    result = selectPool({ people: inputs.people, context, world });
  });

  it("adds the people the game does not have and says what it left out", () => {
    expect(result.counts).toMatchObject({ considered: 61, noPage: 6, inGame: 5, onGameTeam: 1, handledByRoster: 0, uncertain: 0, noPosition: 1, duplicates: 0, collisions: 0 });
    expect(result.players).toHaveLength(34);
    expect(result.staff).toHaveLength(14);
  });

  it("leaves out people without a Players page, with the reason", () => {
    expect(result.statuses.get("Snivy")).toMatchObject({ state: "excluded", code: "no-players-page" });
  });

  it("leaves out people the game already has (matched by IGN and name) and says which record", () => {
    for (const page of ["Aiming", "Razork", "Carzzy", "Mac", "Nukeduck"]) expect(result.statuses.get(page)).toMatchObject({ state: "excluded", code: "in-game" });
    expect(result.statuses.get("Aiming")).toMatchObject({ id: world.players.find((p) => p.match_name === "Aiming")!.id });
  });

  it("leaves out people on a team the game has: the roster overlay handles them", () => {
    expect(result.statuses.get("Obsess")).toMatchObject({ state: "excluded", code: "on-game-team" });
  });

  it("leaves out people the same run's roster overlay already adds", () => {
    const rows = [row({ player: "Soboro", ign: "Soboro", name: "Lim Seong-min", rmin: "Top", rmax: "Top", prole: "Top" })];
    expect(select(rows).players).toHaveLength(1);
    const handled = select(rows, { rosterIds: new Set([poolId("player", "Soboro")]) });
    expect(handled.players).toHaveLength(0);
    expect(handled.statuses.get("Soboro")).toMatchObject({ code: "roster-overlay" });
  });

  it("honours the reviewed id-map: a pinned page is the game's person, a rejected pair is not", () => {
    const pinned = { ...context, overrides: { players: [{ page: "Brand New", id: world.players[0].id }], staff: [], rejections: [] } };
    const rows = [row({ player: "Brand New", ign: "Brand New", name: "Totally Other" })];
    expect(selectPool({ people: peopleOf(rows), context: pinned, world }).statuses.get("Brand New")).toMatchObject({ code: "in-game", id: world.players[0].id });
  });

  it("refuses a possible match with a game record instead of adding a namesake", () => {
    const rows = [row({ player: "Aimingg", ign: "Aimingg", name: "Kim Ha-ram", country: "South Korea", birth: "", rmin: "Bot", rmax: "Bot", prole: "Bot" })];
    const refused = select(rows);
    expect(refused.players).toHaveLength(0);
    expect(refused.refused).toEqual([expect.objectContaining({ page: "Aimingg", code: "ambiguous-with-game" })]);
  });

  it("refuses people it cannot give a game role: no position, and staff labels that are not coaching", () => {
    const rows = [
      row({ player: "Flame", ign: "Flame", rmin: "", rmax: "", prole: "Streamer" }),
      row({ player: "Boss", ign: "Boss", rmin: "", rmax: "", prole: "Owner" }),
    ];
    const refused = select(rows);
    expect(refused.refused.map((r) => `${r.page}:${r.code}`)).toEqual(["Boss:non-sporting-staff", "Flame:no-position"]);
    const staff = select([row({ player: "Fixer", ign: "Fixer", rmin: "Manager", rmax: "Manager", prole: "" })]);
    expect(staff.refused).toEqual([expect.objectContaining({ code: "non-sporting-staff" })]);
  });

  it("refuses both pages when two read as the same person, in any input order", () => {
    const a = row({ player: "Twin", ign: "Twin", name: "Same Name" });
    const b = row({ player: "Twin (Same Name)", ign: "Twin", name: "Same Name" });
    for (const rows of [[a, b], [b, a]]) {
      const out = select(rows);
      expect(out.players).toHaveLength(0);
      expect(out.refused.map((r) => r.code)).toEqual(["duplicate-in-pool", "duplicate-in-pool"]);
    }
  });

  it("reports an id collision with the game and leaves the person out", () => {
    const squatter = { ...world.players[0], id: poolId("player", "Send0o") };
    const crowded = { ...world, players: [...world.players, squatter] };
    const rows = [row({ player: "Send0o", ign: "Send0o", name: "Rosendo Fuentes Bóveda", rmin: "Top", rmax: "Top", prole: "Top" })];
    const out = select(rows, { world: crowded });
    expect(out.players).toHaveLength(0);
    expect(out.collisions).toEqual([{ page: "Send0o", kind: "player", id: squatter.id, with: squatter.id }]);
    expect(out.refused).toEqual([expect.objectContaining({ code: "id-collision" })]);
  });
});

describe("ids", () => {
  it("derive from the Leaguepedia page alone: same on every run, order and machine", () => {
    expect(poolId("player", "Send0o")).toBe("player-bea33543");
    expect(poolId("player", "Send0o")).toBe(`player-${sha256("leaguepedia:Send0o").slice(0, 8)}`);
    expect(poolId("staff", "Send0o")).toBe(`staff-${sha256("leaguepedia:Send0o").slice(0, 8)}`);
  });

  it("do not change with the order people arrive in", async () => {
    const inputs = await fetchPoolInputs({ client: stubClient() });
    const forward = selectPool({ people: inputs.people, context, world });
    const backward = selectPool({ people: new Map([...inputs.people].reverse()), context, world });
    const ids = (s: typeof forward) => [...s.players, ...s.staff].map((e) => `${e.page}=${e.id}`);
    expect(ids(backward)).toEqual(ids(forward));
  });

  it("never reuse an id of the game or of another pool person", async () => {
    const inputs = await fetchPoolInputs({ client: stubClient() });
    const selected = selectPool({ people: inputs.people, context, world });
    const players = selected.players.map((e) => e.id);
    const staff = selected.staff.map((e) => e.id);
    expect(new Set(players).size).toBe(players.length);
    expect(new Set(staff).size).toBe(staff.length);
    const gamePlayers = new Set(world.players.map((p) => p.id));
    const gameStaff = new Set(world.staff.map((s) => s.id));
    expect(players.some((id) => gamePlayers.has(id))).toBe(false);
    expect(staff.some((id) => gameStaff.has(id))).toBe(false);
  });
});

describe("buildPoolOps", () => {
  let inputs: PoolInputs;
  let selected: ReturnType<typeof selectPool>;
  let ops: ReturnType<typeof buildPoolOps>;
  const build = (games: Map<string, number> | null) =>
    buildPoolOps({ selection: selected, tournamentIndex: new Map(inputs.tournaments.map((t) => [t.page, t])), games, baselines });
  beforeAll(async () => {
    inputs = await fetchPoolInputs({ client: stubClient() });
    selected = selectPool({ people: inputs.people, context, world });
    ops = build(inputs.games);
  });
  const playerOp = (page: string) => ops.players.find((e) => e.op.pool.page === page)!.op;
  const staffOp = (page: string) => ops.staff.find((e) => e.op.pool.page === page)!.op;

  it("emits teamless adds the overlay schema accepts", () => {
    expect(ops.players).toHaveLength(34);
    expect(ops.staff).toHaveLength(14);
    for (const entry of [...ops.players, ...ops.staff]) {
      expect(entry).toMatchObject({ teamId: null, competition: null });
      expect((entry.op.player ?? entry.op.staff).team_id).toBeNull();
    }
    const overlay = overlayOf(ops);
    expect(validateOverlay(overlay, { playerIds: new Set(world.players.map((p) => p.id)), staffIds: new Set(world.staff.map((s) => s.id)), teamIds: new Set(world.teams.keys()) })).toEqual({ ok: true, errors: [] });
    for (const entry of ops.players) expect(POSITIONS).toContain(entry.op.player.position);
  });

  it("carries the game's fields plus what A4 needs, and names the rating a placeholder", () => {
    const op = playerOp("Send0o");
    expect(op).toMatchObject({
      op: "add",
      evidence: "https://lol.fandom.com/wiki/Send0o",
      dob_approx: true,
      player: { id: "player-bea33543", team_id: null, position: "Top", nationality: "ES", full_name: "Rosendo Fuentes Bóveda", match_name: "Send0o", wage: 0, market_value: 0, contract_end: "" },
      pool: {
        page: "Send0o", kind: "player", role: "Top", region: "EMEA", country: "Spain", birth_date: null, tier: 2, best_level: "Secondary", entries: 11, games: 106, tournaments: 11,
        leagues: ["EMEA Masters", "Liga Española de League of Legends", "Prime League 1st Division", "Prime League Pro Division"], levels: { Secondary: 11 }, rating: PLACEHOLDER_RATING,
      },
    });
    for (const entry of [...ops.players, ...ops.staff]) expect(entry.op.pool.rating).toBe("tier-default-placeholder");
  });

  it("maps Leaguepedia's Bot to the game's ADC", () => {
    expect(playerOp("Aomine").pool.role).toBe("Bot");
    expect(playerOp("Aomine").player.position).toBe("ADC");
  });

  it("keeps a known birth date and flags only the approximate ones", () => {
    expect(playerOp("APP").player.date_of_birth).toBe("2006-11-27");
    expect(playerOp("APP").dob_approx).toBeUndefined();
    expect(playerOp("APP").pool.birth_date).toBe("2006-11-27");
    expect(playerOp("1Zeus").dob_approx).toBe(true);
    expect(staffOp("Aloxeo").staff.date_of_birth).toBe("2003-12-08");
    expect(staffOp("Aloxeo").dob_approx).toBeUndefined();
    expect(staffOp("1874").dob_approx).toBe(true);
  });

  it("gives staff a game role from the Leaguepedia label, never Assistant or Owner", () => {
    expect(staffOp("Aloxeo").staff.role).toBe("HeadCoach");
    expect(staffOp("4EverMore").staff.role).toBe("Performance Coach");
    expect(staffOp("Bichofan").staff.role).toBe("Analyst");
    expect(staffOp("Aloxeo").pool.role).toBe("Head Coach");
    for (const entry of ops.staff) expect(["HeadCoach", "Analyst", "Performance Coach", "Scout"]).toContain(entry.op.staff.role);
  });

  it("writes games null when the scoreboard counts are unavailable, and null tournaments when no list was asked for", () => {
    expect(build(null).players.every((e) => e.op.pool.games === null)).toBe(true);
    expect(playerOp("APP").pool).toMatchObject({ tournaments: null, leagues: [], levels: {} });
  });

  it("shifts the placeholder by tier: the lower the tier, the lower the rating, within the game's range", () => {
    const flat = { attributes: { mechanics: 70 }, potential: 80, range: { mechanics: { min: 40, max: 90 } } };
    const stub = { player: () => flat, staff: () => flat } as unknown as Parameters<typeof tierBaselines>[0];
    const at = (tier: number) => tierBaselines(stub, tier).player("x", "Top");
    expect(at(1).attributes.mechanics).toBe(70 + TIER_OFFSETS[1]);
    expect(at(2).attributes.mechanics).toBe(70 + TIER_OFFSETS[2]);
    expect(at(3).attributes.mechanics).toBe(70 + TIER_OFFSETS[3]);
    expect(at(3).potential).toBe(80 + TIER_OFFSETS[3]);
    expect(tierBaselines({ player: () => ({ ...flat, attributes: { mechanics: 45 } }), staff: () => flat } as never, 3).player("x", "Top").attributes.mechanics).toBe(40);
  });

  it("produces the same bytes for the same input", () => {
    expect(serializeOverlay(overlayOf(build(inputs.games)))).toBe(serializeOverlay(overlayOf(ops)));
  });

  it("validates calendar dates only", () => {
    expect(isoDate("2001-02-28")).toBe("2001-02-28");
    expect(isoDate("2001-02-30")).toBeNull();
    expect(isoDate("2001")).toBeNull();
    expect(isoDate("")).toBeNull();
  });
});
