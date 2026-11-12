import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/ui-v2/lib/utils";

interface ScrimDisclosureProps {
  title: string;
  /** One line that stays visible while the section is closed. */
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

/** A panel whose body opens under its title. The title is a real button inside the heading. */
export function ScrimDisclosure({ title, summary, defaultOpen = false, children }: ScrimDisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  const uid = useId();
  const bodyId = `${uid}-body`;

  return (
    <section className="rounded-xl border border-line bg-card text-card-foreground" data-slot="scrim-disclosure">
      <h2 className="m-0 text-base">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          onClick={() => setOpen((value) => !value)}
          className="flex min-h-14 w-full items-center gap-3 rounded-xl px-4 py-2 text-start hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:px-5"
        >
          <span className="flex flex-1 flex-wrap items-baseline gap-x-4 gap-y-0.5">
            <span className="font-heading text-section font-bold uppercase leading-tight tracking-wide">{title}</span>
            {summary ? <span className="text-sm font-normal tabular-nums text-muted-foreground">{summary}</span> : null}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn("size-[1.125rem] shrink-0 transition-transform motion-reduce:transition-none", open && "rotate-180")}
          />
        </button>
      </h2>
      {open ? (
        <div id={bodyId} className="flex flex-col gap-4 px-4 pb-5 pt-1 sm:px-5">
          {children}
        </div>
      ) : null}
    </section>
  );
}
