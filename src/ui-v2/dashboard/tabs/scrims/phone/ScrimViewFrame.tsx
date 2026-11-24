import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft } from "lucide-react";

import { cn } from "@/ui-v2/lib/utils";

export interface ScrimViewFrameProps {
  /** The view's name: the heading of the frame and the name of the back control. */
  title: string;
  onBack: () => void;
  /** Controls that follow the back control right away (the pick view's plans and Not planned). */
  lead?: ReactNode;
  /** Controls that belong to this view, at the right end of the top row. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * The frame every view of the Scrims tab shares on a phone: a top row of `--hit` with the back
 * control (a real button holding the chevron and the title), room for the view's own actions, then
 * the body (the view draws its own surfaces). The title is the view's heading and the target of the focus the layout moves.
 */
export function ScrimViewFrame({ title, onBack, lead, actions, children, className }: ScrimViewFrameProps) {
  const { t } = useTranslation();
  return (
    <div data-slot="scrim-view-frame" className={cn("flex h-full min-h-0 flex-col px-2 pt-1", className)}>
      <div data-slot="scrim-view-top" className="flex h-[var(--hit)] shrink-0 items-center gap-2">
        <h2 tabIndex={-1} data-pane-heading="" className="m-0 min-w-0 outline-hidden">
          <button
            type="button"
            data-slot="scrim-view-back"
            aria-label={`${t("common.back")}: ${title}`}
            onClick={onBack}
            className="flex h-[var(--hit)] max-w-full min-w-[var(--hit)] items-center gap-1 rounded-lg pe-3 text-start font-heading text-section font-bold uppercase leading-none tracking-wide outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronLeft aria-hidden="true" className="size-6 shrink-0" />
            <span className="truncate">{title}</span>
          </button>
        </h2>
        {lead}
        <span aria-hidden="true" className="min-w-0 flex-1" />
        {actions ? (
          <div data-slot="scrim-view-actions" className="flex shrink-0 items-center gap-2">
            {actions}
          </div>
        ) : null}
      </div>
      <div
        data-slot="scrim-view-body"
        className="scrollbar-v2 min-h-0 flex-1 overflow-y-auto"
      >
        {children}
      </div>
    </div>
  );
}
