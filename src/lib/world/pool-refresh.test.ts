// @vitest-environment node
// Active-pros pool, delivery side: gates, the refresh with --pool, the review report and the command-line flags.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { MediaWikiClient } from "../../../scripts/world/lib/mediawiki-client.mjs";
import { serializeOverlay } from "../../../scripts/world/lib/overlay.mjs";
import { runRefresh } from "../../../scripts/world/lib/pipeline.mjs";
import { fetchPoolInputs, type PoolInputs } from "../../../scripts/world/lib/pool-fetch.mjs";
import { runPoolGates } from "../../../scripts/world/lib/pool-gates.mjs";
import { explainProbe } from "../../../scripts/world/lib/pool-report.mjs";
import { personFromRow } from "../../../scripts/world/lib/pool-scope.mjs";
import { POOL_LIMITS, buildPoolOps, poolId, selectPool } from "../../../scripts/world/lib/pool.mjs";
import { FIXTURES } from "./fixtures";
import { baselines, context, overlayOf, overrides, root, row, stubClient, tournamentRows, world } from "./poolFixtures";

describe("pool gates", () => {
  let ops: ReturnType<typeof buildPoolOps>;
  let overlay: ReturnType<typeof overlayOf>;
  const gates = (o: object = overlay, extra: Partial<Parameters<typeof runPoolGates>[0]> = {}) =>
    Object.fromEntries(runPoolGates({ overlay: o as never, world, overrides, bytes: 1000, ...extra }).map((g) => [g.name, g]));
  const clone = () => JSON.parse(JSON.stringify(overlay)) as { players: any[]; staff: any[] };
  beforeAll(async () => {
    const inputs = await fetchPoolInputs({ client: stubClient() });
    ops = buildPoolOps({ selection: selectPool({ people: inputs.people, context, world }), tournamentIndex: new Map(inputs.tournaments.map((t) => [t.page, t])), games: inputs.games, baselines });
    overlay = overlayOf(ops);
  });

  it("pass for a clean pool", () => {
    const result = gates();
    expect(Object.keys(result)).toEqual(["pool-size", "pool-complete", "pool-ids", "pool-no-duplicates", "pool-overlay-size"]);
    for (const g of Object.values(result)) expect(g.ok, g.detail).toBe(true);
  });

  it("fail when the pool outgrows its limits: about 5,000 players, 800 staff, or the game's ops per list", () => {
    expect(POOL_LIMITS).toMatchObject({ players: 5000, staff: 800, opsPerList: 5000 });
    expect(gates(overlay, { limits: { players: 33 } })["pool-size"]).toMatchObject({ ok: false, detail: expect.stringContaining("34 pool players (limit 33)") });
    expect(gates(overlay, { limits: { staff: 13 } })["pool-size"]).toMatchObject({ ok: false, detail: expect.stringContaining("14 pool staff (limit 13)") });
    expect(gates(overlay, { limits: { opsPerList: 20 } })["pool-size"]).toMatchObject({ ok: false, detail: expect.stringContaining("the game rejects more than 20") });
  });

  it("fail for a missing name or role", () => {
    const noName = clone();
    noName.players[0].player.match_name = " ";
    expect(gates(noName)["pool-complete"].ok).toBe(false);
    const noRole = clone();
    noRole.players[1].player.position = "Unknown";
    expect(gates(noRole)["pool-complete"]).toMatchObject({ ok: false, detail: expect.stringContaining(noRole.players[1].pool.page) });
    const staffNoRole = clone();
    staffNoRole.staff[0].staff.role = "Owner";
    expect(gates(staffNoRole)["pool-complete"].ok).toBe(false);
  });

  it("fail for ids that are not the page's, repeat, or belong to the game", () => {
    const wrong = clone();
    wrong.players[0].player.id = "player-00000000";
    expect(gates(wrong)["pool-ids"]).toMatchObject({ ok: false, detail: expect.stringContaining("player-00000000 is not the id of page") });
    const twice = clone();
    twice.players.push(JSON.parse(JSON.stringify(twice.players[0])));
    expect(gates(twice)["pool-ids"].detail).toContain("used by");
    const theirs = clone();
    theirs.players[0].player.id = world.players[0].id;
    expect(gates(theirs)["pool-ids"].detail).toContain("already in the game");
    const collided = gates(overlay, { collisions: [{ page: "Ghost", id: "player-deadbeef", with: "player-cafebabe" }] });
    expect(collided["pool-ids"]).toMatchObject({ ok: false, detail: expect.stringContaining("collides with player-cafebabe") });
  });

  it("fail for a person who is already in the game or repeated inside the pool", () => {
    const aiming = world.players.find((p) => p.match_name === "Aiming")!;
    const dupGame = clone();
    dupGame.players[0].player.match_name = aiming.match_name;
    dupGame.players[0].player.full_name = aiming.full_name;
    dupGame.players[0].player.nationality = "KR";
    expect(gates(dupGame)["pool-no-duplicates"]).toMatchObject({ ok: false, detail: expect.stringContaining("already in the game") });
    const dupPool = clone();
    const copy = JSON.parse(JSON.stringify(dupPool.players[3]));
    copy.pool.page = `${copy.pool.page} (twin)`;
    copy.player.id = poolId("player", copy.pool.page);
    dupPool.players.push(copy);
    expect(gates(dupPool)["pool-no-duplicates"]).toMatchObject({ ok: false, detail: expect.stringContaining("repeated inside the pool") });
  });

  it("fail when the overlay is bigger than the app accepts", () => {
    expect(gates(overlay, { bytes: POOL_LIMITS.overlayBytes })["pool-overlay-size"].ok).toBe(true);
    expect(gates(overlay, { bytes: POOL_LIMITS.overlayBytes + 1 })["pool-overlay-size"].ok).toBe(false);
  });
});

