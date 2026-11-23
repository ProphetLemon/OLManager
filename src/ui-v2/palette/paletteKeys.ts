/** What the key model needs to know about the open palette. */
export interface PaletteKeyState {
  /** The group of each option, in display order. */
  optionGroups: readonly string[];
  /** The active option, or -1 when there is none. */
  activeIndex: number;
  /** The text in the input. */
  query: string;
}

/** The parts of a keydown the model reads. */
export interface PaletteKey {
  key: string;
  /** An IME composition is in progress: the key belongs to it (R48). */
  isComposing?: boolean;
  /** 229 also marks a key the IME is processing, where `isComposing` is not set. */
  keyCode?: number;
}

export type PaletteKeyAction =
  | { type: "move"; index: number }
  | { type: "activate"; index: number }
  | { type: "clear" }
  | { type: "close" }
  | { type: "none" };

const NONE: PaletteKeyAction = { type: "none" };
const IME_PROCESSING = 229;
/** How far PageUp and PageDown move within a result of a single group (R82). */
const PAGE_STEP = 8;

/** The index where the group holding `index` starts. */
function groupStart(groups: readonly string[], index: number): number {
  let start = index;
  while (start > 0 && groups[start - 1] === groups[index]) start -= 1;
  return start;
}

/** Every option belongs to one group. */
function singleGroup(groups: readonly string[]): boolean {
  return groups.every((group) => group === groups[0]);
}

/** A move to `target` clamped to the options, or nothing when it stays on `from`. */
function clampedMove(from: number, target: number, count: number): PaletteKeyAction {
  const index = Math.min(Math.max(target, 0), count - 1);
  return index === from ? NONE : { type: "move", index };
}

/**
 * The palette's keys (spec §5.5), for the combobox whose DOM focus stays in the
 * input. Up and Down move and wrap; PageUp and PageDown jump to the first option
 * of the previous or next group, or, when the result is a single group (as most
 * queries return), move 8 options and clamp at its ends (R82); Enter activates
 * the active option; Escape clears the query, then closes. Home, End, Tab and
 * typing stay with the input and the focus trap, and every key stays with an IME
 * composition (R48). It also drives the hand-rolled fallback (R25), and gamepad
 * bumpers map to PageUp and PageDown in phase 3.
 */
export function paletteKeyAction(state: PaletteKeyState, key: PaletteKey): PaletteKeyAction {
  if (key.isComposing || key.keyCode === IME_PROCESSING) return NONE;
  const { optionGroups: groups, activeIndex: active, query } = state;
  const count = groups.length;
  const hasActive = active >= 0 && active < count;

  switch (key.key) {
    case "ArrowDown":
      if (count === 0) return NONE;
      return { type: "move", index: hasActive ? (active + 1) % count : 0 };
    case "ArrowUp":
      if (count === 0) return NONE;
      return { type: "move", index: hasActive ? (active - 1 + count) % count : count - 1 };
    case "PageDown": {
      if (count === 0) return NONE;
      if (!hasActive) return { type: "move", index: 0 };
      if (singleGroup(groups)) return clampedMove(active, active + PAGE_STEP, count);
      const next = groups.findIndex((group, i) => i > active && group !== groups[active]);
      return next === -1 ? NONE : { type: "move", index: next };
    }
    case "PageUp": {
      if (!hasActive) return NONE;
      if (singleGroup(groups)) return clampedMove(active, active - PAGE_STEP, count);
      const start = groupStart(groups, active);
      return start === 0 ? NONE : { type: "move", index: groupStart(groups, start - 1) };
    }
    case "Enter":
      return hasActive ? { type: "activate", index: active } : NONE;
    case "Escape":
      return query.length > 0 ? { type: "clear" } : { type: "close" };
    default:
      return NONE;
  }
}
