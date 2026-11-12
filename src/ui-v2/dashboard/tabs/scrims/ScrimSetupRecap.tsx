import { useTranslation } from "react-i18next";
import { Lock } from "lucide-react";

import type { WeeklyScrimContext } from "@/lib/scrims/scrimContext";
import { SCRIM_FOCUS_IMPACT_KEYS, SCRIM_FOCUS_OBJECTIVE_KEYS } from "@/lib/scrims/scrimFocusKeys";
import type { GameStateData } from "@/store/gameStore";
import ScrimPlanningCardV2 from "../ScrimPlanningCardV2";
import { ScrimDisclosure } from "./ScrimDisclosure";

interface ScrimSetupRecapProps {
  gameState: GameStateData;
  weeklyContext: WeeklyScrimContext;
  /** Why the setup cannot change; the reason is told once, here. */
  blockedText: string | null;
  defaultOpen: boolean;
}

/** The week's setup as it stands once it is locked: read-only, under the day's panel. */
export function ScrimSetupRecap({ gameState, weeklyContext, blockedText, defaultOpen }: ScrimSetupRecapProps) {
  const { t } = useTranslation();
  const objective = weeklyContext.objective;
  const objectiveLabel = objective ? t(SCRIM_FOCUS_OBJECTIVE_KEYS[objective]) : t("training.scrims.objectives.none");
  const impact = objective ? t(SCRIM_FOCUS_IMPACT_KEYS[objective]) : t("scrims.noFocusImpactText");

  return (
    <ScrimDisclosure
      title={t("scrims.weeklySetup")}
      summary={t("scrims.recapSummary", { objective: objectiveLabel, count: weeklyContext.capacity })}
      defaultOpen={defaultOpen}
    >
      {blockedText ? (
        <p role="status" className="flex items-start gap-2.5 rounded-lg border border-line bg-muted px-3.5 py-3">
          <Lock aria-hidden="true" className="mt-0.5 size-[1.125rem] shrink-0" />
          <span>{blockedText}</span>
        </p>
      ) : null}
      <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(13.75rem,100%),1fr))] gap-3">
        <div className="flex flex-col gap-0.5">
          <dt className="text-caption text-muted-foreground">{t("training.scrims.weeklyObjective")}</dt>
          <dd className="font-medium">{objectiveLabel}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-caption text-muted-foreground">{t("scrims.impactLabel")}</dt>
          <dd className="text-sm font-medium">{impact}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-caption text-muted-foreground">{t("scrims.weeklyVolume")}</dt>
          <dd className="font-medium tabular-nums">{weeklyContext.capacity}</dd>
        </div>
      </dl>
      <ScrimPlanningCardV2
        gameState={gameState}
        weeklyContext={weeklyContext}
        isSaving={false}
        setIsSaving={() => undefined}
        readOnly
        variant="recap"
      />
    </ScrimDisclosure>
  );
}
