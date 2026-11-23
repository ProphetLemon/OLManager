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
    <p data-slot="phone-lock-line" className={cn("flex shrink-0 items-center gap-2 text-entry text-muted-foreground", className)}>
      <Lock aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 truncate">{children}</span>
    </p>
  );
}

interface PhoneChoiceProps {
  name: string;
  value: string;
  checked: boolean;
  /** Locked: the card keeps its place and stays focusable (`aria-disabled`), but a tap does nothing. */
  disabled: boolean;
  onSelect: () => void;
  children: ReactNode;
  /** `end` puts the check at the right and draws nothing when unchosen; `start` draws a ring that the check replaces. */
  mark: "start" | "end";
  className?: string;
}

/**
 * A radio that looks like a card, at least `--hit` high. The native input is the target, so the arrow
 * keys move through the group; the chosen card has a club outline and a check, never colour alone.
 */
export function PhoneChoice({ name, value, checked, disabled, onSelect, children, mark, className }: PhoneChoiceProps) {
  const check = <Check data-slot="choice-check" aria-hidden="true" className="size-5 shrink-0" />;
  return (
    <label className={cn("relative block min-w-0", className)}>
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        aria-disabled={disabled || undefined}
        onChange={() => {
          if (!disabled) onSelect();
        }}
        className="peer sr-only"
      />
      <span
        className={cn(
          "flex h-full min-h-[var(--hit)] items-center gap-2 rounded-lg border border-line bg-muted px-3 py-1 transition-colors",
          "peer-checked:bg-card peer-checked:outline-2 peer-checked:-outline-offset-2 peer-checked:outline-solid peer-checked:outline-club",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-aria-disabled:opacity-65",
        )}
      >
        {mark === "start" ? (checked ? check : <Circle aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />) : null}
        <span className="flex min-w-0 flex-1 flex-col justify-center">{children}</span>
        {mark === "end" && checked ? check : null}
      </span>
    </label>
  );
}
