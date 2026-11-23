import type { WeeklyScrimContext } from "@/lib/scrims/scrimContext";
import type { ScrimFocus, TeamData } from "@/store/gameStore";

/**
 * How the weekly opponent plans are read, edited and autofilled. The desktop plan grid and the
 * phone panes both use it, so a plan is saved and dealt the same way on either.
 */

/** Plan A, B and C of every slot of the week, an empty entry as an empty string. */
export function planGrid(week: WeeklyScrimContext): string[][] {
  return Array.from({ length: week.capacity }, (_, slotIndex) => {
    const merged = week.slots[slotIndex]?.plan ?? [];
    return Array.from({ length: 3 }, (_, priorityIndex) => merged[priorityIndex] ?? "");
  });
}

/** The grid with one entry changed; an empty `teamId` clears it. */
export function withPlan(plans: string[][], slotIndex: number, priorityIndex: number, teamId: string): string[][] {
  const next = plans.map((plan) => [...plan]);
  next[slotIndex][priorityIndex] = teamId;
  return next;
}

/** The other clubs of the manager's competition that can be picked as a rival, strongest first. */
export function rivalTeams(teams: readonly TeamData[], myTeam: TeamData, ovrById: ReadonlyMap<string, number>): TeamData[] {
  return teams
    .filter((team) => team.id !== myTeam.id)
    .filter((team) => team.competition_id === myTeam.competition_id)
    .sort((a, b) => (ovrById.get(b.id) ?? 0) - (ovrById.get(a.id) ?? 0) || a.name.localeCompare(b.name));
}

/**
 * Autofill: deals the rivals (ids, strongest first) into every slot, three per slot and none twice
 * in one slot. Mental starts from the weakest; Champion pool and Early game move the strongest
 * third to the end. Null when there is nobody to deal.
 */
export function autofillPlans(idsByOvrDesc: readonly string[], objective: ScrimFocus | null, slots: number): string[][] | null {
  const byOvrAsc = [...idsByOvrDesc].reverse();
  const third = Math.floor(idsByOvrDesc.length / 3);
  const pool = objective === "Mental"
    ? byOvrAsc
    : objective === "ChampionPool" || objective === "EarlyGame"
      ? [...idsByOvrDesc.slice(third), ...idsByOvrDesc.slice(0, third)]
      : [...idsByOvrDesc];

  if (pool.length === 0) return null;

  return Array.from({ length: slots }, (_, slotIndex) => {
    const trio = [pool[slotIndex % pool.length], pool[(slotIndex + 1) % pool.length], pool[(slotIndex + 2) % pool.length]];
    return trio.filter((value, index, arr) => Boolean(value) && arr.indexOf(value) === index);
  });
}

/** Autofill needs every slot open (it rewrites them all) and nothing else in flight. */
export function autofillDisabled(week: WeeklyScrimContext, flags: { isSaving: boolean; readOnly: boolean }): boolean {
  return flags.isSaving || flags.readOnly || !week.slots.every((slot) => slot.canEdit);
}
