// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { analyzeRosters } from "../../../scripts/world/lib/analyze.mjs";
import { MediaWikiClient, OfflineCacheMissError } from "../../../scripts/world/lib/mediawiki-client.mjs";
import { decideAbsentPlayer, isWorldTeamName } from "../../../scripts/world/lib/ops.mjs";
import { runRefresh, type RefreshResult } from "../../../scripts/world/lib/pipeline.mjs";
import { OFFLINE_LICENSE, serializeOverlay } from "../../../scripts/world/lib/overlay.mjs";
import { runGates } from "../../../scripts/world/lib/gates.mjs";
import { deterministicId } from "../../../scripts/world/lib/generate.mjs";
import { loadWorld } from "../../../scripts/world/lib/world.mjs";
import { FIXTURES } from "./fixtures";

const run = () =>
  runRefresh({
    dataDir: FIXTURES.dataDir,
    teamMapPath: FIXTURES.teamMap,
    idMapPath: FIXTURES.idMap,
    client: new MediaWikiClient({ cacheDir: FIXTURES.cacheDir, offline: true }),
    asOf: "2026-11-07",
  });

const KIWOOM = "lck-team-bc4c40ec";
const KT = "lck-team-932ee946";

describe("refresh over the recorded LCK + LEC fixtures", () => {
  let result: RefreshResult;
  beforeAll(async () => {
    result = await run();
  });
  const playerOp = (id: string) => result.overlay.players.find((op) => ("id" in op ? op.id : op.player.id) === id);

  it("moves Aiming to Kiwoom DRX and Jiwoo to KT Rolster, resolving the duplicate Jiwoo records", () => {
    expect(playerOp("player-c5877188")).toMatchObject({ op: "move", team_id: KIWOOM });
    expect(playerOp("player-f9ead664")).toMatchObject({ op: "move", team_id: KT });
    // the placeholder-named duplicate of Jiwoo is left alone
    expect(playerOp("player-a947fb1e")).toBeUndefined();
  });

  it("signs the free agents Vincenzo and Frog with Kiwoom DRX", () => {
    expect(playerOp("player-0bc1a016")).toMatchObject({ op: "move", team_id: KIWOOM });
    expect(playerOp("player-79717137")).toMatchObject({ op: "move", team_id: KIWOOM });
  });

  it("retires Ice only because his page says so, and releases players whose page shows no team", () => {
    expect(playerOp("lec-player-105501834624360050")).toMatchObject({ op: "retire", evidence: expect.stringContaining("Ice_(Yoon_Sang-hoon)") });
    expect(playerOp("lec-player-100356590519370319")).toMatchObject({ op: "move", team_id: null });
    expect(playerOp("lec-player-102174699705191142")).toMatchObject({ op: "move", team_id: null });
    // Way has no resolvable page: unknown means no op
    expect(playerOp("lec-player-107492119089043087")).toBeUndefined();
  });

  it("adds new roster members deterministically and skips inactive entries", () => {
    const soboro = result.overlay.players.find((op) => op.op === "add" && op.player.match_name === "Soboro");
    expect(soboro).toMatchObject({ op: "add", dob_approx: true });
    if (soboro?.op !== "add") throw new Error("Soboro missing");
    expect(soboro.player.id).toBe(deterministicId("player", "Soboro"));
    expect(soboro.player).toMatchObject({ team_id: "lec-fnatic", position: "Top", nationality: "KR", wage: 0, market_value: 0, contract_end: "" });
    expect(result.overlay.players.some((op) => op.op === "add" && op.player.match_name === "Larssen")).toBe(false);
    expect(result.warnings.some((w) => w.includes("Soboro"))).toBe(true);
  });

  it("adds Pad as head coach of Team Vitality and never touches owners or assistants", () => {
    const pad = result.overlay.staff.find((op) => op.op === "add" && op.staff.nickname === "Pad");
    expect(pad).toMatchObject({ op: "add", staff: { role: "HeadCoach", team_id: "lec-team-vitality" } });
    for (const op of result.overlay.staff) {
      if (op.op === "add") expect(["HeadCoach", "Analyst", "Performance Coach", "Scout"]).toContain(op.staff.role);
      else expect(op.role).not.toBe("Assistant");
    }
    const ownerIds = new Set(result.world.staff.filter((s) => s.role === "Owner").map((s) => s.id));
    expect(result.overlay.staff.some((op) => op.op !== "add" && ownerIds.has(op.id))).toBe(false);
  });

  it("refuses ambiguous and conflicting matches and reports them", () => {
    expect(playerOp("player-4bc8debd")).toBeUndefined(); // Daglas academy record, rejected in id-map.json
    expect(result.report).toContain("Skipped and ambiguous");
    expect(result.report).toMatch(/Labrov|Effort|Oner|Sharvel|FIESTA|Daglas/);
  });

  it("flags Team Heretics, whose Leaguepedia roster is short, instead of shipping a hollow team", () => {
    const failed = result.gates.results.filter((g) => !g.ok).map((g) => g.name);
    expect(failed).toEqual(["min-roster"]);
    expect(result.gates.results.find((g) => g.name === "min-roster")?.detail).toContain("lec-team-heretics-lec");
    expect(result.gates.ok).toBe(false);
  });

  it("produces byte-identical output for the same input", async () => {
    const again = await run();
    expect(serializeOverlay(again.overlay)).toBe(serializeOverlay(result.overlay));
    expect(again.report).toBe(result.report);
  });

  it("records the license and cites a page for every operation", () => {
    expect(result.overlay.source).toMatchObject({ name: "Leaguepedia", license: "CC BY-SA 3.0" });
    expect(result.overlay.source.attribution).toContain("lol.fandom.com");
    const ops = [...result.overlay.players, ...result.overlay.staff];
    expect(ops.every((op) => op.evidence.startsWith("https://lol.fandom.com/wiki/"))).toBe(true);
    expect(result.overlay.coverage).toEqual(["lck", "lckcl", "lec"].filter((c) => result.overlay.coverage.includes(c)));
  });
});

