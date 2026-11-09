import { Calendar as CalendarIcon, ClipboardCheck, Clock, Dumbbell, Moon, Sunrise, Swords, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { TagBlock } from "@/ui-v2/components/ui/tag-block";
import { cn } from "@/ui-v2/lib/utils";

export interface ClockPlateProps {
  dateLabel: string;
  phase?: { key: string; label: string };
  className?: string;
}

// The phase is told apart by icon and text, never by colour.
const PHASE_ICONS: Record<string, LucideIcon> = {
  Morning: Sunrise,
  ScrimBlock: Swords,
  ReviewBlock: ClipboardCheck,
  TrainingBlock: Dumbbell,
  Evening: Moon,
};

/** Game date plus the current day phase, as one labelled group in the broadcast bar. */
export function ClockPlate({ dateLabel, phase, className }: ClockPlateProps) {
  const { t } = useTranslation();
  const PhaseIcon = phase ? (PHASE_ICONS[phase.key] ?? Clock) : null;

  return (
    <div
      role="group"
      aria-label={t("onAir.bar.clock", { defaultValue: "Game date and phase" })}
      data-slot="clock-plate"
      className={cn(
        "flex min-h-[var(--hit)] shrink-0 items-center gap-3 rounded-md border border-line bg-muted/40 px-3",
        className,
      )}
    >
      <span className="flex items-center gap-1.5">
        <CalendarIcon aria-hidden="true" className="size-4 text-club-text" />
        <span className="font-heading text-sm font-bold tabular-nums text-foreground">{dateLabel}</span>
      </span>
      {phase && PhaseIcon && (
        <TagBlock tone="neutral" size="sm" icon={<PhaseIcon />}>
          {phase.label}
        </TagBlock>
      )}
    </div>
  );
}
