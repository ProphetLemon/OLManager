// What the refresh may do with staff. Assistants drive delegated renewals and fitness warnings in the game,
// so roles never change into or away from Assistant; Owners are never touched.

/** Data role strings (the shapes `data/staffs/*.json` uses). */
export const COACH_LIKE_ROLES = Object.freeze(["HeadCoach", "Analyst", "Performance Coach"]);
const PROTECTED_ROLES = new Set(["Owner", "Assistant"]);

/**
 * Map a Leaguepedia staff position label to a data role string, or null for non-sporting roles
 * (owners, executives, content, ...). "Assistant" is never produced: added staff use coach-like roles.
 */
export function dataRoleForLabel(label) {
  const text = String(label ?? "").toLowerCase().replace(/\(.*?\)/g, " ").replace(/\s+/g, " ").trim();
  if (/^(interim )?head coach\b/.test(text)) return "HeadCoach";
  if (/\bcoach\b/.test(text)) return "Performance Coach";
  if (/\banalyst\b/.test(text)) return "Analyst";
  if (/\bscout/.test(text)) return "Scout";
  return null;
}

/** Decide whether a matched staff member's role may change; returns the new role or null plus a reason when blocked. */
export function resolveRoleChange(gameRole, wantedRole) {
  if (!wantedRole || gameRole === wantedRole) return { role: null, blockedBy: null };
  // "Coach"/"Assistant Coach" labels are what the data calls Assistant: not a difference worth reporting.
  if (gameRole === "Assistant" && wantedRole === "Performance Coach") return { role: null, blockedBy: null };
  if (PROTECTED_ROLES.has(gameRole)) return { role: null, blockedBy: `game role ${gameRole} is protected` };
  if (COACH_LIKE_ROLES.includes(gameRole) && COACH_LIKE_ROLES.includes(wantedRole)) return { role: wantedRole, blockedBy: null };
  return { role: null, blockedBy: `${gameRole} -> ${wantedRole} is not a coach-like change` };
}
