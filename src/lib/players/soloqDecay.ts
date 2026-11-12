import type { SoloQDecayMode, SoloQDecayPreset } from "@/api/types";

/** Mode a new career starts on (decay-spec v0.2 section 3). Existing saves load as Off. */
export const SOLOQ_DECAY_NEW_CAREER_MODE: SoloQDecayMode = "Real";

/** The three intensities the Settings control offers; "Off" is the switch. */
export const SOLOQ_DECAY_INTENSITIES = ["Soft", "Real", "Harsh"] as const;
export type SoloQDecayIntensity = (typeof SOLOQ_DECAY_INTENSITIES)[number];

/**
 * Numbers shown when the engine cannot be asked (no save is loaded). The engine owns the real
 * table and returns it from `get_soloq_decay_settings`; this mirrors decay-spec v0.2 section 3.
 */
export const SOLOQ_DECAY_FALLBACK_PRESETS: SoloQDecayPreset[] = [
  { mode: "Off", decay_per_idle_day: 0, bank_days: 0, recovery_per_played_day: 0 },
  { mode: "Soft", decay_per_idle_day: 25, bank_days: 21, recovery_per_played_day: 50 },
  { mode: "Real", decay_per_idle_day: 50, bank_days: 14, recovery_per_played_day: 100 },
  { mode: "Harsh", decay_per_idle_day: 75, bank_days: 7, recovery_per_played_day: 150 },
];

export function isDecayIntensity(mode: SoloQDecayMode): mode is SoloQDecayIntensity {
  return mode !== "Off";
}

export function findPreset(
  presets: readonly SoloQDecayPreset[] | null | undefined,
  mode: SoloQDecayMode,
): SoloQDecayPreset | null {
  const source = presets && presets.length > 0 ? presets : SOLOQ_DECAY_FALLBACK_PRESETS;
  return source.find((preset) => preset.mode === mode) ?? null;
}

export const DECAY_PREVIEW_START_LP = 900;
export const DECAY_PREVIEW_DAYS = 30;

export interface DecayPreview {
  /** One LP value per day, day 0 to DECAY_PREVIEW_DAYS. */
  points: number[];
  /** Day on which the player reaches Master 0 LP, or null when he does not within the window. */
  floorDay: number | null;
  endLp: number;
  lost: number;
}

/**
 * What a player with no SoloQ at all would lose: the grace period holds, then each idle day costs
 * `decay_per_idle_day`, and LP never falls below Master 0 LP. With no preset (decay off) the line is flat.
 */
export function previewDecay(preset: SoloQDecayPreset | null): DecayPreview {
  const rate = preset?.decay_per_idle_day ?? 0;
  const bank = preset?.bank_days ?? 0;
  const points: number[] = [];
  for (let day = 0; day <= DECAY_PREVIEW_DAYS; day += 1) {
    const lost = rate > 0 ? Math.max(0, day - bank) * rate : 0;
    points.push(Math.max(0, DECAY_PREVIEW_START_LP - lost));
  }
  const endLp = points[points.length - 1];
  const floorDay = rate > 0 ? bank + Math.ceil(DECAY_PREVIEW_START_LP / rate) : null;
  return {
    points,
    floorDay: floorDay !== null && floorDay <= DECAY_PREVIEW_DAYS ? floorDay : null,
    endLp,
    lost: DECAY_PREVIEW_START_LP - endLp,
  };
}
