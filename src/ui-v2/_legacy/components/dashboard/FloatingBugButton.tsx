import { resolveUserLeague } from "@/lib/userLeague";
import { Bug } from "lucide-react";
import { useState, type JSX, type Ref } from "react";
import { useTranslation } from "react-i18next";

import { IconTip } from "@/ui-v2/components/ui/icon-tip";
import { railCellClass } from "@/ui-v2/shell/RailUtility";
import ReportBugModal from "@/ui-v2/_legacy/components/dashboard/ReportBugModal";
import { useGameStore } from "@/store/gameStore";
import { useBugReportStore } from "@/store/bugReportStore";
import { APP_VERSION } from "@/lib/common/appInfo";
import { getManagerTeamName } from "@/ui-v2/_legacy/components/dashboard/dashboardHelpers";

interface FloatingBugButtonProps {
  /** "cell" is the rail tree's icon-only utility cell; the default is the inline button. */
  variant?: "inline" | "cell";
  buttonRef?: Ref<HTMLButtonElement>;
  tabIndex?: 0 | -1;
  /** Controlled modal state. Without it the button keeps its own. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  "data-nav-id"?: string;
}

/** Icon button that opens the bug report. Hosted by the host screen's own controls row. */
export default function FloatingBugButton({
  variant = "inline",
  buttonRef,
  tabIndex,
  open,
  onOpenChange,
  "data-nav-id": navId,
}: FloatingBugButtonProps = {}): JSX.Element {
  const { t } = useTranslation();
  const gameState = useGameStore((s) => s.gameState);
  const { currentRoute, currentDashboardTab } = useBugReportStore();
  const [ownShow, setOwnShow] = useState(false);
  const show = open ?? ownShow;
  const setShow = (next: boolean) => {
    if (open === undefined) setOwnShow(next);
    onOpenChange?.(next);
  };

  const label = t("onAir.nav.bug", { defaultValue: "Reportar Bug" });

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        tabIndex={tabIndex}
        data-nav-id={navId}
        onClick={() => setShow(true)}
        className={variant === "cell" ? railCellClass() : "inline-flex size-[var(--hit)] items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"}
        aria-label={label}
        title={variant === "cell" ? undefined : label}
      >
        {variant === "cell" ? (
          <IconTip label={label} followFocus className="inline-flex">
            <Bug className="size-[var(--nav-icon)]" aria-hidden="true" />
          </IconTip>
        ) : (
          <Bug className="size-5" aria-hidden="true" />
        )}
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

