import type { ReactNode } from "react";

import { cn } from "@/ui-v2/lib/utils";

export function InfoRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-border/40 py-2 last:border-0">
      <div className="text-muted-foreground/70">{icon}</div>
      <span className="flex-1 text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  );
}

export function StatBox({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number | string;
  highlight?: boolean;
}) {
  return (
    <div className={cn("rounded-lg p-2.5", highlight ? "bg-primary/10" : "bg-muted")}>
      <p
        className={cn(
          "font-heading text-lg font-bold tabular-nums",
          highlight ? "text-primary" : "text-foreground",
        )}
      >
        {value}
      </p>
      <p className="font-heading text-xs uppercase tracking-wider text-muted-foreground/70">
        {label}
      </p>
    </div>
  );
}
