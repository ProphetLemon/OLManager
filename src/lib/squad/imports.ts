/**
 * Import rule helpers (mirror of `olm_core::residency`): a starting five may
 * hold at most two imports. The backend owns the rule and the `is_import`
 * flag; these helpers only drive the UI (badge, early refusal, auto-pick).
 */

export const MAX_IMPORTS_IN_STARTING_FIVE = 2;

/** Prefix of the backend refusal: `LINEUP_TOO_MANY_IMPORTS:<count>:<max>`. */
export const TOO_MANY_IMPORTS_ERROR_PREFIX = "LINEUP_TOO_MANY_IMPORTS";

export interface ImportFlagged {
  id: string;
  is_import?: boolean;
}

export function isImportPlayer(player: { is_import?: boolean }): boolean {
  return player.is_import === true;
}

export function countImports(players: ReadonlyArray<Partial<ImportFlagged>>): number {
  return players.filter(isImportPlayer).length;
}

/**
 * Whether replacing `outgoingId` with `incoming` leaves the starters with more
 * imports than allowed. A swap that adds no import is never refused, so a five
 * that is already over the limit can still be repaired.
 */
export function wouldExceedImportLimit(
  starters: ReadonlyArray<ImportFlagged>,
  outgoingId: string | null,
  incoming: { id?: string; is_import?: boolean },
): boolean {
  const outgoing = starters.find((starter) => starter.id === outgoingId);
  const before = countImports(starters);
  // An incoming player who already starts is only moved, so he is already counted.
  const alreadyStarting = "id" in incoming && starters.some((starter) => starter.id === incoming.id);
  const added = !alreadyStarting && isImportPlayer(incoming) ? 1 : 0;
  const after = before - (outgoing && isImportPlayer(outgoing) ? 1 : 0) + added;
  return after > MAX_IMPORTS_IN_STARTING_FIVE && after > before;
}

/** Reads the backend refusal out of a rejected invoke (string or Error). */
export function parseImportLimitError(error: unknown): { count: number; max: number } | null {
  const text = error instanceof Error ? error.message : String(error ?? "");
  const match = new RegExp(`${TOO_MANY_IMPORTS_ERROR_PREFIX}:(\\d+):(\\d+)`).exec(text);
  if (!match) return null;
  return { count: Number(match[1]), max: Number(match[2]) };
}

/**
 * Best five by `score` that holds at most two imports. Candidates are taken in
 * score order; an import beyond the limit is skipped for the next best player.
 */
export function pickBestFive<T extends ImportFlagged>(
  pool: ReadonlyArray<T>,
  score: (player: T) => number,
  size = 5,
): T[] {
  const ranked = [...pool].sort((a, b) => score(b) - score(a));
  const picked: T[] = [];
  let imports = 0;
  for (const candidate of ranked) {
    if (picked.length === size) break;
    if (isImportPlayer(candidate)) {
      if (imports >= MAX_IMPORTS_IN_STARTING_FIVE) continue;
      imports += 1;
    }
    picked.push(candidate);
  }
  return picked;
}

export interface PlannedSwap<T extends ImportFlagged> {
  off: string;
  on: T;
}

/**
 * Pairs the players leaving the lineup with the ones entering it and orders the
 * pairs so swaps that remove imports run first: applied one by one, the import
 * count never goes above the larger of the start and the target.
 */
export function orderSwapsImportsFirst<T extends ImportFlagged>(
  current: ReadonlyArray<ImportFlagged>,
  target: ReadonlyArray<T>,
): PlannedSwap<T>[] {
  const targetIds = new Set(target.map((player) => player.id));
  const currentIds = new Set(current.map((player) => player.id));
  const leaving = current.filter((player) => !targetIds.has(player.id));
  const entering = target.filter((player) => !currentIds.has(player.id));
  const delta = (leave: ImportFlagged, enter: ImportFlagged) =>
    (isImportPlayer(enter) ? 1 : 0) - (isImportPlayer(leave) ? 1 : 0);

  // Pair imports leaving with residents entering first, then neutral pairs,
  // then residents leaving with imports entering.
  const leavingSorted = [...leaving].sort((a, b) => Number(isImportPlayer(b)) - Number(isImportPlayer(a)));
  const enteringSorted = [...entering].sort((a, b) => Number(isImportPlayer(a)) - Number(isImportPlayer(b)));
  return leavingSorted
    .slice(0, enteringSorted.length)
    .map((leave, index) => ({ off: leave.id, on: enteringSorted[index], delta: delta(leave, enteringSorted[index]) }))
    .sort((a, b) => a.delta - b.delta)
    .map(({ off, on }) => ({ off, on }));
}
