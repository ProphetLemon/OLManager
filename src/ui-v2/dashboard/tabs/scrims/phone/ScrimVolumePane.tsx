import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Check, Lock, WandSparkles } from "lucide-react";

import { scrimSlotWeekdays } from "@/lib/scrims/scrimContext";
import { cn } from "@/ui-v2/lib/utils";
import { LockLine, PaneHeading, PhoneChoice } from "./PhonePanePieces";

export interface ScrimVolumePaneProps {
  capacity: number;
  /** Mon..Sun, already translated. */
  weekdayLabels: readonly string[];
  /** The setup is locked or a save is running: choices and Finalize keep their place and cannot be used. */
  disabled: boolean;
  /** Computed by the parent with `autofillDisabled`, the rule the desktop Autofill follows. */
  autofillDisabled: boolean;
  /** Why the setup is locked; null while it can be edited. Not shown while the assistant is on (its block says it). */
  blockedText: string | null;
  assistant: boolean;
  onVolume: (slots: number) => void;
  onAutofill: () => void;
  onAssistant: (next: boolean) => void;
  onFinalize: () => void;
}

const VOLUMES = [2, 4, 6];

const BUTTON = "flex h-[var(--hit)] w-full items-center gap-2 rounded-lg border px-3 py-1 text-start transition-colors outline-hidden focus-visible:ring-2 focus-visible:ring-ring aria-disabled:opacity-65 aria-disabled:cursor-default";

/** Moment 1: the three volumes, Autofill, the assistant toggle and Finalize setup, in that order. */
export function ScrimVolumePane({
  capacity,
  weekdayLabels,
  disabled,
  autofillDisabled,
  blockedText,
  assistant,
  onVolume,
  onAutofill,
  onAssistant,
  onFinalize,
}: ScrimVolumePaneProps) {
  const { t } = useTranslation();
  const headingId = useId();

  return (
    <div
      data-slot="scrim-volume-pane"
      // 22 + 48 + 48 + 48 + 56 and four gaps of 8 = 254 in the 266 the pane has; a lock line of 18 takes 4 px gaps instead.
      className={cn("flex h-full min-h-0 flex-col overflow-y-auto p-2", blockedText && !assistant ? "gap-1" : "gap-2")}
    >
      <PaneHeading id={headingId}>{t("scrims.weeklyVolume")}</PaneHeading>
      {blockedText && !assistant ? <LockLine>{blockedText}</LockLine> : null}

      <div role="group" aria-labelledby={headingId} className="grid shrink-0 grid-cols-3 gap-2">
        {VOLUMES.map((slots) => {
          const days = [...new Set(scrimSlotWeekdays(slots))].map((day) => weekdayLabels[day]).join(", ");
          return (
            <PhoneChoice key={slots} checked={capacity === slots} disabled={disabled} onSelect={() => onVolume(slots)}>
              {/* The check shares the number's line: beside both lines it left no room for three weekdays. */}
              <span className="flex items-center justify-between gap-1">
                <span className="font-heading text-section font-bold leading-none">{slots}</span>
                {capacity === slots ? <Check data-slot="choice-check" aria-hidden="true" className="size-5 shrink-0" /> : null}
              </span>
              <span className="truncate text-entry leading-tight text-muted-foreground">{days}</span>
            </PhoneChoice>
          );
        })}
      </div>

      {assistant ? null : (
        <button
          type="button"
          aria-disabled={autofillDisabled || undefined}
          onClick={() => {
            if (!autofillDisabled) onAutofill();
          }}
          className={cn(BUTTON, "justify-start border-border bg-background hover:bg-muted")}
        >
          <WandSparkles aria-hidden="true" className="size-5 shrink-0" />
          <span className="font-heading text-section font-bold uppercase leading-none tracking-wide">{t("training.scrims.autofill")}</span>
        </button>
      )}

      <button
        type="button"
        aria-pressed={assistant}
        onClick={() => onAssistant(!assistant)}
        className={cn(BUTTON, "justify-between border-border bg-background hover:bg-muted", assistant && "outline-2 -outline-offset-2 outline-solid outline-club")}
      >
        <span className="flex min-w-0 flex-col">
          <span className="font-heading text-section font-bold uppercase leading-none tracking-wide">{t("scrims.assistantLabel")}</span>
          <span className="truncate text-entry leading-tight text-muted-foreground">
            {t("scrims.delegation")}: {assistant ? t("scrims.autoMode") : t("scrims.manualControl")}
          </span>
        </span>
        <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-sm border-2 border-muted-foreground">
          {assistant ? <Check data-slot="toggle-check" className="size-4" /> : null}
        </span>
      </button>

      {assistant ? (
        <div data-slot="scrim-assistant-block" className="flex flex-col gap-1 rounded-lg border border-line bg-muted px-3 py-2 text-entry">
          <p className="flex items-center gap-2 font-semibold">
            <Lock aria-hidden="true" className="size-4 shrink-0" />
            {t("scrims.assistantHandling")}
          </p>
          <p className="text-muted-foreground">{t("scrims.assistantModeHint")}</p>
        </div>
      ) : (
        <button
          type="button"
          aria-disabled={disabled || undefined}
          onClick={() => {
            if (!disabled) onFinalize();
          }}
          className={cn(BUTTON, "h-15 shrink-0 border-border bg-background hover:bg-muted")}
        >
          <Lock aria-hidden="true" className="size-5 shrink-0" />
          <span className="flex min-w-0 flex-col">
            <span className="font-heading text-section font-bold uppercase leading-none tracking-wide">{t("scrims.finalizeSetup")}</span>
            {/* Two lines: the second sentence says when the week reopens, and a cut one hid it. */}
            <span className="line-clamp-2 text-caption leading-tight text-muted-foreground">{t("scrims.finalizeHint")}</span>
          </span>
        </button>
      )}
    </div>
  );
}
