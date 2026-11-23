import type { ReactNode } from "react";
import { Check, Circle, Lock } from "lucide-react";

import { cn } from "@/ui-v2/lib/utils";

interface PhoneOptionProps {
  checked: boolean;
  /** Locked or saving: the option keeps its place and stays focusable (`aria-disabled`), but a press does nothing. */
  disabled: boolean;
  onSelect: () => void;
  /** Overrides the name read from the content. */
  label?: string;
  className?: string;
  children: ReactNode;
}

/**
 * A choice of the settings views (frames Objective and Volume): a real button, at least `--hit` high.
 * The chosen one has a club outline and a check; the others have no box, only a hollow ring where the
 * check goes, so a row reads as something to tap. State is never colour alone and never opacity.
 */
export function PhoneOption({ checked, disabled, onSelect, label, className, children }: PhoneOptionProps) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      aria-disabled={disabled || undefined}
      aria-label={label}
      onClick={() => {
        if (!disabled) onSelect();
      }}
      className={cn(
        "flex min-h-[var(--hit)] w-full min-w-0 items-center gap-3 rounded-xl border-[1.5px] px-3 text-start outline-hidden transition-colors",
        "focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-default",
        checked ? "border-club" : "border-transparent",
        className,
      )}
    >
      {children}
      {checked ? (
        <Check data-slot="choice-check" aria-hidden="true" className="size-5 shrink-0 text-club-text" />
      ) : (
        <Circle data-slot="choice-ring" aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
      )}
    </button>
  );
}

/** Why the view cannot be changed, in the top row beside the back control: the lock and the whole sentence (up to three lines). */
export function LockNote({ children }: { children: ReactNode }) {
  return (
    <p data-slot="phone-lock-line" className="m-0 flex min-w-0 flex-1 items-center gap-2 text-caption leading-4 text-muted-foreground">
      <Lock aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
