import { Bug } from "lucide-react";
import { useState, type JSX } from "react";
import { useTranslation } from "react-i18next";

import ReportBugModal from "@/ui-v2/_legacy/components/dashboard/ReportBugModal";
import { useGameStore } from "@/store/gameStore";
import { useBugReportStore } from "@/store/bugReportStore";
import { APP_VERSION } from "@/lib/common/appInfo";
import { getManagerTeamName } from "@/ui-v2/_legacy/components/dashboard/dashboardHelpers";

interface FloatingBugButtonProps {
  placement?: "floating" | "rail";
}

export default function FloatingBugButton({
  placement = "floating",
}: FloatingBugButtonProps = {}): JSX.Element | null {
  const { t } = useTranslation();
  const gameState = useGameStore((s) => s.gameState);
  const { currentRoute, currentDashboardTab } = useBugReportStore();
  const [show, setShow] = useState(false);

  if (!gameState) return null;

  const label = t("onAir.nav.bug", { defaultValue: "Reportar Bug" });

  return (
    <>
      {!show && placement === "rail" && (
        <button
          type="button"
          onClick={() => setShow(true)}
          className="inline-flex size-[var(--hit)] items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
          aria-label={label}
          title={label}
        >
          <Bug className="size-5" aria-hidden="true" />
        </button>
      )}

      {!show && placement === "floating" && (
        <button
          onClick={() => setShow(true)}
          className="fixed bottom-6 right-6 z-[9999] flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-red-500 to-orange-500 text-white shadow-lg transition-all hover:scale-110 hover:shadow-xl active:scale-95"
          title={label}
        >
          <Bug className="h-5 w-5" />
        </button>
      )}

      {show && (
        <ReportBugModal
          context={{
            appVersion: APP_VERSION,
            route: currentRoute,
            activeTab: currentDashboardTab,
            currentDate: gameState.clock.current_date,
            dayPhase: gameState.day_phase ?? "Unknown",
            teamName: getManagerTeamName(gameState) ?? "Unknown",
            leagueName: gameState.leagues?.[0]?.name ?? "Unknown",
            lolPatch: gameState.champion_patch?.current_patch_label ?? "Unknown",
          }}
          saveJson={JSON.stringify(gameState, null, 2)}
          onClose={() => setShow(false)}
        />
      )}
    </>
  );
}

