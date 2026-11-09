import { useTranslation } from "react-i18next";
import type { GameStateData } from "@/store/gameStore";
import TacticsTab from "@/ui-v2/_legacy/components/tactics/TacticsTab";

interface MatchTacticsStageProps {
  gameState: GameStateData;
  onGameUpdate: (next: GameStateData) => void;
  onContinue: () => void;
  onSimulate: () => void;
  isSimulating: boolean;
  simulationFeedback: string | null;
}

export default function MatchTacticsStage({
  gameState,
  onGameUpdate,
  onContinue,
  onSimulate,
  isSimulating,
  simulationFeedback,
}: MatchTacticsStageProps) {
  const { t } = useTranslation();

  return (
    <div className="min-h-0 flex-1 overflow-y-auto scrollbar-v2 bg-background p-4 md:p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-4 rounded-xl border border-primary/20 bg-primary/5 p-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-heading uppercase tracking-widest text-club-text">
              {t("match.tactics")}
            </p>
            <p className="text-sm text-club-text/80">
              {t("match.tacticsBeforeLive")}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onSimulate}
              disabled={isSimulating}
              className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 disabled:bg-primary/50 disabled:cursor-not-allowed text-primary-foreground font-heading uppercase tracking-wider text-xs"
            >
              {isSimulating ? t("match.simulating") : t("match.simulate")}
            </button>

            <button
              onClick={onContinue}
              disabled={isSimulating}
              className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 disabled:bg-primary/50 disabled:cursor-not-allowed text-primary-foreground font-heading uppercase tracking-wider text-xs"
            >
              {t("match.startLive")}
            </button>
          </div>
        </div>

        {simulationFeedback ? (
          <p className="mb-4 text-xs text-club-text">
            {simulationFeedback}
          </p>
        ) : null}

        <TacticsTab
          gameState={gameState}
          onSelectPlayer={() => {}}
          onGameUpdate={onGameUpdate}
        />
      </div>
    </div>
  );
}
