import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/ui-v2/components/ui/badge";
import { cn } from "@/ui-v2/lib/utils";
import { useRovingFocus } from "@/hooks/useRovingFocus";
import { RAIL_GROUPS, type RailGroupId } from "@/ui-v2/shell/navModel";
import type { ShellBadges } from "@/ui-v2/shell/shellTypes";

export interface SectionStripV2Props {
  group: RailGroupId;
  activeTab: string;
  onNavClick: (tab: string) => void;
  badges: ShellBadges;
  /** Display name of the group, used in the navigation landmark label. */
  label: string;
}

/**
 * Second-level navigation: the tabs of the active rail group. One roving tab stop,
 * Left/Right/Home/End to move, Enter/Space to open; scrolls sideways when it overflows.
 */
export function SectionStripV2({ group, activeTab, onNavClick, badges, label }: SectionStripV2Props) {
  const { t } = useTranslation();
  const items = RAIL_GROUPS.find((g) => g.id === group)?.items ?? [];
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const { activeIndex, shouldFocus, handleKeyDown, getTabIndex } = useRovingFocus({
    itemCount: items.length,
    orientation: "horizontal",
    loop: false,
    index: items.findIndex((i) => i.tab === activeTab),
    focusOnMount: false,
    onSelect: (i) => onNavClick(items[i].tab),
  });

  useEffect(() => {
    if (shouldFocus && activeIndex >= 0) refs.current[activeIndex]?.focus();
  }, [shouldFocus, activeIndex]);

  // Keep the current tab visible when the strip overflows (no focus change).
  useEffect(() => {
    const current = items.findIndex((i) => i.tab === activeTab);
    if (current >= 0) refs.current[current]?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [activeTab, items]);

  return (
    <nav
      aria-label={t("onAir.nav.strip", { group: label, defaultValue: "{{group}} sections" })}
      data-slot="section-strip"
      className="h-[2.875rem] shrink-0 border-b border-line bg-rail"
    >
      <div className="flex h-full items-stretch gap-1 overflow-x-auto px-4" onKeyDown={handleKeyDown}>
        {items.map((item, i) => {
          const active = item.tab === activeTab;
          const count = item.badge ? badges[item.badge] : 0;
          const Icon = item.icon;
          return (
            <button
              key={item.tab}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              tabIndex={getTabIndex(i)}
              aria-current={active ? "page" : undefined}
              onClick={() => onNavClick(item.tab)}
              onFocus={(e) => e.currentTarget.scrollIntoView?.({ block: "nearest", inline: "nearest" })}
              className={cn(
                "flex shrink-0 items-center gap-2 border-b-2 px-3 font-heading text-sm transition-colors",
                "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                active
                  ? "border-club font-bold text-foreground"
                  : "border-transparent font-medium text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon aria-hidden="true" className="size-4" />
              <span>{t(item.labelKey, { defaultValue: item.defaultLabel })}</span>
              {count > 0 && <Badge variant="secondary">{count}</Badge>}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
