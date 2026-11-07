export const COACH_LIKE_ROLES: readonly string[];
export function dataRoleForLabel(label: string): string | null;
export function resolveRoleChange(gameRole: string, wantedRole: string | null): { role: string | null; blockedBy: string | null };
