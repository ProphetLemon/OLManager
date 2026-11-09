import { useTranslation } from "react-i18next";
import { TagBlock } from "@/ui-v2/components/ui/tag-block";
import { cn } from "@/ui-v2/lib/utils";

export interface ClockPlateProps {
  dateLabel: string;
  phase?: { key: string; label: string };
  className?: string;
}

/**
 * Game date on a panel plate, joined to a slanted club-colour tag with the day phase.
 * The phase is always spelled out in text; the dot is decoration.
 */
export function ClockPlate({ dateLabel, phase, className }: ClockPlateProps) {
  const { t } = useTranslation();

  return (
    <div
      role="group"
      aria-label={t("onAir.bar.clock", { defaultValue: "Game date and phase" })}
      data-slot="clock-plate"
      className={cn("flex h-10 shrink-0 items-stretch", className)}
    >
      <span
        data-slot="clock-plate-date"
        className={cn(
          "flex items-center bg-muted py-0 pl-3.5 pr-[1.125rem] font-heading text-[1.25rem] font-bold tabular-nums tracking-[0.01em] text-foreground",
          phase ? "rounded-s-lg" : "rounded-lg",
        )}
      >
        {dateLabel}
      </span>
      {phase && (
        <TagBlock
          tone="club"
          size="lg"
          icon={<span className="size-2 rounded-full bg-club-foreground" />}
          className="-ml-2.5 min-h-0 gap-2 self-stretch pl-6 pr-[1.125rem] text-[1.25rem]"
        >
          {phase.label}
        </TagBlock>
      )}
    </div>
  );
}