describe("overlay date", () => {
  const withOldest = (oldest: string | null) => {
    const client = new MediaWikiClient({ cacheDir: FIXTURES.cacheDir, offline: true });
    client.oldestFetchDate = () => oldest;
    return client;
  };
  const refresh = (client: MediaWikiClient, asOf?: string) =>
    runRefresh({ dataDir: FIXTURES.dataDir, teamMapPath: FIXTURES.teamMap, idMapPath: FIXTURES.idMap, client, asOf });

  it("defaults as_of to the fetch date of the oldest cache entry used", async () => {
    const result = await refresh(withOldest("2026-10-01"));
    expect(result.overlay.as_of).toBe("2026-10-01");
  });

  it("lets an explicit --as-of win but warns when it is newer than the oldest entry", async () => {
    const result = await refresh(withOldest("2026-10-01"), "2026-11-07");
    expect(result.overlay.as_of).toBe("2026-11-07");
    expect(result.warnings.some((w) => w.includes("--as-of 2026-11-07") && w.includes("2026-10-01"))).toBe(true);
  });

  it("does not warn when the explicit --as-of is not newer than the oldest entry", async () => {
    const result = await refresh(withOldest("2026-11-07"), "2026-11-07");
    expect(result.warnings.some((w) => w.includes("--as-of"))).toBe(false);
  });
});

describe("weak matches", () => {
  const world = loadWorld(FIXTURES.dataDir);
  const titleToTeam = new Map([["KT Rolster", KT]]);
  const willer = world.players.find((p) => p.id === "player-63a4a5a0")!; // on Kiwoom DRX
  const lp = (extra: object) => ({
    ign: "NewTag", page: "NewTag", realName: willer.full_name, country: "South Korea", roleLabel: "Starter", kind: "starter", position: "Mid", contractEnd: null, ...extra,
  });
  const analyze = (entry: object, overrides = {}) =>
    analyzeRosters({ world, titleToTeam, rosters: new Map([["KT Rolster", { players: [entry], staff: [] }]]), overrides });

  it("reports a name-only hit as needs-review instead of moving the player", () => {
    const analysis = analyze(lp({}));
    expect(analysis.moves).toHaveLength(0);
    expect(analysis.adds).toHaveLength(0);
    expect(analysis.issues.some((i) => i.kind === "needs-review" && i.candidates?.includes(willer.id))).toBe(true);
    expect(analysis.seenPlayers.has(willer.id)).toBe(true);
  });

  it("moves the player once id-map.json pins the page", () => {
    const analysis = analyze(lp({}), { players: [{ page: "NewTag", id: willer.id }] });
    expect(analysis.moves.map((m) => m.id)).toEqual([willer.id]);
  });

  it("moves the player when both dates of birth are known and agree", () => {
    const analysis = analyze(lp({ birthDate: willer.date_of_birth }));
    expect(analysis.moves.map((m) => m.id)).toEqual([willer.id]);
  });

  it("lists needs-review entries in their own report section", async () => {
    const report = (await run()).report;
    expect(report).toContain("## Needs review");
  });
});

