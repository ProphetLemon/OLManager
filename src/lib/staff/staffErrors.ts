/** Reasons the backend gives for refusing a staff hire or release (`staff.errors.<reason>`). */
export const STAFF_ERROR_REASONS = new Set([
  "no_game",
  "no_team",
  "hiring_locked",
  "not_found",
  "already_employed",
  "insufficient_funds",
  "owner_not_hireable",
  "owner_not_fireable",
  "not_your_team",
  "transaction_failed",
]);

/**
 * i18n key for the message to show when a staff hire or release fails. The backend
 * rejects with `{"kind":"staff","reason":"..."}`; anything else (a crash, an old
 * backend) gets the generic message, never the raw text.
 */
export function staffErrorKey(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const { kind, reason } = parsed as { kind?: unknown; reason?: unknown };
      if (kind === "staff" && typeof reason === "string" && STAFF_ERROR_REASONS.has(reason)) {
        return `staff.errors.${reason}`;
      }
    }
  } catch {
    // Not JSON: fall through to the generic message.
  }
  return "staff.errors.generic";
}
