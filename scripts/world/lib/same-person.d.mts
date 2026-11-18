export interface PersonRecord { id?: string; match_name?: string; full_name?: string; nationality?: string; date_of_birth?: string | null; team_id?: string | null }
export function foldName(name: string): string;
export function nameWords(name: string): number;
export function foldedNames(record: PersonRecord): string[];
export function foldedRealNames(record: PersonRecord): string[];
export function nationalityKey(raw: string): string;
export function realBirthDate(raw: string | null | undefined): { days: number; iso: string } | null;
export function couldBeSamePerson(a: PersonRecord, b: PersonRecord, rule: "strict" | "loose"): boolean;
export function contractedPlayers(worldPlayers: PersonRecord[], ops: object[]): PersonRecord[];
export function foldedByWorldBuild(candidate: PersonRecord, contracted: PersonRecord[]): { rule: "K2-two-names" | "K2-name-and-birth-date" | "AI-loose"; with: string } | null;
