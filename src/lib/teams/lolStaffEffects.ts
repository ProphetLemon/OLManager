import type { GameStateData, StaffData } from "../../store/gameStore";

export interface LolStaffEffectsData {
  coaching: number;
  development: number;
  tactics: number;
  analysis: number;
  recovery: number;
  morale: number;
  metaDiscovery: number;
  execution: number;
}

const DEFAULT_LOL_STAFF_EFFECTS: LolStaffEffectsData = {
  coaching: 0.85,
  development: 0.9,
  tactics: 0.95,
  analysis: 0.95,
  recovery: 1,
  morale: 1,
  metaDiscovery: 0.9,
  execution: 0.98,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function qualityMult(avgValue: number | null, empty: number, min: number, max: number): number {
  if (avgValue == null) return empty;
  return clamp(min + (clamp(avgValue, 0, 100) / 100) * (max - min), min, max);
}

function hasSpecialist(staff: StaffData[], specialization: string): boolean {
  return staff.some((member) => member.specialization === specialization);
}

export function getLolStaffEffectsForTeam(gameState: GameStateData | null | undefined, teamId: string | null | undefined): LolStaffEffectsData {
  if (!gameState || !teamId) return DEFAULT_LOL_STAFF_EFFECTS;

  const teamStaff = gameState.staff.filter((member) => member.team_id === teamId && member.role !== "Owner");
  if (teamStaff.length === 0) return DEFAULT_LOL_STAFF_EFFECTS;

  const coaches = teamStaff.filter((member) => member.role === "Coach" || member.role === "AssistantManager");
  const scouts = teamStaff.filter((member) => member.role === "Scout");
  const physios = teamStaff.filter((member) => member.role === "Physio");

  const coachingAvg = average(coaches.map((member) => member.attributes.coaching));
  const abilityAvg = average(scouts.map((member) => member.attributes.judging_ability));
  const potentialAvg = average(scouts.map((member) => member.attributes.judging_potential));
  const physioAvg = average(physios.map((member) => member.attributes.physiotherapy));

  let coaching = qualityMult(coachingAvg, 0.85, 0.88, 1.22);
  let development = qualityMult(coachingAvg, 0.9, 0.92, 1.18);
  let tactics = qualityMult(coachingAvg, 0.95, 0.94, 1.14);
  const analysis = qualityMult(abilityAvg, 0.95, 0.94, 1.14);
  let recovery = qualityMult(physioAvg, 1, 1, 1.2);
  const morale = qualityMult(coachingAvg, 1, 0.96, 1.12);
  const metaDiscovery = clamp(
    qualityMult(abilityAvg, 0.9, 0.92, 1.18) * 0.75 + qualityMult(potentialAvg, 1, 0.98, 1.16) * 0.25,
    0.9,
    1.2,
  );
  let execution = clamp((tactics + analysis) / 2, 0.96, 1.08);

  if (hasSpecialist(coaches, "Technique")) development *= 1.04;
  if (hasSpecialist(coaches, "Tactics")) {
    tactics *= 1.05;
    execution *= 1.02;
  }
  if (hasSpecialist(coaches, "Youth")) development *= 1.03;
  if (hasSpecialist(coaches, "Fitness")) recovery *= 1.03;

  return {
    coaching: clamp(coaching, 0.85, 1.25),
    development: clamp(development, 0.88, 1.22),
    tactics: clamp(tactics, 0.9, 1.18),
    analysis: clamp(analysis, 0.9, 1.16),
    recovery: clamp(recovery, 0.95, 1.25),
    morale: clamp(morale, 0.95, 1.15),
    metaDiscovery,
    execution: clamp(execution, 0.96, 1.1),
  };
}

export function formatStaffEffectPercent(value: number): string {
  const delta = Math.round((value - 1) * 100);
  return delta >= 0 ? `+${delta}%` : `${delta}%`;
}

