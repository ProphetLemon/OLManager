import type { ReactNode } from "react";
import { Check, Circle, Lock } from "lucide-react";

import { cn } from "@/ui-v2/lib/utils";

/** The heading every pane starts with. It can take focus (never by Tab) so the parent can move focus here. */
export function PaneHeading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2
      id={id}
      tabIndex={-1}
      data-pane-heading=""
      className="shrink-0 font-heading text-section font-bold uppercase leading-none tracking-wide outline-hidden"
    >
      {children}
    </h2>
  );
}

/** Why the pane cannot be edited: one line, ellipsis when it does not fit, the full sentence stays in the text. */
export function LockLine({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p data-slot="phone-lock-line" className={cn("flex h-[1.125rem] shrink-0 items-center gap-2 text-entry leading-none text-muted-foreground", className)}>
      <Lock aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 truncate">{children}</span>
    </p>
  );
}

interface PhoneChoiceProps {
  checked: boolean;
  /** Locked: the card keeps its place and stays focusable (`aria-disabled`), but a press does nothing. */
  disabled: boolean;
  onSelect: () => void;
  children: ReactNode;
  /** `end` puts the check at the right and draws nothing when unchosen; `start` draws a ring that the check replaces. */
  /** Where the check goes; left out when the caller draws it inside its own content. */
  mark?: "start" | "end";
  className?: string;
}

/**
 * A choice that looks like a card, at least `--hit` high: a button with `aria-pressed` inside a labelled
 * group. Unlike a radio, an arrow key never chooses it (a choice saves at once); Enter or Space does.
 * The chosen card has a club outline and a check, never colour alone.
 */
export function PhoneChoice({ checked, disabled, onSelect, children, mark, className }: PhoneChoiceProps) {
  const check = <Check data-slot="choice-check" aria-hidden="true" className="size-5 shrink-0" />;
  return (
    <button
      type="button"
      aria-pressed={checked}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (!disabled) onSelect();
      }}
      className={cn(
        "flex h-full min-h-[var(--hit)] w-full min-w-0 items-center gap-2 rounded-lg border border-line bg-muted px-3 py-1 text-start outline-hidden transition-colors",
        "focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-default aria-disabled:opacity-65",
        checked && "bg-card outline-2 -outline-offset-2 outline-solid outline-club",
        className,
      )}
    >
      {mark === "start" ? (checked ? check : <Circle aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />) : null}
      <span className="flex min-w-0 flex-1 flex-col justify-center">{children}</span>
      {mark === "end" && checked ? check : null}
    </button>
  );
}
