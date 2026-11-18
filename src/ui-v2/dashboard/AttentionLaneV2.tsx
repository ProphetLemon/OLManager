import { ChevronRight } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, type FocusEvent, type WheelEvent } from "react";
import { useTranslation } from "react-i18next";

import { useRovingFocus } from "@/hooks/useRovingFocus";
import type { LanePill } from "@/lib/dashboard/attentionLane";
import { callAction } from "@/lib/dashboard/callAction";
import { callActionLabel, callTagLabel } from "@/lib/dashboard/callLabels";
import type { NavIntent } from "@/lib/dashboard/profileNavigation";
import { TagBlock } from "@/ui-v2/components/ui/tag-block";
import { cn } from "@/ui-v2/lib/utils";
import { useFadeMask } from "@/ui-v2/shell/useFadeMask";

import { focusMainContent } from "./focusMainContent";

const LANE_TITLE_ID = "lane-title";

/**
 * A pill: the whole pill is the target. The ring is inset (R47) so a 48 px pill in
 * a 48 px band keeps all of it, and the transparent outline shows in forced colours,
 * where box-shadow rings are dropped.
 */
const PILL_CLASS =
  "flex h-[var(--lane-pill-h)] shrink-0 items-center gap-2 rounded-md border border-line bg-background px-2.5 text-start transition-colors hover:bg-[var(--row-wash)] focus-visible:outline-hidden focus-visible:-outline-offset-2 focus-visible:ring-[length:var(--focus-ring-width)] focus-visible:ring-inset focus-visible:ring-ring";

export interface AttentionLaneV2Props {
  /** The decisions, then the pinned "All N on Home" (`laneModel`). */
  pills: LanePill[];
  platform: "android" | "desktop";
  /** Runs a decision's intent: DashboardV2 moves there, says where, and focuses main. */
  onNavigate: (intent: NavIntent) => void;
  /** The pinned pill: the header chip's action, which focuses the Home panel (R47). */
  onShowAll: () => void;
}

/**
 * "Before you continue" (R24): the decisions as one row of pills under the bar,
 * off Home. A single Tab stop; Left, Right, Home and End move inside. It adds no
 * live region: a new call after an advance is spoken by the RouteAnnouncer (R42).
 */
