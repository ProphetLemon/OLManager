import { Fragment, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { callTagLabel } from "@/lib/dashboard/callLabels";
import { TagBlock } from "@/ui-v2/components/ui/tag-block";
import { cn } from "@/ui-v2/lib/utils";
import { ACTIVE_ROW_CLASS } from "@/ui-v2/shell/railActive";

import type { PaletteEntry } from "./paletteIndex";

interface Props {
  entry: PaletteEntry;
  id: string;
  active: boolean;
  onHighlight: () => void;
  onActivate: () => void;
}

/** A sign between two parts of a row, hidden from screen readers, which hear ", " instead (R48). */
function Sep({ sign }: { sign: "›" | "·" }) {
  return (
    <>
      <span aria-hidden="true" className="mx-1">
        {sign}
      </span>
      <span className="sr-only">, </span>
    </>
  );
}

/**
 * One option of the Go palette (spec §5.8): the primary text, prefixed by its tab
 * for a view, and the truncated secondary text, whose whole text stays in the
 * accessible name. A call row carries its tag, a tone and a word. The active row
 * wears the rail's active look (wash, bar, weight) and `aria-selected`; it never
 * takes DOM focus, which stays in the input (R25). No `title`: Orca reads it twice (R48).
 */
export function PaletteOption({ entry, id, active, onHighlight, onActivate }: Props) {
  const { t } = useTranslation();
  let primary: ReactNode = entry.label;
  if (entry.labelPrefix) {
    primary = (
      <>
        {entry.labelPrefix}
        <Sep sign="›" />
        {entry.label}
      </>
    );
  }
  return (
    <div
      role="option"
      id={id}
      aria-selected={active}
      data-active={active}
      data-slot="palette-option"
      // Keep DOM focus in the input: a press must not blur it before the click lands.
      onMouseDown={(e) => e.preventDefault()}
      onMouseMove={active ? undefined : onHighlight}
      onClick={onActivate}
      className={cn(
        "relative flex min-h-[var(--palette-row)] cursor-pointer items-center gap-3 px-4 py-1 text-foreground",
        "forced-colors:data-[active=true]:outline-2 forced-colors:data-[active=true]:-outline-offset-2 forced-colors:data-[active=true]:outline-solid forced-colors:data-[active=true]:outline-[Highlight]",
        active && ACTIVE_ROW_CLASS,
      )}
    >
      {active && (
        <span aria-hidden="true" data-slot="palette-option-bar" className="absolute inset-y-1 start-0 w-[3px] rounded-e-sm bg-club" />
      )}
      {entry.kind === "call" && (
        <TagBlock tone={entry.item.tagTone} size="sm" className="shrink-0 text-nav">
          {callTagLabel(entry.item, t)}
        </TagBlock>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn("truncate font-heading text-entry uppercase", active ? "font-semibold" : "font-medium")}>
          {primary}
        </span>
        {entry.secondary.length > 0 && (
          <span data-slot="palette-option-secondary" className="truncate text-nav text-muted-foreground">
            {entry.secondary.map((part, i) => (
              <Fragment key={i}>
                {part.sep && <Sep sign={part.sep} />}
                {part.text}
              </Fragment>
            ))}
          </span>
        )}
      </span>
    </div>
  );
}
