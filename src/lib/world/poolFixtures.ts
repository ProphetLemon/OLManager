// Recorded Leaguepedia rows for the active-pros pool tests and a client that answers the pool's Cargo queries from them.
import fs from "node:fs";
import path from "node:path";
import { computeBaselines } from "../../../scripts/world/lib/generate.mjs";
import { buildIndex, playerEntity, staffEntity } from "../../../scripts/world/lib/match.mjs";
import { OfflineCacheMissError } from "../../../scripts/world/lib/mediawiki-client.mjs";
import { OFFLINE_LICENSE, buildOverlay } from "../../../scripts/world/lib/overlay.mjs";
import { gameTeamKeys, personFromRow, type Person } from "../../../scripts/world/lib/pool-scope.mjs";
import { selectPool } from "../../../scripts/world/lib/pool.mjs";
import { loadTeamMap } from "../../../scripts/world/lib/team-map.mjs";
import { loadWorld } from "../../../scripts/world/lib/world.mjs";
import { FIXTURES } from "./fixtures";

export type Row = Record<string, string>;
export const root = path.resolve(__dirname, "../../..");
export const poolDir = path.join(root, "scripts/world/fixtures/pool");
export const read = <T,>(file: string) => JSON.parse(fs.readFileSync(file, "utf8")) as T;
export const recorded = read<{ official: Row[]; seasonal: Row[]; qualifiers: Row[] }>(path.join(poolDir, "people.json"));
export const tournamentRows = read<Row[]>(path.join(root, "scripts/world/fixtures/pool-scope/tournaments.json"));
export const entryRows = read<Row[]>(path.join(poolDir, "entries.json"));
export const gameRows = read<Row[]>(path.join(poolDir, "games.json"));
export const probeRows = read<Row[]>(path.join(poolDir, "send0o-entries.json"));

/** A client that answers the pool's Cargo queries from the recorded rows, paging like the wiki does. */
export function stubClient(options: { failGames?: boolean; failProbe?: boolean } = {}) {
  const calls: Row[] = [];
  return {
    calls,
    async get(params: Row) {
      calls.push(params);
      let rows: Row[];
      if (params.tables === "Tournaments=T,Leagues=L") rows = tournamentRows;
      else if (params.tables === "TournamentPlayers=TP,Tournaments=T") rows = entryRows;
      else if (params.tables.includes("Players=P")) rows = params.where.includes("T.OverviewPage IN") ? recorded.qualifiers : params.where.includes('T.IsOfficial="1"') ? recorded.official : recorded.seasonal;
      else if (params.tables === "ScoreboardPlayers=SP") {
        if (options.failGames) throw new OfflineCacheMissError(params);
        rows = gameRows;
      } else {
        if (options.failProbe) throw new OfflineCacheMissError(params);
        rows = probeRows;
      }
      const offset = Number(params.offset);
      return { cargoquery: rows.slice(offset, offset + Number(params.limit)).map((title) => ({ title })) };
    },
  };
}

export const world = loadWorld(FIXTURES.dataDir);
export const overrides = read<unknown>(FIXTURES.idMap);
export const context = {
  playerIndex: buildIndex(world.players.map(playerEntity)),
  staffIndex: buildIndex(world.staff.map(staffEntity)),
  overrides,
  teamKeys: gameTeamKeys(loadTeamMap(FIXTURES.teamMap)),
};
export const baselines = computeBaselines(world);
export const row = (overrides: Row): Row => ({
  player: "Someone", ign: "Someone", name: "Some One", country: "France", nat: "", birth: "2001-01-01", res: "EMEA", prole: "Mid", team: "", rmin: "Mid", rmax: "Mid",
  last: "2026-01-01", n: "3", lmin: "Primary", tmin: "Primary", toff: "1", loff: "Yes", region: "EMEA", tours: "", ...overrides,
});
export const peopleOf = (rows: Row[]) => new Map(rows.map((r) => [r.player, personFromRow(r)] as [string, Person]));
export const select = (rows: Row[], extra: { rosterIds?: Set<string>; world?: typeof world } = {}) => selectPool({ people: peopleOf(rows), context, world: extra.world ?? world, rosterIds: extra.rosterIds });
export const overlayOf = (ops: { players: { op: object }[]; staff: { op: object }[] }) =>
  buildOverlay({ asOf: "2026-11-07", license: OFFLINE_LICENSE, coverage: [], players: ops.players, staff: ops.staff });

