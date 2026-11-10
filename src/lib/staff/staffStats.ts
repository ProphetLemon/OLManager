import type { StaffData } from "@/store/types";

/** i18n keys for the four staff attribute labels. */
export const ATTR_LABEL_KEYS = {
  coaching: "staff.lolAttrs.coaching",
  judgingAbility: "staff.lolAttrs.judgingAbility",
  judgingPotential: "staff.lolAttrs.judgingPotential",
  physiotherapy: "staff.lolAttrs.physiotherapy",
} as const;

export type StaffAttrKey = keyof typeof ATTR_LABEL_KEYS;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function qualityMult(value: number, min: number, max: number): number {
  return clamp(min + (clamp(value, 0, 100) / 100) * (max - min), min, max);
}

/** The staff member's single strongest attribute. */
export function bestAttr(s: StaffData): { key: string; value: number } {
  const attrs = [
    { key: "coaching", value: s.attributes.coaching },
    { key: "judgingAbility", value: s.attributes.judging_ability },
    { key: "judgingPotential", value: s.attributes.judging_potential },
    { key: "physiotherapy", value: s.attributes.physiotherapy },
  ];
  return attrs.reduce((a, b) => (b.value > a.value ? b : a));
}

/** Role-weighted overall rating (0-100). */
export function ovrRating(s: StaffData): number {
  const { coaching, judging_ability, judging_potential, physiotherapy } = s.attributes;
  const weights: Record<string, [number, number, number, number]> = {
    Coach: [0.7, 0.15, 0.1, 0.05],
    AssistantManager: [0.35, 0.25, 0.25, 0.15],
    Scout: [0.1, 0.45, 0.4, 0.05],
    Physio: [0.15, 0.05, 0.05, 0.75],
  };
  const [cw, aw, pw, phw] = weights[s.role] ?? [0.25, 0.25, 0.25, 0.25];
  return Math.round(coaching * cw + judging_ability * aw + judging_potential * pw + physiotherapy * phw);
}

/** Role-specific gameplay impact multipliers for display. */
export function getStaffImpactRows(s: StaffData): Array<{ labelKey: string; value: number }> {
  // A club owner is not on the coaching staff, so it has no gameplay impact.
  if (s.role === "Owner") return [];
  const coaching = qualityMult(s.attributes.coaching, 0.88, 1.22);
  const development = qualityMult(s.attributes.coaching, 0.92, 1.18);
  const tactics = qualityMult(s.attributes.coaching, 0.94, 1.14);
  const analysis = qualityMult(s.attributes.judging_ability, 0.94, 1.14);
  const potential = qualityMult(s.attributes.judging_potential, 0.98, 1.16);
  const recovery = qualityMult(s.attributes.physiotherapy, 1, 1.2);
  const morale = qualityMult(
    s.role === "Physio" ? s.attributes.physiotherapy : s.attributes.coaching,
    0.96, 1.12,
  );
  const metaDiscovery = clamp(analysis * 0.75 + potential * 0.25, 0.9, 1.2);
  const execution = clamp((tactics + analysis) / 2, 0.96, 1.1);

  if (s.role === "Coach")
    return [
      { labelKey: "staff.lolImpact.development", value: development },
      { labelKey: "staff.lolImpact.tactics", value: tactics },
      { labelKey: "staff.lolImpact.execution", value: execution },
    ];
  if (s.role === "AssistantManager")
    return [
      { labelKey: "staff.lolImpact.development", value: coaching },
      { labelKey: "staff.lolImpact.tactics", value: tactics },
      { labelKey: "staff.lolImpact.analysis", value: analysis },
    ];
  if (s.role === "Scout")
    return [
      { labelKey: "staff.lolImpact.analysis", value: analysis },
      { labelKey: "staff.lolImpact.draftAnalysis", value: execution },
      { labelKey: "staff.lolImpact.futureMeta", value: metaDiscovery },
    ];
  if (s.role === "Physio")
    return [
      { labelKey: "staff.lolImpact.recovery", value: recovery },
      { labelKey: "staff.lolImpact.tiltControl", value: morale },
    ];
  return [
    { labelKey: "staff.lolImpact.development", value: development },
    { labelKey: "staff.lolImpact.analysis", value: analysis },
    { labelKey: "staff.lolImpact.recovery", value: recovery },
  ];
}
