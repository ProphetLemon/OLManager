// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  buildNationalityCorrections,
  evidenceUrl,
  mergeCorrections,
  reviewListMarkdown,
  type JoinDetail,
  type LeaguepediaRow,
  type ShippedPlayer,
} from "../../../scripts/world/lib/nationality-corrections.mjs";
import { loadWorld } from "../../../scripts/world/lib/world.mjs";

const root = path.resolve(__dirname, "../../..");
const CLI = path.join(root, "scripts/world/nationality-corrections.mjs");

const lp = (ID: string, Name: string, Country: string, NationalityPrimary = ""): LeaguepediaRow => ({ ID, Name, Country, NationalityPrimary });
const shipped = (id: string, match_name: string, full_name: string, nationality = ""): ShippedPlayer => ({
  id,
  match_name,
  full_name,
  nationality,
  team_id: null,
  shard: "players/free_agents",
});

// A tiny recorded join: the shapes of lp-join-detail.json ([tier, id, in-game name, real name, country, rows with that ID]).
const rows: LeaguepediaRow[] = [
  lp("Szygenda", "Mathias Jensen", "Denmark"),
  lp("Ray", "Ken Le", "Switzerland"),
  lp("Ray", "Raymond Smith", "Canada"),
  lp("Ray", "Lee Ray", "South Korea"),
  lp("Bluey", "Alex Blue", "United Kingdom"),
  lp("Hongkonger", "Chan Tai Man", "Hong Kong"),
  lp("Atlas", "Ana Atlas", "Atlantis"),
  lp("Sham", "Sam Sham", "Czech Republic"),
  lp("Old", "Olga Old", "Poland"),
  lp("Kamiloo", "Kamil&nbsp;Bruno&nbsp;Wahid Haudegond", "France", "France"),
];
const detail: JoinDetail[] = [
  ["A", "player-szy", "Szygenda", "Mathias Jensen", "Denmark", 1],
  ["A2", "player-ray", "ray", "Ken Le", "Switzerland", 3],
  ["A", "player-uk", "Bluey", "Alex Blue", "United Kingdom", 1],
  ["A", "player-hk", "Hongkonger", "Chan Tai Man", "Hong Kong", 1],
  ["A", "player-kam", "Kamiloo", "Kamil Bruno Mehdi Wahid Haudegond", "France", 1],
  ["B", "player-b", "Sham", "Sam", "Czech Republic", 1],
  ["C", "player-c", "Old", "Someone Else", "Poland", 1],
  ["D", "player-d", "Bambi", "Bam Bi", "Russia", 4],
];
const players: ShippedPlayer[] = [
  shipped("player-szy", "Szygenda", "Mathias Jensen"),
  shipped("player-ray", "Ray", "Ken Le"),
  shipped("player-uk", "Bluey", "Alex Blue"),
  shipped("player-hk", "Hongkonger", "Chan Tai Man"),
  shipped("player-kam", "Kamiloo", "Kamil Bruno Mehdi Wahid Haudegond"),
  shipped("player-b", "Sham", "Sam"),
  shipped("player-c", "Old", "Someone Else"),
  shipped("player-d", "Bambi", "Bam Bi"),
];

const build = (overrides: Partial<Parameters<typeof buildNationalityCorrections>[0]> = {}) =>
  buildNationalityCorrections({ detail, rows, players, existing: [], queried: "2026-11-16", ...overrides });

