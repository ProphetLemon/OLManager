/**
 * Player trait ids as the backend serializes them (`PlayerTrait` in
 * `olm_core/src/domain/player.rs`) mapped to the key under the long-standing
 * `traits.*` i18n family, which is keyed by the trait's former names.
 */
const LEGACY_TRAIT_KEYS: Record<string, string> = {
  LightningQuick: "Speedster",
  Immovable: "Tank",
  NimbleFingers: "Agile",
  MarathonMan: "Tireless",
  GameManager: "Playmaker",
  Lethal: "Sharpshooter",
  KiteMaster: "Dribbler",
  Interceptor: "BallWinner",
  Sentinel: "Rock",
  ShotCaller: "Leader",
  IceCold: "CoolHead",
  Visionary: "Visionary",
  Intimidator: "HotHead",
  TeamPlayer: "TeamPlayer",
  HyperCarry: "CompleteForward",
  Workhorse: "Engine",
  MacroSpecialist: "SetPieceSpecialist",
};

export function traitLabelKey(traitId: string): string {
  return `traits.${LEGACY_TRAIT_KEYS[traitId] ?? traitId}.label`;
}

/** "fast_learner" / "FastLearner" -> "Fast learner". */
export function humanizeTraitId(traitId: string): string {
  const words = traitId
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export const KNOWN_TRAIT_IDS = Object.keys(LEGACY_TRAIT_KEYS);
