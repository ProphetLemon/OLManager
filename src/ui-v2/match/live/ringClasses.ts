/**
 * The three rings of the arena, told apart by shape and not by hue: a double ring for a
 * champion in a fight, a dashed ring for a tower that is firing, the club colour for the
 * champion the viewer follows.
 */
export const RING_CLASSES = {
  fighting: "ring-fighting",
  fire: "ring-fire",
  selected: "ring-selected",
} as const;
