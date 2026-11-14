/** i18n key of a player trait's short label; ids are the backend's `PlayerTrait` variant names. */
export function traitLabelKey(traitId: string): string {
  return `traits.${traitId}.label`;
}

/** i18n key of a player trait's one-line description. */
export function traitDescKey(traitId: string): string {
  return `traits.${traitId}.desc`;
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
