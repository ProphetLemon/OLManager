/**
 * "m:ss" for a count of seconds still to run, rounded up so a countdown never shows 0:00
 * while something is left. Negative or non-finite counts read as 0:00.
 */
export function formatCountdown(seconds: number): string {
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds)) : 0;
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * "m:ss" of the game clock, rounded down: the clock never runs ahead of the game, and a
 * negative or non-finite value reads as 0:00. Minutes are not capped, so a long game keeps counting.
 */
export function formatClock(seconds: number): string {
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
