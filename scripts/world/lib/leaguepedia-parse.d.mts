export interface RosterEntry {
  ign: string;
  page: string;
  realName: string;
  country: string | null;
  kind: "starter" | "sub" | "trainee" | "inactive" | "unknown";
  position: string | null;
  roleLabel: string;
  contractEnd: string | null;
  joined: string | null;
}
export interface StaffEntry {
  ign: string;
  page: string | null;
  realName: string;
  country: string | null;
  roleLabel: string;
  inactive: boolean;
}
export const WIKI_BASE: string;
export function pageUrl(title: string): string;
export function findTeamSections(sections: Array<Record<string, unknown>>): { active: string | null; staff: string | null };
export function classifyRole(label: string): { kind: RosterEntry["kind"]; position: string | null; label: string };
export function parseActiveRoster(html: string): RosterEntry[];
export function parseStaffTable(html: string): StaffEntry[];
export function isDisambiguation(wikitext: string | null | undefined): boolean;
export function parseInfobox(wikitext: string | null | undefined): {
  id: string | null;
  name: string | null;
  country: string | null;
  isRetired: boolean;
  role: string | null;
  birthDate: string | null;
} | null;
export function parseIntro(html: string): { state: "currently" | "previously" | "retired" | null; teamText: string | null };
export function teamNameFromIntro(teamText: string | null): string | null;
