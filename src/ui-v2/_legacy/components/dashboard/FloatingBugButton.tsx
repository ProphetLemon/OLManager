import { resolveUserLeague } from "@/lib/userLeague";
import { Bug } from "lucide-react";
import { useState, type JSX } from "react";
import { useTranslation } from "react-i18next";

import ReportBugModal from "@/ui-v2/_legacy/components/dashboard/ReportBugModal";
import { useGameStore } from "@/store/gameStore";
import { useBugReportStore } from "@/store/bugReportStore";
import { APP_VERSION } from "@/lib/common/appInfo";
import { getManagerTeamName } from "@/ui-v2/_legacy/components/dashboard/dashboardHelpers";

/** Icon button that opens the bug report. Hosted by the host screen's own controls row. */
export default function FloatingBugButton(): JSX.Element {
  const { t } = useTranslation();
  const gameState = useGameStore((s) => s.gameState);
  const { currentRoute, currentDashboardTab } = useBugReportStore();
  const [show, setShow] = useState(false);

  const label = t("onAir.nav.bug", { defaultValue: "Reportar Bug" });

  return (
    <>
      <button
        type="button"
        onClick={() => setShow(true)}
        className="inline-flex size-[var(--hit)] items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
        aria-label={label}
        title={label}
      >
        <Bug className="size-5" aria-hidden="true" />
      </button>

      {show && (
        <ReportBugModal
          context={
            gameState
              ? {
                  appVersion: APP_VERSION,
                  route: currentRoute,
                  activeTab: currentDashboardTab,
                  currentDate: gameState.clock.current_date,
                  dayPhase: gameState.day_phase ?? "Unknown",
                  teamName: getManagerTeamName(gameState) ?? "Unknown",
                  leagueName: resolveUserLeague(gameState)?.name ?? "Unknown",
                  lolPatch: gameState.champion_patch?.current_patch_label ?? "Unknown",
                  gameContext: "available",
                }
              : {
                  // No game yet (new-career setup): say so instead of inventing a context.
                  appVersion: APP_VERSION,
                  route: currentRoute,
                  activeTab: currentDashboardTab,
                  currentDate: "Unavailable",
                  dayPhase: "Unavailable",
                  teamName: "Unavailable",
                  leagueName: "Unavailable",
                  lolPatch: "Unavailable",
                  gameContext: "unavailable",
                }
          }
          saveJson={gameState ? JSON.stringify(gameState, null, 2) : null}
          onClose={() => setShow(false)}
        />
      )}
    </>
  );
}

