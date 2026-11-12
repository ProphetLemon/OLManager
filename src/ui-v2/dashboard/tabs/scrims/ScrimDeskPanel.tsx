import { forwardRef, type ReactNode } from "react";

import { TagBlock } from "@/ui-v2/components/ui/tag-block";
import { cn } from "@/ui-v2/lib/utils";

interface ScrimDeskPanelProps {
  id: string;
  title: string;
  /** The state of the day, shown at the end of the plate. */
  badge?: string;
  children: ReactNode;
  className?: string;
}

/**
 * The wide column of the Scrims tab: a club-coloured title plate and a body. One shell serves the
 * setup, today and decision bodies, so the heading element survives a change of body and keeps the
 * focus the tab moves to it after a decision.
 */
export const ScrimDeskPanel = forwardRef<HTMLHeadingElement, ScrimDeskPanelProps>(function ScrimDeskPanel(
  { id, title, badge, children, className },
  ref,
) {
  return (
    <section
      aria-labelledby={id}
      data-slot="scrim-desk-panel"
      className={cn("rounded-xl border border-line bg-card text-card-foreground", className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line pe-4 has-[h2:focus-visible]:outline-2 has-[h2:focus-visible]:-outline-offset-2 has-[h2:focus-visible]:outline-ring">
        <h2
          id={id}
          ref={ref}
          tabIndex={-1}
          data-slot="scrim-desk-heading"
          className="rounded-ss-xl bg-club py-2.5 ps-5 pe-9 font-heading text-section font-bold uppercase leading-tight tracking-wide text-club-foreground outline-none [clip-path:polygon(0_0,100%_0,calc(100%-1rem)_100%,0_100%)]"
        >
          {title}
        </h2>
        {badge ? <TagBlock tone="neutral">{badge}</TagBlock> : null}
      </div>
      {children}
    </section>
  );
});
