/** The palette's groups, in the order they are shown (R26). */
export type PaletteGroupId = "calls" | "recent" | "sections" | "views";

export const PALETTE_GROUP_ORDER: readonly PaletteGroupId[] = ["calls", "recent", "sections", "views"];

/** What search reads from a palette row. Every palette entry carries these fields. */
export interface PaletteSearchable {
  group: PaletteGroupId;
  /** Rail or recency order inside the group, the tie-break after the match rank. */
  order: number;
  /** The primary text. */
  label: string;
  /** The parent tab shown before a view's label ("Transfers" › "Offers"); searched with it. */
  labelPrefix?: string | null;
  /** The rail group ("Club", "World"), which tells "Staff · Club" from "Staffs · World". */
  zone: string | null;
  /** The English label, so "squad" finds "Effectif" in fr. */
  alias: string;
  /** A call row's headline. */
  headline?: string;
}

/** How a query matches: 0 exact, 1 prefix, 2 at the start of a word, 3 anywhere. */
export type MatchRank = 0 | 1 | 2 | 3;

/**
 * Folds text for matching, in this order (spec §5.3): lowercase in the
 * language, NFD, strip the combining marks, fold "ı" to "i" in every language,
 * and collapse whitespace. Lowercasing first makes tr "İsim" "isim"; the ı fold
 * lets "takimlar" find "Takımlar" on a keyboard without Turkish letters.
 */
export function normalize(s: string, lang: string): string {
  let lower: string;
  try {
    lower = s.toLocaleLowerCase(lang);
  } catch {
    // An invalid language tag throws; matching still works without the locale rules.
    lower = s.toLowerCase();
  }
  return lower.normalize("NFD").replace(/\p{M}/gu, "").replace(/ı/g, "i").replace(/\s+/g, " ").trim();
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

/** Whether `q` starts a word of `text`: at its start, or after a space or a sign such as "›". */
function startsAWord(text: string, q: string): boolean {
  for (let at = text.indexOf(q); at !== -1; at = text.indexOf(q, at + 1)) {
    if (at === 0 || !WORD_CHAR.test(text[at - 1])) return true;
  }
  return false;
}

function fieldRank(field: string, q: string): MatchRank | null {
  if (!field) return null;
  if (field === q) return 0;
  if (field.startsWith(q)) return 1;
  if (startsAWord(field, q)) return 2;
  if (field.includes(q)) return 3;
  return null;
}

function fieldsOf(entry: PaletteSearchable, lang: string): string[] {
  const label = entry.labelPrefix ? `${entry.labelPrefix} ${entry.label}` : entry.label;
  return [entry.label, label, entry.zone ?? "", entry.alias, entry.headline ?? ""].map((f) => normalize(f, lang));
}

function rankNormalized(fields: string[], q: string): MatchRank | null {
  let best: MatchRank | null = null;
  for (const field of fields) {
    const rank = fieldRank(field, q);
    if (rank !== null && (best === null || rank < best)) best = rank;
  }
  if (best !== null || !q.includes(" ")) return best;
  // "staff world": every word starts a word somewhere in the row, label and zone together.
  const haystack = fields.join(" ");
  return q.split(" ").every((word) => startsAWord(haystack, word)) ? 2 : null;
}

/** How well a query matches a row, or null when it does not. */
export function rankEntry(entry: PaletteSearchable, query: string, lang: string): MatchRank | null {
  const q = normalize(query, lang);
  return q ? rankNormalized(fieldsOf(entry, lang), q) : null;
}

const groupIndex = (group: PaletteGroupId) => PALETTE_GROUP_ORDER.indexOf(group);

/**
 * The palette's results. An empty query is browse mode: every row but the
 * Views, which appear only while typing (R26). With a query, the rows that
 * match stay grouped in the fixed group order, so PageUp and PageDown and the
 * listbox's groups follow it; inside a group they go by match rank (exact,
 * prefix, word start, substring), then rail order.
 */
export function searchPalette<T extends PaletteSearchable>(entries: readonly T[], query: string, lang: string): T[] {
  const q = normalize(query, lang);
  const byGroup = (a: T, b: T) => groupIndex(a.group) - groupIndex(b.group);
  if (!q) {
    return entries.filter((e) => e.group !== "views").sort((a, b) => byGroup(a, b) || a.order - b.order);
  }
  return entries
    .flatMap((entry) => {
      const rank = rankNormalized(fieldsOf(entry, lang), q);
      return rank === null ? [] : [{ entry, rank }];
    })
    .sort((a, b) => byGroup(a.entry, b.entry) || a.rank - b.rank || a.entry.order - b.entry.order)
    .map(({ entry }) => entry);
}

/** Results split by group, in group order; a group with no row is left out. */
export function groupPaletteResults<T extends PaletteSearchable>(
  results: readonly T[],
): { group: PaletteGroupId; entries: T[] }[] {
  return PALETTE_GROUP_ORDER.map((group) => ({ group, entries: results.filter((r) => r.group === group) })).filter(
    (g) => g.entries.length > 0,
  );
}
