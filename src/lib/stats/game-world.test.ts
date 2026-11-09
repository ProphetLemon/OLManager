// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { calculateLolOvr, loadGamePlayers } from "../../../scripts/stats/lib/game-world.mjs";

const attrs = (n: number | number[]) => {
  const names = ["mechanics", "laning", "teamfighting", "macro_play", "consistency", "shotcalling", "champion_pool", "discipline", "mental_resilience"];
  return Object.fromEntries(names.map((name, i) => [name, Array.isArray(n) ? n[i] : n]));
};
const rawPlayer = (id: string, name: string, teamId: string | null, a: number | number[], over: Record<string, unknown> = {}) => ({
  id, match_name: name, full_name: `${name} Full`, team_id: teamId, position: "Mid", attributes: attrs(a), potential_base: 80, market_value: 1000, wage: 100, ...over,
});

describe("calculateLolOvr", () => {
  it("is the rounded mean of the nine attributes, clamped to 1..99", () => {
    expect(calculateLolOvr(attrs(70))).toBe(70);
    expect(calculateLolOvr(attrs([70, 70, 70, 70, 70, 70, 70, 70, 75]))).toBe(71);
    expect(calculateLolOvr(attrs([70, 70, 70, 70, 70, 70, 70, 70, 74]))).toBe(70);
    expect(calculateLolOvr(attrs(0))).toBe(1);
    expect(calculateLolOvr(attrs(120))).toBe(99);
  });
});

describe("loadGamePlayers", () => {
  let dir: string;
  const write = (file: string, json: unknown) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), JSON.stringify(json));
  };
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "game-world-"));
    for (const id of ["lec", "lck"]) {
      write(`data/competitions/${id}/manifest.json`, { id, name: id.toUpperCase(), teams_file: `teams/${id}_teams.json`, players_file: `players/${id}_players.json` });
      write(`data/teams/${id}_teams.json`, [{ id: "team-a", name: `${id} A` }, { id: "team-b", name: `${id} B` }]);
    }
    write("data/players/lec_players.json", [
      rawPlayer("p-caps", "Caps", "team-a", [60, 60, 60, 60, 60, 60, 60, 60, 61]),
      rawPlayer("p-flat", "Flat", "team-a", 50),
      rawPlayer("p-zero", "Zero", "team-b", 0),
      rawPlayer("p-gone", "Gone", "team-b", 70),
      rawPlayer("p-mover", "Mover", "team-b", 70, { position: "ADC" }),
    ]);
    write("data/players/lck_players.json", [rawPlayer("p-faker", "Faker", "team-a", 90)]);
    write("data/players/free_agents.json", [rawPlayer("p-free", "Free", "team-a", 66)]);
    write("assets/roster-overlay.json", {
      players: [
        { op: "move", id: "p-mover", team_id: "lck-team-b", position: "Support" },
        { op: "retire", id: "p-gone" },
        { op: "add", player: rawPlayer("p-new", "Newbie", "lck-team-a", 72) },
        { op: "add", player: rawPlayer("p-caps", "Dup", "lck-team-a", 72) },
        { op: "add", player: rawPlayer("p-lost", "Lost", "lck-team-zzz", 72) },
      ],
    });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const load = () => loadGamePlayers({ dataDir: path.join(dir, "data"), overlayFile: path.join(dir, "assets/roster-overlay.json"), corrections: [] });

  it("applies the roster overlay like the game: moves, retirements and adds", () => {
    const { players, report } = load();
    const byId = new Map(players.map((p: { id: string }) => [p.id, p]));
    expect(byId.has("p-gone")).toBe(false);
    expect(byId.get("p-mover")).toMatchObject({ team_id: "lck-team-b", competition: "lck", position: "Support" });
    expect(byId.get("p-new")).toMatchObject({ team_id: "lck-team-a", competition: "lck", authoredOvr: 72 });
    expect(byId.get("p-caps")).toMatchObject({ match_name: "Caps", competition: "lec" });
    expect(byId.has("p-lost")).toBe(false);
    expect(report.overlay).toEqual({ moved: 1, retired: 1, added: 1, skipped: ["p-caps: duplicate id", "p-lost: unknown team lck-team-zzz"] });
  });

  it("derives OVR and the flat-50 and all-zero flags, and keeps free agents teamless", () => {
    const { players } = load();
    const byId = new Map(players.map((p: { id: string }) => [p.id, p]));
    expect(byId.get("p-caps")).toMatchObject({ authoredOvr: 60, isFlat50: false, isAllZero: false, potential_base: 80, wage: 100, market_value: 1000 });
    expect(byId.get("p-flat")).toMatchObject({ authoredOvr: 50, isFlat50: true });
    expect(byId.get("p-zero")).toMatchObject({ authoredOvr: 1, isAllZero: true });
    expect(byId.get("p-free")).toMatchObject({ team_id: null, competition: null });
  });

  it("is sorted by id so it is deterministic", () => {
    const ids = load().players.map((p: { id: string }) => p.id);
    expect(ids).toEqual([...ids].sort());
  });
});