export function AttentionLaneV2({ pills, platform, onNavigate, onShowAll }: AttentionLaneV2Props) {
  const { t } = useTranslation();
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  // The pill that last held focus, until focus moves somewhere else on purpose.
  const lastFocusedId = useRef<string | null>(null);
  const callPills = pills.filter((pill) => pill.kind === "call");
  const homeIndex = pills.findIndex((pill) => pill.kind === "home");
  const idsKey = pills.map((pill) => pill.id).join("|");
  const fade = useFadeMask<HTMLDivElement>(idsKey, { axis: "x" });

  const activate = (index: number) => {
    const pill = pills[index];
    if (!pill) return;
    if (pill.kind === "home") onShowAll();
    else onNavigate(callAction(pill.item));
  };

  const { activeIndex, shouldFocus, setActiveIndex, handleKeyDown, getTabIndex } = useRovingFocus({
    itemCount: pills.length,
    orientation: "horizontal",
    loop: false,
    // Appearing never takes focus; only a key pressed inside the toolbar moves it.
    focusOnMount: false,
    // Its Enter and Space branch prevents the native click, so activation goes here (R47).
    onSelect: activate,
  });
  const activeId = pills[activeIndex]?.id;

  // Follow the arrows, only while focus is inside: after Enter sent focus to main, a
  // pill that goes away must not pull it back.
  useEffect(() => {
    if (!shouldFocus || !activeId) return;
    if (!toolbarRef.current?.contains(document.activeElement)) return;
    const el = buttons.current.get(activeId);
    if (!el || el === document.activeElement) return;
    el.focus({ preventScroll: true });
    // Instant, and the scroller's scroll-padding keeps it clear of the fades.
    el.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [shouldFocus, activeId]);

  // When the pills change: keep the Tab stop on the pill that has focus, and when the
  // focused pill itself went (its call resolved) and the lane stays, focus the pill now
  // at its place, else the last one (R47).
  useLayoutEffect(() => {
    const focusedIndex = pills.findIndex((pill) => buttons.current.get(pill.id) === document.activeElement);
    if (focusedIndex >= 0) {
      if (focusedIndex !== activeIndex) setActiveIndex(focusedIndex);
      return;
    }
    const lost = lastFocusedId.current;
    if (!lost || pills.some((pill) => pill.id === lost)) return;
    // Focus that went somewhere on purpose stays there.
    if (document.activeElement && document.activeElement !== document.body) return;
    const next = pills[Math.min(Math.max(activeIndex, 0), pills.length - 1)];
    if (next) buttons.current.get(next.id)?.focus({ preventScroll: true });
    // Only the pill set matters here; the index is read as it stands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  // Going away with focus inside (the last call resolved) hands focus to main. The
  // cleanup runs before the pills leave the document, so `contains` still sees them.
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    return () => {
      if (toolbar?.contains(document.activeElement)) focusMainContent();
    };
  }, []);

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next && !event.currentTarget.contains(next)) lastFocusedId.current = null;
  };

  // A plain wheel scrolls the row: its scrollbar is hidden behind the fades.
  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    if (event.deltaX !== 0 || event.deltaY === 0 || el.scrollWidth <= el.clientWidth) return;
    el.scrollLeft += event.deltaY;
  };

  const pillProps = (index: number, id: string) => ({
    type: "button" as const,
    "data-slot": "lane-pill",
    "data-pill-id": id,
    tabIndex: getTabIndex(index),
    ref: (el: HTMLButtonElement | null) => {
      if (el) buttons.current.set(id, el);
      else buttons.current.delete(id);
    },
    onFocus: () => {
      lastFocusedId.current = id;
      if (index !== activeIndex) setActiveIndex(index);
    },
    onClick: () => activate(index),
  });

  const home = homeIndex >= 0 ? pills[homeIndex] : null;

  return (
    <section
      aria-labelledby={LANE_TITLE_ID}
      data-slot="attention-lane"
      className="flex h-[var(--lane-h)] shrink-0 items-center gap-3 border-b border-line bg-rail ps-4 pe-2 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150"
    >
      <h2
        id={LANE_TITLE_ID}
        className={cn(
          "shrink-0 font-heading text-nav font-bold uppercase tracking-wide text-muted-foreground",
          platform === "android" && "sr-only",
        )}
      >
        {t("onAir.lane.title", { defaultValue: "Before you continue" })}
      </h2>
      {/* No name of its own: the region already says "Before you continue" once (R47). */}
      <div
        ref={toolbarRef}
        role="toolbar"
        aria-orientation="horizontal"
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        className="flex h-full min-w-0 flex-1 items-center gap-2"
      >
        <div
          ref={fade.ref}
          onScroll={fade.onScroll}
          onWheel={handleWheel}
          style={fade.style}
          data-slot="lane-scroller"
          data-overflow-start={fade["data-overflow-start"]}
          data-overflow-end={fade["data-overflow-end"]}
          className="flex h-full min-w-0 flex-1 items-center gap-2 overflow-x-auto overscroll-x-contain scroll-px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {callPills.map((pill) => {
            const index = pills.indexOf(pill);
            const tag = callTagLabel(pill.item, t);
            const action = callActionLabel(pill.item, t);
            return (
              <button
                key={pill.id}
                {...pillProps(index, pill.id)}
                aria-label={`${tag}: ${pill.item.headline}. ${action}`}
                className={PILL_CLASS}
              >
                <TagBlock tone={pill.item.tagTone} size="sm" className="text-nav">
                  {tag}
                </TagBlock>
                <span data-slot="lane-headline" className="min-w-0 max-w-[22rem] truncate text-entry font-medium">
                  {pill.item.headline}
                </span>
                <span
                  data-slot="lane-action"
                  className="inline-flex shrink-0 items-center gap-0.5 text-entry font-semibold text-club-text"
                >
                  {action}
                  <ChevronRight aria-hidden="true" className="size-4" />
                </span>
              </button>
            );
          })}
        </div>
        {home && home.kind === "home" && (
          <button
            {...pillProps(homeIndex, home.id)}
            className={cn(PILL_CLASS, "text-entry font-semibold text-club-text")}
          >
            {t("onAir.lane.allOnHome", { count: home.count, defaultValue: "All {{count}} on Home" })}
          </button>
        )}
      </div>
    </section>
  );
}