describe("buildNationalityCorrections", () => {
  it("writes an entry only for the two name-confirmed tiers", () => {
    const { entries, report } = build();
    expect(entries.map((e) => e.id)).toEqual(["player-hk", "player-kam", "player-ray", "player-szy", "player-uk"]);
    expect(report.perTier).toEqual({ A: 4, A2: 1 });
  });

  it("emits an empty-to-ISO-2 nationality fix with an evidence URL", () => {
    const entry = build().entries.find((e) => e.id === "player-szy");
    expect(entry).toEqual({
      id: "player-szy",
      field: "nationality",
      from: "",
      to: "DK",
      evidence: "https://lol.fandom.com/wiki/Szygenda (Leaguepedia Players, queried 2026-11-16)",
    });
  });

  it("maps United Kingdom to GB and common country names to their ISO code", () => {
    const to = Object.fromEntries(build().entries.map((e) => [e.id, e.to]));
    expect(to["player-uk"]).toBe("GB");
    expect(to["player-hk"]).toBe("HK");
    expect(to["player-ray"]).toBe("CH");
    expect(to["player-kam"]).toBe("FR");
  });

  it("takes the Leaguepedia ID from the row that matches the real name and country", () => {
    const evidence = build().entries.find((e) => e.id === "player-ray")?.evidence;
    expect(evidence).toBe("https://lol.fandom.com/wiki/Ray (Leaguepedia Players, queried 2026-11-16)");
  });

  it("skips and reports an id the shipped data lacks or that already has a nationality", () => {
    const { entries, report } = build({
      players: players.filter((p) => p.id !== "player-szy").map((p) => (p.id === "player-uk" ? { ...p, nationality: "GB" } : p)),
    });
    expect(entries.map((e) => e.id)).not.toContain("player-szy");
    expect(entries.map((e) => e.id)).not.toContain("player-uk");
    expect(report.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "player-szy", reason: expect.stringContaining("not in the shipped") }),
        expect.objectContaining({ id: "player-uk", reason: expect.stringContaining("already has nationality 'GB'") }),
      ]),
    );
  });

  it("skips a country it cannot turn into an ISO-2 code", () => {
    const { entries, report } = build({
      detail: [["A", "player-szy", "Szygenda", "Mathias Jensen", "Atlantis", 1]],
    });
    expect(entries).toEqual([]);
    expect(report.skipped[0]).toMatchObject({ id: "player-szy", reason: expect.stringContaining("Atlantis") });
  });

  it("writes one entry for an id that the join lists twice", () => {
    const twice = [detail[0], detail[0]];
    expect(build({ detail: twice }).entries).toHaveLength(1);
  });

  it("keeps existing entries, never duplicates a nationality fix, and sorts by id", () => {
    const existing = [
      { id: "player-zzz", field: "full_name", from: "A", to: "B", evidence: "kept" },
      { id: "player-szy", field: "nationality", from: "", to: "DK", evidence: "already reviewed" },
    ];
    const { entries, report } = build({ existing });
    expect(entries.filter((e) => e.id === "player-szy")).toEqual([existing[1]]);
    expect(entries.map((e) => e.id)).toEqual(["player-hk", "player-kam", "player-ray", "player-szy", "player-uk", "player-zzz"]);
    expect(report.skipped).toEqual(expect.arrayContaining([expect.objectContaining({ id: "player-szy", reason: expect.stringContaining("existing") })]));
  });

  it("gives the same bytes for the same input, whatever the input order", () => {
    const a = JSON.stringify(mergeCorrections([], build().entries));
    const b = JSON.stringify(mergeCorrections([], build({ detail: [...detail].reverse(), rows: [...rows].reverse() }).entries));
    expect(b).toBe(a);
  });

  it("lists every written entry for review with its real name, country and tier", () => {
    const markdown = reviewListMarkdown(build());
    expect(markdown).toContain("| player-szy | Szygenda | Mathias Jensen | Mathias Jensen | Denmark | DK | A |");
    expect(markdown).toContain("| player-ray | Ray | Ken Le | Ken Le | Switzerland | CH | A2 |");
    expect(markdown).not.toContain("player-b ");
  });
});

describe("evidenceUrl", () => {
  it("writes the wiki page of the Leaguepedia ID", () => {
    expect(evidenceUrl("Szygenda", "2026-11-16")).toBe("https://lol.fandom.com/wiki/Szygenda (Leaguepedia Players, queried 2026-11-16)");
    expect(evidenceUrl("Ugandan fighter", "2026-11-16")).toContain("/wiki/Ugandan_fighter ");
    expect(evidenceUrl("A&B?#", "2026-11-16")).toContain("/wiki/A%26B%3F%23 ");
  });
});

