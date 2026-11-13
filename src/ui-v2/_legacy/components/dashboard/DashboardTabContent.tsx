import { useGameStore } from "@/store/gameStore";
import EndOfSeasonScreen from "@/ui-v2/_legacy/components/EndOfSeasonScreen";
import type { DashboardTabContentModel } from "@/ui-v2/_legacy/components/dashboard/dashboardTabContentModel";

interface DashboardTabContentProps {
  viewModel: DashboardTabContentModel;
}

/**
 * The dashboard fall-through: DashboardV2 renders every tab natively, so the
 * only thing that reaches this component is Home while the season summary shows.
 */
export default function DashboardTabContent({
  viewModel,
}: DashboardTabContentProps) {
  const {
    activeTab,
    gameState,
    seasonComplete,
    handlers: { onGameUpdate },
  } = viewModel;
  const hasPendingSeasonSummary = useGameStore((s) => s.pendingSeasonSummary !== null);

  return (
    <div key={activeTab} className="animate-fade-in-up">
      {/* End-of-season screen when all fixtures are complete */}
      {(seasonComplete || hasPendingSeasonSummary) && activeTab === "Home" && (
        <EndOfSeasonScreen gameState={gameState} onGameUpdate={onGameUpdate} />
      )}
    </div>
  );
}
