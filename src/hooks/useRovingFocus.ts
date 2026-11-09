import { useCallback, useRef, useState } from "react";

interface RovingFocusOptions {
  itemCount: number;
  columns?: number;
  onSelect?: (index: number) => void;
  getItemLabel?: (index: number) => string;
  loop?: boolean;
  initialIndex?: number;
  onEdgeUp?: () => void;
  onEdgeDown?: () => void;
  /** Controlled active index: the internal state follows it whenever it changes. */
  index?: number;
  /**
   * When false, `shouldFocus` is true only right after the user navigated inside the
   * widget. A controlled `index` change from outside never moves focus. Defaults to true.
   */
  focusOnMount?: boolean;
  /** "horizontal" maps Left/Right only; "vertical" (default) keeps Up/Down by `columns`. */
  orientation?: "vertical" | "horizontal";
}

interface RovingFocusResult {
  /** Current item, or -1 when none is current (the first item is then the tab stop). */
  activeIndex: number;
  /** Callers gate their `.focus()` effect on this so the first render does not steal focus. */
  shouldFocus: boolean;
  setActiveIndex: (index: number) => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  getTabIndex: (index: number) => 0 | -1;
}

export function useRovingFocus({
  itemCount,
  columns = 1,
  onSelect,
  getItemLabel,
  loop = true,
  initialIndex = 0,
  onEdgeUp,
  onEdgeDown,
  index,
  focusOnMount = true,
  orientation = "vertical",
}: RovingFocusOptions): RovingFocusResult {
  const [rawIndex, setActiveIndexState] = useState(index ?? initialIndex);
  // True only while the latest index change came from the user inside the widget.
  const [interacted, setInteracted] = useState(false);
  // True once a controlled `index` change arrived from outside the widget.
  const [external, setExternal] = useState(false);
  const [syncedIndex, setSyncedIndex] = useState(index);
  if (index !== syncedIndex) {
    setSyncedIndex(index);
    if (index !== undefined) {
      setActiveIndexState(index);
      setInteracted(false);
      setExternal(true);
    }
  }
  // -1 means "no current item"; anything past the end is pulled back in range.
  const activeIndex = rawIndex < 0 || itemCount === 0 ? -1 : Math.min(rawIndex, itemCount - 1);
  const setActiveIndex = useCallback((next: number) => {
    setInteracted(true);
    setExternal(false);
    setActiveIndexState(next);
  }, []);
  const searchBuffer = useRef("");
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clamp = useCallback(
    (index: number) => {
      if (itemCount === 0) return 0;
      if (loop) {
        return ((index % itemCount) + itemCount) % itemCount;
      }
      return Math.max(0, Math.min(itemCount - 1, index));
    },
    [itemCount, loop],
  );

  const moveBy = useCallback(
    (delta: number) => {
      setInteracted(true);
      setExternal(false);
      setActiveIndexState((rawPrev) => {
        const prev = rawPrev < 0 ? -1 : Math.min(rawPrev, itemCount - 1);
        if (!loop && itemCount > 0) {
          if (prev + delta < 0) {
            onEdgeUp?.();
            return prev;
          }
          if (prev + delta >= itemCount) {
            onEdgeDown?.();
            return prev;
          }
        }
        return clamp(prev + delta);
      });
    },
    [clamp, loop, itemCount, onEdgeUp, onEdgeDown],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (itemCount === 0) return;

      switch (e.key) {
        case "ArrowDown":
          if (orientation === "horizontal") break;
          e.preventDefault();
          moveBy(columns);
          break;
        case "ArrowUp":
          if (orientation === "horizontal") break;
          e.preventDefault();
          moveBy(-columns);
          break;
        case "ArrowRight":
          e.preventDefault();
          moveBy(1);
          break;
        case "ArrowLeft":
          e.preventDefault();
          moveBy(-1);
          break;
        case "Home":
          e.preventDefault();
          setActiveIndex(0);
          break;
        case "End":
          e.preventDefault();
          setActiveIndex(itemCount - 1);
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          if (onSelect && activeIndex >= 0) onSelect(activeIndex);
          break;
        default:
          if (e.key.length === 1 && e.key.match(/[a-zA-Z0-9]/)) {
            e.preventDefault();
            searchBuffer.current += e.key.toLowerCase();
            if (searchTimeout.current) clearTimeout(searchTimeout.current);
            searchTimeout.current = setTimeout(() => {
              searchBuffer.current = "";
            }, 500);

            const query = searchBuffer.current;
            if (query.length === 1 && getItemLabel) {
              const start = (activeIndex + 1) % itemCount;
              for (let i = 0; i < itemCount; i++) {
                const idx = (start + i) % itemCount;
                const label = getItemLabel(idx).toLowerCase();
                if (label.startsWith(query)) {
                  setActiveIndex(idx);
                  break;
                }
              }
            }
          }
          break;
      }
    },
    [itemCount, columns, activeIndex, onSelect, moveBy, getItemLabel, setActiveIndex, orientation],
  );

  const getTabIndex = useCallback(
    (index: number): 0 | -1 => (index === (activeIndex < 0 ? 0 : activeIndex) ? 0 : -1),
    [activeIndex],
  );

  return {
    activeIndex,
    shouldFocus: interacted || (focusOnMount && !external),
    setActiveIndex,
    handleKeyDown,
    getTabIndex,
  };
}
