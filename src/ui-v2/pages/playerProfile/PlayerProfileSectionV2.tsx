import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui-v2/components/ui/card";


export const SECTION_TITLE_CLASS =
  "font-heading text-sm uppercase tracking-widest text-muted-foreground";

interface PlayerProfileSectionV2Props {
  title: string;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

export function PlayerProfileSectionV2({
  title,
  children,
  className,
  contentClassName,
}: PlayerProfileSectionV2Props) {
  return (
    <Card className={className}>
      <CardHeader className="space-y-0">
        <CardTitle className={SECTION_TITLE_CLASS}>{title}</CardTitle>
      </CardHeader>
      <CardContent className={contentClassName}>{children}</CardContent>
    </Card>
  );
}

export function MeterBar({ value, label }: { value: number; label: string }) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div className="flex max-w-40 flex-1 items-center gap-1.5">
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="absolute inset-0 rounded-full"
          style={{ background: "linear-gradient(to right, #f59e0b, #22c55e)" }}
        />
        <div
          className="absolute inset-y-0 right-0 bg-muted transition-all duration-500"
          style={{ width: `${100 - clamped}%` }}
        />
      </div>
      <span className="font-heading text-xs font-bold tabular-nums">{value}%</span>
    </div>
  );
}
