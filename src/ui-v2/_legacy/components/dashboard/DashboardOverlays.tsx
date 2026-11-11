import type { FixtureData, TeamData } from "@/store/gameStore";
import type { MatchModeType } from "@/hooks/useAdvanceTime";
import type { BlockerModal } from "@/hooks/useAdvanceTime.helpers";
import { canContinueAnyway } from "@/lib/home/blockerRules";
import DashboardBlockerModal from "@/ui-v2/_legacy/components/dashboard/DashboardBlockerModal";
import DashboardCloseConfirmModal from "@/ui-v2/_legacy/components/dashboard/DashboardCloseConfirmModal";
import DashboardExitConfirmModal from "@/ui-v2/_legacy/components/dashboard/DashboardExitConfirmModal";
import DashboardExitSavingModal from "@/ui-v2/_legacy/components/dashboard/DashboardExitSavingModal";
import { type DashboardMatchModeMeta } from "@/ui-v2/_legacy/components/dashboard/DashboardHeader";
import DashboardMatchConfirmModal from "@/ui-v2/_legacy/components/dashboard/DashboardMatchConfirmModal";

interface DashboardOverlaysProps {
  blockerModal: BlockerModal | null;
  currentModeMeta: DashboardMatchModeMeta;
  handleConfirmMatch: () => void;
  handleExitToMenu: () => void | Promise<void>;
  handleExitWithoutSave?: () => void;
  handleNavigate: (tab: string) => void;
  handleCloseQuit: (save: boolean) => void | Promise<void>;
  isExitingToMenu: boolean;
  matchMode: MatchModeType;
  setBlockerModal: (value: BlockerModal | null) => void;
  setShowCloseConfirm: (value: boolean) => void;
  setShowExitConfirm: (value: boolean) => void;
  setShowMatchConfirm: (value: boolean) => void;
  showCloseConfirm: boolean;
  showExitConfirm: boolean;
  showMatchConfirm: boolean;
  teams: TeamData[];
  todayMatchFixture: FixtureData | null;
}

export default function DashboardOverlays({
  blockerModal,
  currentModeMeta,
  handleConfirmMatch,
  handleExitToMenu,
  handleExitWithoutSave,
  handleNavigate,
  handleCloseQuit,
  isExitingToMenu,
  matchMode,
  setBlockerModal,
  setShowCloseConfirm,
  setShowExitConfirm,
  setShowMatchConfirm,
  showCloseConfirm,
  showExitConfirm,
  showMatchConfirm,
  teams,
  todayMatchFixture,
}: DashboardOverlaysProps) {
  return (
    <>
      {isExitingToMenu ? <DashboardExitSavingModal /> : null}

      {showExitConfirm ? (
        <DashboardExitConfirmModal
          onCancel={() => setShowExitConfirm(false)}
          onConfirm={() => {
            setShowExitConfirm(false);
            void handleExitToMenu();
          }}
          onExitWithoutSave={() => {
            setShowExitConfirm(false);
            handleExitWithoutSave?.();
          }}
        />
      ) : null}

      {showCloseConfirm ? (
        <DashboardCloseConfirmModal
          onCancel={() => setShowCloseConfirm(false)}
          onQuitWithoutSave={() => void handleCloseQuit(false)}
          onSaveAndQuit={() => void handleCloseQuit(true)}
        />
      ) : null}

      {showMatchConfirm ? (
        <DashboardMatchConfirmModal
          matchMode={matchMode}
          modeMeta={currentModeMeta}
          onCancel={() => setShowMatchConfirm(false)}
          onConfirm={handleConfirmMatch}
          teams={teams}
          todayMatchFixture={todayMatchFixture}
        />
      ) : null}

      {blockerModal ? (
        <DashboardBlockerModal
          blockerModal={blockerModal}
          onClose={() => setBlockerModal(null)}
          onContinueAnyway={
            canContinueAnyway(blockerModal.blockers) ? (blockerModal.pendingAction ?? null) : null
          }
          onNavigate={(tab) => {
            setBlockerModal(null);
            handleNavigate(tab);
          }}
        />
      ) : null}
    </>
  );
}