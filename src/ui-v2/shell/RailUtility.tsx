import type { LucideIcon } from "lucide-react";
import type { ReactNode, Ref } from "react";

import { IconTip } from "@/ui-v2/components/ui/icon-tip";
import { cn } from "@/ui-v2/lib/utils";

import { RAIL_CLUSTER_COLUMNS } from "./railMode";

/**
 * Classes of one icon-only utility cell: `--nav-cell` high, full width of its grid column.
 * Shared with the bug button so the four cells look and size alike.
 */
export function railCellClass(tone: "default" | "danger" = "default"): string {
  return cn(
    "relative flex h-[var(--nav-cell)] w-full items-center justify-center rounded-[0.625rem] transition-colors",
    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring",
    tone === "danger"
      ? "text-negative hover:bg-negative/10"
      : "text-muted-foreground hover:bg-accent hover:text-foreground",
  );
}

/** The pinned utility cluster: its cells share one grid row under the scrolling rows. */
export function RailCluster({ children }: { children: ReactNode }) {
  return (
    <div
      data-slot="rail-cluster"
      style={{ gridTemplateColumns: `repeat(${RAIL_CLUSTER_COLUMNS}, minmax(0, 1fr))` }}
      className="grid shrink-0 gap-0 border-t border-line px-1.5 py-1"
    >
      {children}
    </div>
  );
}

interface RailCellProps {
  navId: string;
  /** The accessible name; also the IconTip text unless `tip` says otherwise. */
  label: string;
  tip?: string;
  /** An icon, or custom content (the manager avatar). */
  icon?: LucideIcon;
  children?: ReactNode;
  tone?: "default" | "danger";
  current?: boolean;
  tabIndex?: 0 | -1;
  buttonRef?: Ref<HTMLButtonElement>;
  onClick: () => void;
}

/** One icon-only cell: `aria-label` for assistive tech, an IconTip for hover and keyboard focus. */
export function RailCell({
  navId,
  label,
  tip,
  icon: Icon,
  children,
  tone = "default",
  current = false,
  tabIndex,
  buttonRef,
  onClick,
}: RailCellProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      tabIndex={tabIndex}
      onClick={onClick}
      aria-label={label}
      aria-current={current ? "page" : undefined}
      data-slot="rail-cell"
      data-nav-id={navId}
      className={railCellClass(tone)}
    >
      <IconTip label={tip ?? label} followFocus className="inline-flex">
        {Icon ? <Icon className="size-[var(--nav-icon)] shrink-0" aria-hidden="true" /> : children}
      </IconTip>
    </button>
  );
}