describe("nationality-corrections CLI", () => {
  const sandbox = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nat-corrections-"));
    const data = path.join(dir, "data");
    fs.mkdirSync(path.join(data, "competitions", "xx"), { recursive: true });
    fs.mkdirSync(path.join(data, "players"), { recursive: true });
    fs.mkdirSync(path.join(data, "teams"), { recursive: true });
    fs.writeFileSync(
      path.join(data, "competitions", "xx", "manifest.json"),
      JSON.stringify({ id: "xx", name: "XX", players_file: "players/xx_players.json", teams_file: "teams/xx_teams.json" }),
    );
    fs.writeFileSync(path.join(data, "teams", "xx_teams.json"), JSON.stringify([{ id: "t1", name: "T1" }]));
    fs.writeFileSync(
      path.join(data, "players", "xx_players.json"),
      JSON.stringify(players.map((p) => ({ id: p.id, match_name: p.match_name, full_name: p.full_name, nationality: "", team_id: "t1" }))),
    );
    fs.writeFileSync(path.join(dir, "rows.json"), JSON.stringify(rows));
    fs.writeFileSync(path.join(dir, "detail.json"), JSON.stringify(detail));
    fs.writeFileSync(path.join(dir, "existing.json"), JSON.stringify({ corrections: [{ id: "player-keep", field: "full_name", from: "a", to: "b", evidence: "kept" }] }));
    const run = (...extra: string[]) =>
      spawnSync(
        process.execPath,
        [CLI, "--rows", path.join(dir, "rows.json"), "--detail", path.join(dir, "detail.json"), "--data-dir", data, "--out", path.join(dir, "out.json"), ...extra],
        { encoding: "utf8" },
      );
    return { dir, run, out: path.join(dir, "out.json") };
  };

  it("reads the saved join and writes the corrections document, byte-identical on a second run", () => {
    const { dir, run, out } = sandbox();
    try {
      fs.copyFileSync(path.join(dir, "existing.json"), out);
      const first = run();
      expect(first.status, first.stderr).toBe(0);
      const text = fs.readFileSync(out, "utf8");
      const doc = JSON.parse(text);
      expect(doc.corrections.map((c: { id: string }) => c.id)).toEqual(["player-hk", "player-kam", "player-keep", "player-ray", "player-szy", "player-uk"]);
      expect(text.endsWith("}\n")).toBe(true);
      expect(run().status).toBe(0);
      expect(fs.readFileSync(out, "utf8")).toBe(text);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes the review list when asked", () => {
    const { dir, run } = sandbox();
    try {
      const list = path.join(dir, "list.md");
      expect(run("--list", list).status).toBe(0);
      expect(fs.readFileSync(list, "utf8")).toContain("player-szy");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never touches the network", () => {
    const sources = [CLI, path.join(root, "scripts/world/lib/nationality-corrections.mjs")].map((file) => fs.readFileSync(file, "utf8"));
    for (const source of sources) expect(source).not.toMatch(/fetch\(|mediawiki-client|https?\.request|node:https?|node:net/);
  });
});

describe("bundled catalog corrections", () => {
  const dataDir = path.join(root, "data");
  const bundled = JSON.parse(fs.readFileSync(path.join(root, "assets/world/catalog-corrections.json"), "utf8")).corrections as Array<Record<string, string>>;

  it("keeps every nationality fix well formed", () => {
    const fixes = bundled.filter((c) => c.field === "nationality");
    expect(new Set(fixes.map((c) => c.id)).size).toBe(fixes.length);
    for (const fix of fixes) {
      expect(fix.from).toBe("");
      expect(fix.to).toMatch(/^[A-Z]{2}$/);
      expect(fix.evidence).toMatch(/^https:\/\/lol\.fandom\.com\/wiki\/\S+ \(Leaguepedia Players, queried \d{4}-\d{2}-\d{2}\)$/);
    }
  });

  it.skipIf(!fs.existsSync(path.join(dataDir, "competitions")))("applies every bundled correction to the shipped data", () => {
    const world = loadWorld(dataDir);
    expect(world.corrections.skipped).toEqual([]);
    expect(world.corrections.applied).toBe(bundled.length);
  });
});
