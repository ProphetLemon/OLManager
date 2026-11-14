export function fold(value: unknown): string;
export function compactKey(value: unknown): string;
export function stripParenthetical(value: unknown): string;
export function nameTokens(value: unknown): { words: Set<string>; parts: Set<string> };
export function nameRelation(a: unknown, b: unknown): "equal" | "overlap" | "conflict" | "unknown";
export function countryToIso2(value: unknown): string;
export function pythonishDate(value: unknown): string | null;