describe("licence gate", () => {
  const world = loadWorld(FIXTURES.dataDir);
  const covered = new Set(world.competitions.filter((c) => c.covered).flatMap((c) => c.teamIds));
  const overlayWith = (license: string) => ({
    schemaVersion: 1, as_of: "2026-11-07", coverage: [], players: [], staff: [],
    source: { name: "Leaguepedia", url: "https://lol.fandom.com", license, license_url: "https://www.fandom.com/licensing", attribution: "x" },
  });

  it("fails when the licence is the offline placeholder", () => {
    const result = runGates({ overlay: overlayWith(OFFLINE_LICENSE.text), world, coveredTeamIds: covered });
    expect(result.ok).toBe(false);
    expect(result.results.find((g) => g.name === "license-available")?.ok).toBe(false);
  });

  it("passes with a real licence", () => {
    const result = runGates({ overlay: overlayWith("CC BY-SA 3.0"), world, coveredTeamIds: covered });
    expect(result.results.find((g) => g.name === "license-available")?.ok).toBe(true);
  });
});

describe("staff matching", () => {
  const world = loadWorld(FIXTURES.dataDir);
  const rosters = (staff: object[]) => new Map([["KT Rolster", { players: [], staff }]]);
  const titleToTeam = new Map([["KT Rolster", KT]]);
  const base = { world, titleToTeam, overrides: {} };
  const lp = (extra: object) => ({ ign: "", page: null, realName: "", country: "South Korea", roleLabel: "Coach", inactive: false, ...extra });

  it("moves matched staff to the team Leaguepedia lists them on", () => {
    const joker = world.staff.find((s) => s.nickname === "Joker")!; // Kiwoom DRX assistant
    const analysis = analyzeRosters({ ...base, rosters: rosters([lp({ ign: "Joker", realName: "Cho Jae-eup", roleLabel: "Assistant Coach" })]) });
    expect(analysis.staffMoves).toHaveLength(1);
    expect(analysis.staffMoves[0]).toMatchObject({ id: joker.id, teamChanged: true, role: null });
  });

  it("does not turn an Assistant into a head coach, and reports the policy decision", () => {
    const analysis = analyzeRosters({ ...base, rosters: rosters([lp({ ign: "Score", realName: "Go Dong-bin", roleLabel: "Head Coach" })]) });
    expect(analysis.staffMoves).toHaveLength(0);
    expect(analysis.issues.some((i) => i.kind === "role-policy")).toBe(true);
  });

  it("ignores owners and non-sporting staff, never releasing anybody for being absent", () => {
    const analysis = analyzeRosters({
      ...base,
      rosters: rosters([
        lp({ ign: "Shin", realName: "Shin Ki-hyeok", roleLabel: "Owner" }),
        lp({ ign: "Nobody", realName: "No Body", roleLabel: "Marketing Director" }),
      ]),
    });
    expect(analysis.staffMoves).toHaveLength(0);
    expect(analysis.staffAdds).toHaveLength(0);
  });
});

describe("missing-player decisions", () => {
  const player = { id: "p1", match_name: "Kid" };
  const names = new Set(["cloud9", "kiwoomdrxchallengers"]);
  const status = (extra: object) => ({ found: true, title: "Kid", isRetired: false, state: null, teamText: null, teamName: null, birthDate: null, ...extra });

  it("only retires on an explicit retired flag", () => {
    expect(decideAbsentPlayer(player, status({ isRetired: true }), names)).toMatchObject({ op: { op: "retire" } });
    expect(decideAbsentPlayer(player, status({ state: null }), names)).toHaveProperty("skip");
    expect(decideAbsentPlayer(player, { found: false }, names)).toHaveProperty("skip");
  });

  it("releases to free agency only with positive evidence", () => {
    expect(decideAbsentPlayer(player, status({ state: "previously", teamText: "mid laner for X" }), names)).toMatchObject({ op: { op: "move", team_id: null } });
    expect(decideAbsentPlayer(player, status({ state: "currently", teamName: "Some LDL Team" }), names)).toMatchObject({ op: { team_id: null } });
    expect(decideAbsentPlayer(player, status({ state: "currently", teamName: "Cloud9" }), names)).toHaveProperty("skip");
  });

  it("tolerates a typo when recognising teams of the game world", () => {
    expect(isWorldTeamName("Kiwoom DRX Challengers", new Set(["kiwoondrxchallengers"]))).toBe(true);
    expect(isWorldTeamName("Totally Else", new Set(["kiwoondrxchallengers"]))).toBe(false);
  });
});

describe("offline mode", () => {
  it("reports a missing page instead of guessing", async () => {
    const client = new MediaWikiClient({ cacheDir: FIXTURES.cacheDir, offline: true });
    await expect(client.get({ action: "parse", page: "No Such Team", prop: "sections" })).rejects.toBeInstanceOf(OfflineCacheMissError);
  });
});
