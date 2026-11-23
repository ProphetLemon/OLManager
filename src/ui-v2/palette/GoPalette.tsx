import { Dialog } from "@base-ui/react/dialog";
import { Search, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";

import { usePaletteStore } from "@/store/paletteStore";
import { Button } from "@/ui-v2/components/ui/button";
import { cn } from "@/ui-v2/lib/utils";

import { PaletteOption } from "./PaletteOption";
import {
  forgetPaletteEntry,
  paletteEntryPop,
  pushPaletteEntry,
  releasePaletteEntry,
  whenPaletteEntryOff,
} from "./paletteHistory";
import type { PaletteEntry } from "./paletteIndex";
import { paletteKeyAction, type PaletteKey } from "./paletteKeys";
import { groupPaletteResults, searchPalette, type PaletteGroupId } from "./paletteSearch";

/** How long typing must pause before the results count is spoken (spec §5.4). */
export const PALETTE_STATUS_DELAY_MS = 300;

export interface GoPaletteProps {
  /** Every row the palette can show, from `buildPaletteIndex` (memoized by the caller). */
  entries: readonly PaletteEntry[];
  /** How many decisions wait, shown beside "Needs your call". */
  callCount: number;
  platform: "android" | "desktop";
  /**
   * Runs the activated row once the palette has fully closed (R37): by then the
   * background is no longer `aria-hidden`, so the caller's focus on main and its
   * announcement land.
   */
  onActivate: (entry: PaletteEntry) => void;
}

const keyOf = (e: KeyboardEvent): PaletteKey => ({
  key: e.key,
  isComposing: e.nativeEvent.isComposing,
  keyCode: e.keyCode,
});

/**
 * The Go palette (spec §5, R25-R29): a modal dialog named "Go to" holding an
 * editable combobox. DOM focus stays in the input while `aria-activedescendant`
 * names the active option, so typing, Backspace and IME composition keep working.
 *
 * It is hand-rolled on `paletteKeyAction` (R25's fallback) inside a Base UI
 * Dialog: Base UI 1.5.0's `Autocomplete` with `inline` lets Escape bubble to the
 * dialog, which closed the palette instead of clearing a query, and it renders no
 * `aria-expanded` (R44). The ARIA tree is the one spec §5.4 draws.
 */
export function GoPalette({ entries, callCount, platform, onActivate }: GoPaletteProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n?.language ?? "en";
  const open = usePaletteStore((s) => s.open);
  const closePalette = usePaletteStore((s) => s.closePalette);
  const android = platform === "android";

  const titleId = useId();
  const listId = useId();
  const emptyId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  // R37: an activated row closes the palette and runs only once the close completes.
  const closeReason = useRef<"activate" | "dismiss">("dismiss");
  const pending = useRef<PaletteEntry | null>(null);

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [typed, setTyped] = useState(false);
  const [status, setStatus] = useState("");
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  // The row activated by the last close; a fresh object per activation.
  const [activated, setActivated] = useState<{ entry: PaletteEntry } | null>(null);
  const ranActivation = useRef<{ entry: PaletteEntry } | null>(null);

  // The caller builds the index only while the palette is open; the rows stay while it closes.
  const [openEntries, setOpenEntries] = useState(entries);
  if (open && openEntries !== entries) setOpenEntries(entries);
  const shownEntries = open ? entries : openEntries;

  // Every opening starts in browse mode, on the first row, with nothing spoken.
  const [shownOpen, setShownOpen] = useState(open);
  if (shownOpen !== open) {
    setShownOpen(open);
    if (open) {
      setQuery("");
      setActive(0);
      setTyped(false);
      setStatus("");
    }
  }

  const results = useMemo(() => searchPalette(shownEntries, query, lang), [shownEntries, query, lang]);
  const groups = useMemo(() => {
    let start = 0;
    return groupPaletteResults(results).map((g) => {
      const block = { ...g, start };
      start += g.entries.length;
      return block;
    });
  }, [results]);
  const optionGroups = useMemo(() => results.map((e) => e.group), [results]);
  const activeIndex = results.length === 0 ? -1 : Math.min(active, results.length - 1);
  // R74: an option's id comes from its row, so a re-filter that puts another row first
  // changes `aria-activedescendant` too. The escape is one-to-one, so ids stay unique.
  const optionId = (entry: PaletteEntry) =>
    `${listId}-opt-${entry.id.replace(/[^A-Za-z0-9-]/g, (c) => `_${c.codePointAt(0)?.toString(16)}_`)}`;

  // R84: with no query (nothing indexed, as with no game) there is nothing to match against.
  const emptyText = query.trim()
    ? t("onAir.palette.empty", { query, defaultValue: "No matches for “{{query}}”" })
    : t("onAir.palette.nothing", { defaultValue: "Nothing to go to" });

  // One status region (R45): the count once typing pauses, or the empty text; nothing on open.
  useEffect(() => {
    if (!open || !typed) return;
    const timer = setTimeout(() => {
      setStatus(results.length === 0 ? emptyText : t("onAir.palette.results", { count: results.length, defaultValue: "{{count}} results" }));
    }, PALETTE_STATUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [open, typed, results.length, emptyText, t]);

  // Back (popstate, raised by the Android back gesture) closes the palette. It does not
  // consume the event: DashboardV2's handler asks paletteHistory whether this pop only took
  // the palette's entry off, and then runs no navigate (spec §5.5, R87).
  // R79, R87: wry 0.55.1 raises that popstate only when the webview can go back, so on
  // Android the palette pushes an entry of its own while open, and a close by any other
  // path takes it off. Desktop pushes nothing.
  useEffect(() => {
    if (!android) return;
    if (open) pushPaletteEntry();
    else releasePaletteEntry();
  }, [open, android]);
  useEffect(() => () => forgetPaletteEntry(), []);

  useEffect(() => {
    if (!open) return;
    const onPopState = (event: PopStateEvent) => {
      // The late pop of an entry a close already took off is not a Back for this opening.
      if (paletteEntryPop(event) === "release") return;
      closeReason.current = "dismiss";
      closePalette();
    };
    window.addEventListener("popstate", onPopState, true);
    return () => window.removeEventListener("popstate", onPopState, true);
  }, [open, closePalette]);

  // The Android sheet follows the visual viewport, so the soft keyboard never covers its rows (R29).
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!open || !android || !viewport) return;
    const update = () => setViewportHeight(viewport.height);
    update();
    viewport.addEventListener("resize", update);
    return () => viewport.removeEventListener("resize", update);
  }, [open, android]);

  const changeQuery = (value: string) => {
    setQuery(value);
    setActive(0);
    setTyped(true);
  };

  const activate = (entry: PaletteEntry) => {
    pending.current = entry;
    closeReason.current = "activate";
    closePalette();
  };

  // R78, R87: WebKit and Chromium send a mousemove after a scroll with the pointer where it
  // was. It carries no movement, so it is ignored, and so is a move to the last position
  // over the list; a pointer parked over the list never takes the highlight from the keys,
  // even before its first move. The open effect forgets the last position.
  const pointer = useRef({ x: -1, y: -1 });
  const pointerMove = (
    index: number,
    e: { clientX: number; clientY: number; movementX: number; movementY: number },
  ) => {
    if (e.movementX === 0 && e.movementY === 0) return;
    if (e.clientX === pointer.current.x && e.clientY === pointer.current.y) return;
    pointer.current = { x: e.clientX, y: e.clientY };
    if (index !== activeIndex) setActive(index);
  };

  const move = (index: number) => {
    setActive(index);
    document.getElementById(optionId(results[index]))?.scrollIntoView({ block: "nearest" });
  };

  const handleInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") return; // the popup owns Escape, wherever focus is
    const action = paletteKeyAction({ optionGroups, activeIndex, query }, keyOf(e));
    if (action.type === "move") {
      e.preventDefault();
      move(action.index);
    } else if (action.type === "activate") {
      e.preventDefault();
      activate(results[action.index]);
    }
  };

  // Escape clears a query and keeps the palette open, and closes it when empty. Base UI
  // closes on every Escape, from the popup's own handler and from a document listener,
  // so the palette keeps the key from both, IME compositions included (R48).
  const handlePopupKeyDown = (e: KeyboardEvent<HTMLDivElement> & { preventBaseUIHandler?: () => void }) => {
    if (e.key !== "Escape") return;
    e.preventBaseUIHandler?.();
    e.stopPropagation();
    const action = paletteKeyAction({ optionGroups, activeIndex, query }, keyOf(e));
    if (action.type === "clear") {
      e.preventDefault();
      changeQuery("");
    } else if (action.type === "close") {
      e.preventDefault();
      closeReason.current = "dismiss";
      closePalette();
    }
  };

  // The on-screen keyboard's action key (enterKeyHint="go"). Gboard reports it as a composing
  // keydown (keyCode 229) after predictive text, which the key model rightly ignores, but it
  // still submits the form. Only Android honours that submission: on desktop an Enter can
  // confirm an input-method composition (R48) and must not activate a row.
  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!android || activeIndex < 0) return;
    activate(results[activeIndex]);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) closePalette();
  };

  // R27/R37: Escape, Close and the back gesture return focus to the opener (else main);
  // an activation returns it nowhere, since the caller moves it after the close.
  const finalFocus = useCallback(() => {
    if (closeReason.current === "activate") return false;
    const { openerId } = usePaletteStore.getState();
    return (openerId ? document.getElementById(openerId) : null) ?? document.getElementById("main-content");
  }, []);

  // Base UI asks for the final focus after the close completes, so the reason is reset on
  // the next open. A row whose close a reopening interrupted is dropped there too.
  useEffect(() => {
    if (!open) return;
    closeReason.current = "dismiss";
    pending.current = null;
    pointer.current = { x: -1, y: -1 };
  }, [open]);

  const handleOpenChangeComplete = (isOpen: boolean) => {
    if (isOpen || closeReason.current !== "activate") return;
    const entry = pending.current;
    pending.current = null;
    if (entry) setActivated({ entry });
  };

  // R37: run the row from an effect, after the commit that unmounts the popup. Base UI
  // may report the close complete while the background is still `aria-hidden` (at once
  // when nothing animates), and focus or an announcement there would be lost.
  // On Android it also waits for the palette's history entry to come off (R87), so a route
  // the row pushes is not undone by that pop.
  useEffect(() => {
    if (!activated || ranActivation.current === activated) return;
    return whenPaletteEntryOff(() => {
      ranActivation.current = activated;
      onActivate(activated.entry);
    });
  }, [activated, onActivate]);

  const groupLabel = (group: PaletteGroupId) => {
    switch (group) {
      case "calls":
        return t("onAir.home.needsTitle", { defaultValue: "Needs your call" });
      case "recent":
        return t("onAir.palette.groups.recent", { defaultValue: "Recent" });
      case "sections":
        return t("onAir.palette.groups.sections", { defaultValue: "Sections" });
      case "views":
        return t("onAir.palette.groups.views", { defaultValue: "Views" });
    }
  };

  const hasResults = results.length > 0;
  const popupStyle =
    android && viewportHeight !== null
      ? ({ "--palette-vvh": `${viewportHeight}px` } as CSSProperties)
      : undefined;

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange} onOpenChangeComplete={handleOpenChangeComplete}>
      <Dialog.Portal>
        <Dialog.Backdrop data-slot="go-palette-backdrop" className="fixed inset-0 z-50 bg-background/70" />
        <Dialog.Popup
          aria-modal="true"
          aria-labelledby={titleId}
          initialFocus={android ? titleRef : inputRef}
          finalFocus={finalFocus}
          onKeyDown={handlePopupKeyDown}
          data-slot="go-palette"
          data-platform={platform}
          style={popupStyle}
          className={cn(
            "fixed z-50 flex flex-col overflow-hidden border-line bg-popover text-popover-foreground shadow-lg outline-none",
            android
              ? "inset-y-0 start-0 h-[var(--palette-vvh,100dvh)] w-[var(--palette-sheet-w)] max-w-full border-e pt-[var(--safe-top)] ps-[var(--safe-left)] pb-[var(--safe-bottom)]"
              : "start-1/2 top-[var(--palette-top)] max-h-[var(--palette-h)] w-[var(--palette-w)] -translate-x-1/2 rounded-lg border rtl:translate-x-1/2",
          )}
        >
          <Dialog.Title
            id={titleId}
            ref={titleRef}
            tabIndex={-1}
            className="px-4 pt-3 font-heading text-section font-bold uppercase leading-tight text-foreground outline-none"
          >
            {t("onAir.palette.title", { defaultValue: "Go to" })}
          </Dialog.Title>
          <form
            onSubmit={handleSubmit}
            className="flex min-h-[var(--palette-row)] items-center gap-2 border-b border-line ps-4 pe-1"
          >
            <Search aria-hidden="true" className="size-[var(--nav-icon)] shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-labelledby={titleId}
              aria-expanded={hasResults}
              aria-controls={hasResults ? listId : undefined}
              aria-autocomplete="list"
              // The empty text is the field's description, so a first open with nothing to go to says why (R99).
              aria-describedby={hasResults ? undefined : emptyId}
              aria-activedescendant={hasResults ? optionId(results[activeIndex]) : undefined}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              inputMode="search"
              enterKeyHint="go"
              placeholder={t("onAir.palette.placeholder", { defaultValue: "Search sections and places" })}
              value={query}
              onChange={(e) => changeQuery(e.target.value)}
              onKeyDown={handleInputKeyDown}
              // R77: outline-hidden, not outline-none, so forced colours still show a focus outline.
              className="min-h-[var(--hit)] min-w-0 flex-1 rounded-sm bg-transparent text-entry text-foreground outline-hidden placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Dialog.Close
              render={<Button type="button" variant="ghost" size="icon-touch" aria-label={t("onAir.palette.close", { defaultValue: "Close" })} />}
            >
              <X aria-hidden="true" className="size-[var(--nav-icon)]" />
            </Dialog.Close>
          </form>
          <div className="scrollbar-v2 min-h-0 flex-1 overflow-y-auto py-1">
            {hasResults ? (
              <div role="listbox" id={listId} aria-labelledby={titleId}>
                {groups.map(({ group, entries: rows, start }) => {
                  const labelId = `${listId}-group-${group}`;
                  return (
                    <div key={group} role="group" aria-labelledby={labelId}>
                      <div
                        id={labelId}
                        role="presentation"
                        className="px-4 pb-1 pt-2 font-heading text-nav font-semibold uppercase tracking-wide text-muted-foreground"
                      >
                        {groupLabel(group)}
                        {/* R81: the call rows the query keeps (every call while browsing), read
                            after a pause, "Needs your call, 3": the comma is for screen readers. */}
                        {group === "calls" && (
                          <>
                            <span className="sr-only">,</span>{" "}
                            <span className="tabular-nums">{query.trim() ? rows.length : callCount}</span>
                          </>
                        )}
                      </div>
                      {rows.map((entry, i) => {
                        const index = start + i;
                        return (
                          <PaletteOption
                            key={entry.id}
                            entry={entry}
                            id={optionId(entry)}
                            active={index === activeIndex}
                            onPointerMove={(e) => pointerMove(index, e)}
                            onActivate={() => activate(entry)}
                          />
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p id={emptyId} data-slot="go-palette-empty" className="px-4 py-6 text-entry text-muted-foreground">
                {emptyText}
              </p>
            )}
          </div>
          <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
            {status}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
