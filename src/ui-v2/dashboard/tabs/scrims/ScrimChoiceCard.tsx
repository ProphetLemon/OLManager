import type { ReactNode } from "react";

import { cn } from "@/ui-v2/lib/utils";

interface ScrimChoiceCardProps {
  name: string;
  value: string;
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
  label: string;
  description?: string;
  children?: ReactNode;
  className?: string;
}

/**
 * A radio that looks like a card. The native input covers the card, so the whole card is the
 * target and the arrow keys move through the group. The chosen card shows a filled dot and a
 * club-coloured ring, so the choice is never told by colour alone.
 */
export function ScrimChoiceCard({
  name,
  value,
  checked,
  disabled = false,
  onSelect,
  label,
  description,
  children,
  className,
}: ScrimChoiceCardProps) {
  return (
    <label className={cn("relative block", className)}>
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="peer absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
      />
      <span
        className={cn(
          "flex h-full min-h-11 flex-col gap-1.5 rounded-[10px] border border-dim bg-muted px-4 py-3 transition-colors",
          "hover:border-foreground peer-checked:border-club peer-checked:bg-card peer-checked:ring-1 peer-checked:ring-club",
          "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring peer-disabled:opacity-65",
          "peer-checked:[&_[data-dot]]:border-club peer-checked:[&_[data-dot]]:bg-club peer-checked:[&_[data-dot]]:shadow-[inset_0_0_0_3px_var(--card)]",
        )}
      >
        <span className="flex items-center gap-2.5">
          <span aria-hidden="true" data-dot="" className="size-[1.125rem] shrink-0 rounded-full border-2 border-muted-foreground" />
          <span className="font-heading text-lg font-semibold uppercase leading-tight tracking-wide">{label}</span>
        </span>
        {description ? <span className="text-sm text-muted-foreground">{description}</span> : null}
        {children}
      </span>
    </label>
  );
}
