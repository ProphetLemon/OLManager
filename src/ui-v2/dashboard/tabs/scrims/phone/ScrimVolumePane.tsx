import { useTranslation } from "react-i18next";
import { Check, Lock, WandSparkles } from "lucide-react";

import { scrimSlotWeekdays } from "@/lib/scrims/scrimContext";
import { cn } from "@/ui-v2/lib/utils";
import { PhoneOption } from "./PhoneOption";
import { ScrimViewFrame } from "./ScrimViewFrame";

export interface ScrimVolumePaneProps {
  /** The view's name: the frame's heading and the name of its back control. */
  title: string;
  onBack: () => void;
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
/** Three days of two blocks: the pips of a volume fill from the first block. */
const PIP_DAYS = [0, 1, 2];

const BUTTON =
  "flex h-[var(--hit)] shrink-0 items-center justify-center gap-2 rounded-lg border-[1.5px] bg-transparent px-4 font-heading text-section font-bold outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-default aria-disabled:border-line aria-disabled:text-muted-foreground";

/** The lock as its icon and the word, in the top row, as Decidir shows it; the whole sentence is at the bottom. */
function LockWord() {
  const { t } = useTranslation();
  return (
    <span data-slot="volume-lock" className="flex min-w-0 items-center gap-1.5 text-entry text-muted-foreground">
      <Lock aria-hidden="true" className="size-[1.125rem] shrink-0" />
      {t("scrims.slotStatus.locked")}
    </span>
  );
}

/** The days of a volume as six places in three pairs; the filled ones are the blocks the volume plays. Hidden: the words say it. */
function Pips({ slots, chosen }: { slots: number; chosen: boolean }) {
  return (
    <span data-slot="volume-pips" aria-hidden="true" className="flex gap-2.5">
      {PIP_DAYS.map((day) => (
        <span key={day} className="flex gap-1">
          {[0, 1].map((block) => {
            const filled = day * 2 + block < slots;
            return (
              <span
                key={block}
                data-slot="volume-pip"
                data-filled={filled}
                className={cn("size-2.5 rounded-full border-[1.5px]", filled ? (chosen ? "border-club bg-club" : "border-foreground bg-foreground") : "border-muted-foreground")}
              />
            );
          })}
        </span>
      ))}
    </span>
  );
}

/**
 * Volumen (frame Volume): the three volumes as cards, then Rellenar and the Asistente switch, then the
 * sentence of Confirmar with the button at the right end of the last row (outlined: it locks the week).
 * Heights: 4 + 48 (the frame's top row) + 8 + 94 + 12 + 48 + 12 + 48 = 274 of 286, so 12 stay free;
 * a Confirmar sentence of three lines takes 51 instead of 48.
 */
export function ScrimVolumePane({
  title,
  onBack,
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

  return (
    <ScrimViewFrame title={title} onBack={onBack} lead={blockedText && !assistant ? <LockWord /> : undefined}>
      <div data-slot="scrim-volume-pane" className="flex h-full min-h-0 flex-col pt-2">
        <div role="group" aria-label={t("scrims.weeklyVolume")} className="grid shrink-0 grid-cols-3 gap-2">
          {VOLUMES.map((slots) => {
            const days = [...new Set(scrimSlotWeekdays(slots))].map((day) => weekdayLabels[day]).join(", ");
            const chosen = capacity === slots;
            return (
              <PhoneOption
                key={slots}
                checked={chosen}
                disabled={disabled}
                label={`${title} ${slots}: ${days}`}
                onSelect={() => onVolume(slots)}
                className="h-[5.875rem] px-4"
              >
                <span className="flex min-w-0 flex-1 items-center gap-3">
                  <span className={cn("font-heading text-ovr font-bold tabular-nums", chosen && "text-club-text")}>{slots}</span>
                  <span className="flex min-w-0 flex-col gap-2">
                    <Pips slots={slots} chosen={chosen} />
                    <span className="text-caption leading-tight text-muted-foreground">{days}</span>
                  </span>
                </span>
              </PhoneOption>
            );
          })}
        </div>

        <div data-slot="volume-row" className="mt-3 flex shrink-0 items-center gap-8">
          {assistant ? null : (
            <button
              type="button"
              aria-disabled={autofillDisabled || undefined}
              onClick={() => {
                if (!autofillDisabled) onAutofill();
              }}
              className={cn(BUTTON, "min-w-[10rem] border-muted-foreground")}
            >
              <WandSparkles aria-hidden="true" className="size-5 shrink-0" />
              {t("training.scrims.autofill")}
            </button>
          )}
          <button
            type="button"
            role="switch"
            aria-checked={assistant}
            onClick={() => onAssistant(!assistant)}
            className="flex h-[var(--hit)] shrink-0 items-center gap-3.5 rounded-lg pe-1 text-start outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex flex-col leading-tight">
              <span className="font-heading text-section font-bold">{t("scrims.assistantLabel")}</span>
              <span className="text-caption text-muted-foreground">
                {t("scrims.delegation")}: {assistant ? t("scrims.autoMode") : t("scrims.manualControl")}
              </span>
            </span>
            <span
              aria-hidden="true"
              className={cn("flex h-7 w-12 shrink-0 items-center rounded-full border-2 p-0.5", assistant ? "justify-end border-club" : "justify-start border-muted-foreground")}
            >
              <span className={cn("flex size-5 items-center justify-center rounded-full", assistant ? "bg-club text-club-foreground" : "bg-muted-foreground")}>
                {assistant ? <Check data-slot="toggle-check" className="size-3.5" /> : null}
              </span>
            </span>
          </button>
        </div>

        {assistant ? (
          <div data-slot="scrim-assistant-block" className="mt-3 flex shrink-0 flex-col gap-1 text-entry">
            <p className="m-0 flex items-center gap-2 font-semibold">
              <Lock aria-hidden="true" className="size-4 shrink-0" />
              {t("scrims.assistantHandling")}
            </p>
            <p className="m-0 text-muted-foreground">{t("scrims.assistantModeHint")}</p>
          </div>
        ) : (
          <div data-slot="volume-row" className="mt-3 flex shrink-0 items-center gap-4">
            {blockedText ? (
              <p data-slot="volume-lock-sentence" className="m-0 min-w-0 flex-1 text-caption leading-[1.0625rem] text-muted-foreground">{blockedText}</p>
            ) : (
              <p className="m-0 min-w-0 flex-1 text-caption leading-[1.0625rem] text-muted-foreground">{t("scrims.finalizeHint")}</p>
            )}
            <button
              type="button"
              aria-disabled={disabled || undefined}
              onClick={() => {
                if (!disabled) onFinalize();
              }}
              className={cn(BUTTON, "min-w-[16.75rem] border-foreground")}
            >
              <Lock aria-hidden="true" className="size-5 shrink-0" />
              {t("scrims.finalizeSetup")}
            </button>
          </div>
        )}
      </div>
    </ScrimViewFrame>
  );
}
