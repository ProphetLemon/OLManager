import { useTranslation } from "react-i18next";
import { Lock } from "lucide-react";

import { scrimSlotWeekdays, type WeeklyScrimContext } from "@/lib/scrims/scrimContext";
import { SCRIM_FOCUS_IMPACT_KEYS, SCRIM_FOCUS_OBJECTIVE_KEYS } from "@/lib/scrims/scrimFocusKeys";
import type { GameStateData, ScrimFocus } from "@/store/gameStore";
import { Button } from "@/ui-v2/components/ui/button";
import ScrimPlanningCardV2 from "../ScrimPlanningCardV2";
import { ScrimChoiceCard } from "./ScrimChoiceCard";

const SCRIM_OBJECTIVES: ScrimFocus[] = ["DraftPrep", "ChampionPool", "EarlyGame", "Teamfighting", "Macro", "Mental"];
const SCRIM_SLOT_OPTIONS = [2, 4, 6];

interface ScrimSetupPanelProps {
  gameState: GameStateData;
  weeklyContext: WeeklyScrimContext;
  onGameUpdate: (state: GameStateData) => void;
  isSaving: boolean;
  setIsSaving: (value: boolean) => void;
  /** The form is shown but cannot change: the week is locked or the assistant handles it. */
  readOnly: boolean;
  /** Why the form is read-only; null while it can be edited. */
  blockedText: string | null;
  weekdayLabels: readonly string[];
  onObjective: (next: ScrimFocus | null) => void;
  onVolume: (slots: number) => void;
  onFinalize: () => void;
}

/** Setup body of the wide column: objective, volume, opponent plans and the button that locks the week. */
export function ScrimSetupPanel({
  gameState,
  weeklyContext,
  onGameUpdate,
  isSaving,
  setIsSaving,
  readOnly,
  blockedText,
  weekdayLabels,
  onObjective,
  onVolume,
  onFinalize,
}: ScrimSetupPanelProps) {
  const { t } = useTranslation();
  const disabled = isSaving || readOnly;
  const objective = weeklyContext.objective;

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-5">
      {blockedText ? (
        <p role="status" className="flex items-start gap-2.5 rounded-lg border border-line bg-muted px-3.5 py-3">
          <Lock aria-hidden="true" className="mt-0.5 size-[1.125rem] shrink-0" />
          <span>{blockedText}</span>
        </p>
      ) : null}

      <fieldset className="min-w-0">
        <legend className="font-heading text-lg font-semibold uppercase leading-tight tracking-wide">
          {t("training.scrims.weeklyObjective")}
        </legend>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("training.scrims.weeklyObjectiveDescription")}</p>
        <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(15.5rem,100%),1fr))] gap-2.5">
          <ScrimChoiceCard
            name="scrim-objective"
            value=""
            checked={objective === null}
            disabled={disabled}
            onSelect={() => onObjective(null)}
            label={t("training.scrims.objectives.none")}
            description={t("scrims.noFocusImpactText")}
          />
          {SCRIM_OBJECTIVES.map((focus) => (
            <ScrimChoiceCard
              key={focus}
              name="scrim-objective"
              value={focus}
              checked={objective === focus}
              disabled={disabled}
              onSelect={() => onObjective(focus)}
              label={t(SCRIM_FOCUS_OBJECTIVE_KEYS[focus])}
              description={t(SCRIM_FOCUS_IMPACT_KEYS[focus])}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="min-w-0">
        <legend className="font-heading text-lg font-semibold uppercase leading-tight tracking-wide">
          {t("scrims.weeklyVolume")}
        </legend>
        <div className="mt-3 flex flex-wrap gap-2.5">
          {SCRIM_SLOT_OPTIONS.map((slots) => {
            const days = [...new Set(scrimSlotWeekdays(slots))].map((day) => weekdayLabels[day]).join(", ");
            return (
              <ScrimChoiceCard
                key={slots}
                className="max-w-56 min-w-36 flex-1"
                name="scrim-volume"
                value={String(slots)}
                checked={weeklyContext.capacity === slots}
                disabled={disabled}
                onSelect={() => onVolume(slots)}
                label={String(slots)}
                description={days}
              />
            );
          })}
        </div>
      </fieldset>

      <ScrimPlanningCardV2
        gameState={gameState}
        weeklyContext={weeklyContext}
        onGameUpdate={onGameUpdate}
        isSaving={isSaving}
        setIsSaving={setIsSaving}
        readOnly={readOnly}
      />

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-line pt-4">
        <div className="flex max-w-prose flex-col gap-1">
          <p className="text-sm text-muted-foreground">{t("scrims.finalizeHint")}</p>
          {blockedText ? null : <p className="text-sm text-muted-foreground">{t("scrims.setupUnlockWindow")}</p>}
        </div>
        <Button type="button" variant="club" size="touch" disabled={disabled} onClick={onFinalize}>
          {t("scrims.finalizeSetup")}
        </Button>
      </div>
    </div>
  );
}
