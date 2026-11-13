import type { MinionContext } from "./drawMinions";

export type RecordedCall = [name: string, ...args: unknown[]];

export interface RecordingContext {
  context: MinionContext & Pick<CanvasRenderingContext2D, "setTransform">;
  calls: RecordedCall[];
  /** The calls with the given name, in order. */
  named: (name: string) => RecordedCall[];
  clear: () => void;
}

/**
 * A 2D context that records what is drawn. A drawing call notes the fill colour in force when
 * it was made, so a test can tell which team's colour each shape used.
 */
export function createRecordingContext(): RecordingContext {
  const calls: RecordedCall[] = [];
  let fill = "";
  const context = {
    get fillStyle() {
      return fill;
    },
    set fillStyle(value: string | CanvasGradient | CanvasPattern) {
      fill = String(value);
    },
    clearRect: (...args: unknown[]) => void calls.push(["clearRect", ...args]),
    beginPath: () => void calls.push(["beginPath"]),
    arc: (...args: unknown[]) => void calls.push(["arc", fill, ...args]),
    fill: () => void calls.push(["fill", fill]),
    fillRect: (...args: unknown[]) => void calls.push(["fillRect", fill, ...args]),
    setTransform: (...args: unknown[]) => void calls.push(["setTransform", ...args]),
  } as unknown as RecordingContext["context"];
  return {
    context,
    calls,
    named: (name) => calls.filter((call) => call[0] === name),
    clear: () => {
      calls.length = 0;
    },
  };
}