describe("refresh with --pool", () => {
  let inputs: PoolInputs;
  const run = (pool?: object) =>
    runRefresh({
      dataDir: FIXTURES.dataDir, teamMapPath: FIXTURES.teamMap, idMapPath: FIXTURES.idMap, client: new MediaWikiClient({ cacheDir: FIXTURES.cacheDir, offline: true }),
      asOf: "2026-11-07", ...(pool ? { pool: pool as never } : {}),
    });
  beforeAll(async () => {
    inputs = await fetchPoolInputs({ client: stubClient(), probe: "Send0o" });
  });

  it("adds the free agents next to the unchanged roster operations, and every gate passes", async () => {
    const plain = await run();
    const withPool = await run({ inputs });
    expect(withPool.overlay.players.slice(0, plain.overlay.players.length)).toEqual(plain.overlay.players);
    expect(withPool.overlay.staff.slice(0, plain.overlay.staff.length)).toEqual(plain.overlay.staff);
    expect(withPool.overlay.players).toHaveLength(plain.overlay.players.length + 34);
    expect(withPool.overlay.staff).toHaveLength(plain.overlay.staff.length + 14);
    expect(withPool.gates.results.map((g) => g.name)).toEqual([...plain.gates.results.map((g) => g.name), "pool-size", "pool-complete", "pool-ids", "pool-no-duplicates", "pool-overlay-size"]);
    for (const g of withPool.gates.results) expect(g.ok, `${g.name}: ${g.detail}`).toBe(true);
    expect(withPool.gates.ok).toBe(true);
  });

  it("is deterministic", async () => {
    expect(serializeOverlay((await run({ inputs })).overlay)).toBe(serializeOverlay((await run({ inputs })).overlay));
  });

  it("does not add anybody the roster overlay already adds (Soboro is new on Fnatic in the fixtures)", async () => {
    const soboro = personFromRow(row({ player: "Soboro", ign: "Soboro", name: "Lim Seong-min", country: "South Korea", rmin: "Top", rmax: "Top", prole: "Top", team: "" }));
    const result = await run({ inputs: { ...inputs, people: new Map([...inputs.people, ["Soboro", soboro]]) } });
    expect(result.pool!.selection.statuses.get("Soboro")).toMatchObject({ code: "roster-overlay" });
    const adds = result.overlay.players.filter((op) => op.op === "add" && op.player.match_name === "Soboro");
    expect(adds).toHaveLength(1);
    expect(adds[0]).toMatchObject({ player: { team_id: "lec-fnatic" } });
  });

  it("fails the gates when the pool outgrows the app's overlay size, instead of writing it", async () => {
    const base = await run({ inputs });
    expect(base.pool!.bytes).toBeLessThan(POOL_LIMITS.overlayBytes);
    const results = runPoolGates({ overlay: base.overlay, world: base.world, overrides, bytes: POOL_LIMITS.overlayBytes + 1 });
    expect(results.find((g) => g.name === "pool-overlay-size")!.ok).toBe(false);
  });

  it("rejects a malformed window or cap before any query", async () => {
    await expect(run({ inputs, since: "last year" })).rejects.toThrow("--pool-since");
    await expect(run({ inputs, cap: -1 })).rejects.toThrow("--pool-cap");
    await expect(run({ inputs, cap: Number.NaN })).rejects.toThrow("--pool-cap");
  });

  describe("review report", () => {
    let report: string;
    beforeAll(async () => {
      report = (await run({ inputs })).report;
    });

    it("has a pool section with the counts by role, region, level and staff kind", () => {
      expect(report).toContain("## Active-pros pool");
      expect(report).toContain("34 players and 14 staff added as teamless free agents");
      expect(report).toContain("tier-default-placeholder");
      for (const heading of ["Players by position", "Players by region", "Players by best tournament level", "Players by tier", "Staff by game role (Leaguepedia label)", "Staff by region", "Staff by best tournament level"]) {
        expect(report).toContain(heading);
      }
      expect(report).toMatch(/\| ADC|\| Top/);
      expect(report).toContain("HeadCoach (Head Coach)");
      expect(report).toMatch(/\| EMEA \| \d+ \|/);
      expect(report).toMatch(/\| Secondary \| \d+ \|/);
    });

    it("shows the funnel, so every excluded person is accounted for", () => {
      expect(report).toContain("| people with a roster entry in the filter | 61 |");
      expect(report).toContain("| no Players page | 6 |");
      expect(report).toContain("| already in the game (matcher and id-map.json) | 5 |");
      expect(report).toContain("| on a team the game has (roster overlay handles them) | 1 |");
      expect(report).toContain("| added | 48 |");
    });

    it("shows the qualifier-cap effect", () => {
      expect(report).toContain("### Qualifier cap");
      expect(report).toContain("kept: 4 tournaments, 90 roster entries");
      expect(report).toContain("left out: 5 tournaments, 638 roster entries");
      expect(report).toContain("| left out | EM 2026 Summer LCQ |");
      expect(report).toContain("| kept | LES 2027 Promotion |");
    });

    it("samples every region", () => {
      expect(report).toContain("### Sample per region");
      for (const region of ["EMEA", "Korea", "China", "Brazil", "North America", "Asia Pacific"]) expect(report).toMatch(new RegExp(`\\*\\*${region}\\*\\*\\n\\n- (player|staff) `));
    });

    it("probes Send0o: included, with his id", () => {
      expect(report).toContain("### Probe: Send0o");
      expect(report).toContain("- included: included as player-bea33543");
      expect(report).toMatch(/\d+ roster entries are in tournaments that started before 2023-11-12/);
      expect(report).toContain("PRM 2nd Division 25-26 Winter (Prime League 1st Division; level Secondary; 117 roster entries; role Top): counts");
      expect(report).toContain("NNO Cup Season 1 (NNO Prime; level Secondary; 80 roster entries; role Top): not in the recommended filter");
    });

    it("lists the refused and ambiguous people with their reasons", () => {
      expect(report).toContain("### Refused and ambiguous");
      expect(report).toContain("**no-position** (1)");
      expect(report).toContain("- player FLAME: no usable position");
    });
  });

  describe("probe", () => {
    const explain = (probe: { page: string; entries: { page: string; role: string }[] | null }, selection = selectPool({ people: inputs.people, context, world })) =>
      explainProbe({ probe, tournaments: inputs.tournaments, classes: inputs.classes, entryCount: inputs.entryCount, cap: 60, since: "2023-11-12", selection });
    const page = (name: string) => tournamentRows.find((t) => t.Name === name)!.OverviewPage;

    it("says an open qualifier is why somebody is missing", () => {
      const out = explain({ page: "Ghost", entries: [{ page: page("EM 2024 Summer LCQ"), role: "Top" }] });
      expect(out.included).toBe(false);
      expect(out.verdict).toContain("none of his tournaments counts");
      expect(out.entries[0].verdict).toBe("open qualifier: 209 roster entries, over the cap of 60");
    });

    it("says a tournament outside the filter or the window is why", () => {
      expect(explain({ page: "Ghost", entries: [{ page: page("VININE Summer Face-Off 2024"), role: "Top" }] }).entries[0].verdict).toBe("not in the recommended filter");
      expect(explain({ page: "Ghost", entries: [{ page: "Elite500 x Sidekick Nations Cup", role: "Top" }] }).entries[0].verdict).toContain("outside the window");
    });

    it("says what happened to a person the game already has, and when his entries are unknown", () => {
      expect(explain({ page: "Aiming", entries: [] }).verdict).toContain("already in the game");
      expect(explain({ page: "Ghost", entries: null }).verdict).toContain("could not be read");
      expect(explain({ page: "Ghost", entries: [] }).verdict).toContain("no tournament roster entry");
    });
  });
});

describe("refresh.mjs flags", () => {
  const CLI = path.join(root, "scripts/world/refresh.mjs");
  const base = ["--offline", "--dry-run", "--as-of", "2026-11-07", "--data-dir", FIXTURES.dataDir, "--team-map", FIXTURES.teamMap, "--id-map", FIXTURES.idMap, "--cache-dir", FIXTURES.cacheDir];
  const cli = (...args: string[]) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "world-pool-"));
    try {
      return spawnSync(process.execPath, [CLI, ...base, "--report", path.join(dir, "report.md"), ...args], { encoding: "utf8" });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  it("documents the pool flags in --help and leaves them off by default", () => {
    const help = spawnSync(process.execPath, [CLI, "--help"], { encoding: "utf8" }).stdout;
    for (const flag of ["--pool ", "--pool-since", "--pool-cap", "--pool-probe"]) expect(help).toContain(flag);
    expect(cli().stdout).not.toContain("pool:");
  });

  it("stops with a clear message when --pool has nothing cached to read offline", () => {
    const run = cli("--pool");
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("offline mode: no cached response");
  });

  it("rejects a bad --pool-cap", () => {
    const run = cli("--pool", "--pool-cap", "many");
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("--pool-cap must be a non-negative integer");
  });
});
