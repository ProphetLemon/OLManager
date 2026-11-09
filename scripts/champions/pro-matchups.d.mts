import type { ScoreboardRow } from "./lib/lane-matchups.mjs";

export function scoreboardParams(options: { since: string; until: string; offset: number; pageSize: number }): Record<string, string>;
export function rowsFromCargo(data: { cargoquery?: { title: Record<string, string> }[] }): ScoreboardRow[];
