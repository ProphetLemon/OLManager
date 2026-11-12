export const FILTERS: readonly ["strict", "recommended", "loose"];
export type FilterName = (typeof FILTERS)[number];
export const MIN_LEAGUE_TOURNAMENTS: number;
export const SEASON_DAYS: number;

export interface Tournament {
  page: string;
  name: string;
  league: string;
  region: string;
  level: string;
  official: boolean;
  qualifier: boolean;
  playoffs: boolean;
  split: string;
  year: string;
  start: string;
  end: string;
  leagueLevel: string;
  leagueOfficial: boolean;
}
export interface TournamentClass {
  strict: boolean;
  recommended: boolean;
  loose: boolean;
}
export interface Profile {
  ign?: string;
  name?: string;
  country?: string;
  nationality?: string;
  birthDate?: string;
  residency?: string;
  role?: string;
  team?: string;
  currentTeams?: string;
}
export interface Person {
  page: string;
  profile: Profile;
  roles: string[];
  kind: "player" | "staff";
  position: string | null;
  staffLabel: string | null;
  tier: number;
  region: string;
  bestLevel: string | null;
  lastStart: string;
  entries: number;
  /** Tournament pages of the person inside the queried filter (empty when the query did not ask for them). */
  tournaments: string[];
  /** The tournament list may have lost its tail to the server's GROUP_CONCAT length limit. */
  toursTruncated: boolean;
}
export type GameStatus =
  | { status: "in-game"; id: string }
  | { status: "on-game-team" }
  | { status: "uncertain"; reason?: string }
  | { status: "new" };
export interface PeopleSummary {
  people: number;
  players: number;
  staff: number;
  byPosition: Record<string, number>;
  byStaffLabel: Record<string, number>;
  byRegion: { player: Record<string, number>; staff: Record<string, number> };
  byTier: Record<string, number>;
}
export interface Share {
  count: number;
  total: number;
  pct: number;
}

export function normalizeTournament(row: Record<string, unknown>): Tournament;
export function tournamentDays(tournament: Tournament): number;
export function seasonalLeagues(tournaments: Tournament[]): Set<string>;
export function leagueCounts(tournaments: Tournament[]): Map<string, number>;
export function classifyTournaments(tournaments: Tournament[]): Map<string, TournamentClass>;
export const MAX_LIST_CHARS: number;
export type CargoClass = "official" | "seasonal" | "other";
export const CLASS_FILTERS: Readonly<Record<CargoClass, readonly FilterName[]>>;
export function cargoClasses(tournaments: Tournament[], since: string): Record<CargoClass, string[]>;
export const OPEN_QUALIFIER_ENTRIES: number;
export function chunkNames(names: string[]): string[][];
export function qualifierSplit(tournaments: Tournament[], classes: Map<string, TournamentClass>, entryCount: Map<string, number>, threshold?: number): { small: string[]; open: string[] };
export const NOT_QUALIFIER_CLAUSE: string;
export const LEVEL_ORDER: readonly string[];
export function bestLevel(...levels: unknown[]): string | null;
export const TOURS_SEPARATOR: string;
export const TOURS_MAX_CHARS: number;
export function parseTournaments(value: unknown): { tournaments: string[]; truncated: boolean };
export function pageClauses(pages: string[]): string[];
export function mergePerson(a: Person, b: Person): Person;
export function playerPosition(label: unknown): string | null;
export function isStaffLabel(label: unknown): boolean;
export function roleLabels(value: unknown): string[];
export function describePerson(
  roles: string[],
  profileRole?: string,
): { kind: "player" | "staff"; position: string | null; staffLabel: string | null };
export function tierFromAggregates(input: { leagueLevelMin?: string; tournamentLevelMin?: string; tournamentOfficial?: string; leagueOfficial?: string }): 1 | 2 | 3;
export function personFromRow(row: Record<string, unknown>): Person;
export function summarizePeople(people: Iterable<Person>, options?: { exclude?: (person: Person) => boolean }): PeopleSummary;
export function evenSample<T>(list: T[], count: number): T[];
export function share<T>(items: Iterable<T>, test: (item: T) => boolean): Share;
export function gameTeamKeys(teamMap: { teams?: Record<string, { title?: string | null }> } | null | undefined): Set<string>;
export function gameStatus(
  person: Pick<Person, "page" | "profile" | "kind">,
  context: { playerIndex: unknown; staffIndex: unknown; overrides?: unknown; teamKeys: Set<string> },
): GameStatus;
export function fieldCoverage(
  person: Pick<Person, "profile" | "kind" | "position" | "staffLabel">,
  games: number,
): { profilePage: boolean; birthDate: boolean; country: boolean; residency: boolean; role: boolean; anyGames: boolean; tenGames: boolean };
