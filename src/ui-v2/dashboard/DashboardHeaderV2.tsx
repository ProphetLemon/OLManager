import { ArrowLeft, ChevronRight, Loader2, Play, Save, SkipForward, Swords } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui-v2/components/ui/button";
import { ClubShield } from "@/ui-v2/components/ui/club-shield";
import { Separator } from "@/ui-v2/components/ui/separator";
import { SplitButton } from "@/ui-v2/components/ui/split-button";
import { ClockPlate } from "@/ui-v2/shell/ClockPlate";
import { SectionStripV2 } from "@/ui-v2/shell/SectionStripV2";
import { RAIL_GROUPS, groupForTab } from "@/ui-v2/shell/navModel";
import type { ShellBadges } from "@/ui-v2/shell/shellTypes";
import type { DashboardAlert } from "@/ui-v2/_legacy/components/dashboard/dashboardHelpers";

interface Props {
  activeTabLabel: string;
  currentDate: string;
  hasProfileHistory: boolean;
  isAdvancing: boolean;
  /** The split is over: the clock stays put until the next season starts. */
  seasonComplete?: boolean;
  isSaving: boolean;
  saveFlash: boolean;
  hasMatchToday: boolean;
  dayPhase: string;
  /** Kept for API compatibility; the aggregate "to resolve" chip replaced the alert chip. */
  alerts: DashboardAlert[];
  onBack: () => void;
  onSave: () => void;
  onContinue: () => void;
  onSkipToMatchDay: () => void;
  onSkipToNextDay: () => void;
  /** Kept for API compatibility; navigation now goes through `onNavClick`. */
  onNavigate: (tab: string) => void;
  teamName?: string;
  teamLogo?: string | null;
  activeTab?: string;
  onNavClick?: (tab: string) => void;
  badges?: ShellBadges;
  isUnemployed?: boolean;
  callCount?: number;
  onShowCalls?: () => void;
  compact?: boolean;
}

const NO_BADGES: ShellBadges = { unread: 0, offers: 0, players: 0, teams: 0, staff: 0 };

/** Broadcast bar (title, clock, calls, save, advance) with the section strip below it. */
export function DashboardHeaderV2({
  activeTabLabel,
  currentDate,
  hasProfileHistory,
  isAdvancing,
  seasonComplete = false,
  isSaving,
  saveFlash,
  hasMatchToday,
  dayPhase,
  onBack,
  onSave,
  onContinue,
  onSkipToMatchDay,
  onSkipToNextDay,
  onNavigate,
  teamName = "",
  teamLogo = null,
  activeTab = "",
  onNavClick,
  badges = NO_BADGES,
  isUnemployed = false,
  callCount = 0,
  onShowCalls,
  compact = false,
}: Props) {
  const { t } = useTranslation();

  const phaseLabels: Record<string, string> = {
    Morning: t("onAir.bar.phase.morning", { defaultValue: "Morning" }),
    ScrimBlock: t("onAir.bar.phase.scrimBlock", { defaultValue: "Scrims" }),
    ReviewBlock: t("onAir.bar.phase.reviewBlock", { defaultValue: "Review" }),
    TrainingBlock: t("onAir.bar.phase.trainingBlock", { defaultValue: "Training" }),
    Evening: t("onAir.bar.phase.evening", { defaultValue: "Evening" }),
  };
  const phase = dayPhase ? { key: dayPhase, label: phaseLabels[dayPhase] ?? dayPhase } : undefined;

  const group = groupForTab(activeTab);
  const groupDef = RAIL_GROUPS.find((g) => g.id === group);
  const showStrip = !compact && groupDef !== undefined && !(isUnemployed && groupDef.hiddenWhenUnemployed);
  const navigate = onNavClick ?? onNavigate;

  const saveLabel = t("onAir.bar.save", { defaultValue: "Save" });
  const continueLabel = seasonComplete
    ? t("endOfSeason.seasonComplete", { defaultValue: "Season Complete" })
    : hasMatchToday
      ? t("onAir.bar.matchDay", { defaultValue: "Match" })
      : t("onAir.bar.continue", { defaultValue: "Continue" });

  return (
    <header className="shrink-0 bg-card">
      <div className={`flex h-[3.75rem] items-center ${compact ? "gap-2 px-3" : "gap-3 px-4"}`}>
        {hasProfileHistory && (
          <>
            <Button variant="ghost" size="icon-touch" onClick={onBack} aria-label={t("common.back")}>
              <ArrowLeft aria-hidden="true" className="size-4" />
            </Button>
            <Separator orientation="vertical" className="h-5" />
          </>
        )}

        <div className="flex min-w-0 flex-1 items-center gap-3">
          {teamName && <ClubShield name={teamName} logoUrl={teamLogo} size="md" className="shrink-0" />}
          <div className="min-w-0">
            {teamName && <p className="truncate text-caption leading-tight text-muted-foreground">{teamName}</p>}
            <h1 className="truncate font-heading text-title font-bold leading-tight text-foreground">
              {activeTabLabel}
            </h1>
          </div>
        </div>

        <ClockPlate dateLabel={currentDate} phase={phase} className={compact ? "hidden" : undefined} />

        {callCount > 0 && onShowCalls && (
          <Button
            variant="outline"
            size="touch"
            onClick={onShowCalls}
            data-slot="resolve-chip"
            className="shrink-0 gap-2 rounded-full border-warning/40 bg-warning/10 px-3.5 text-warning hover:bg-warning/20 hover:text-warning"
          >
            <span aria-hidden="true" className="size-2 rounded-full bg-warning" />
            {t("onAir.bar.toResolve", { count: callCount, defaultValue: "{{count}} to resolve" })}
          </Button>
        )}

        <Button
          variant="outline"
          size="icon-touch"
          onClick={onSave}
          disabled={isSaving}
          aria-label={saveLabel}
          title={saveLabel}
          className="shrink-0"
        >
          {isSaving ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Save aria-hidden="true" className="size-4" />
          )}
        </Button>
        <span role="status" aria-live="polite" className="sr-only">
          {saveFlash ? t("onAir.bar.saved", { defaultValue: "Saved" }) : ""}
        </span>

        <SplitButton
          className="shrink-0"
          label={continueLabel}
          icon={hasMatchToday ? <Swords aria-hidden="true" /> : <Play aria-hidden="true" />}
          onClick={onContinue}
          disabled={seasonComplete}
          loading={isAdvancing}
          menuLabel={t("onAir.bar.continueMenu", { defaultValue: "More ways to advance" })}
          items={[
            {
              id: "skipToMatchDay",
              label: t("onAir.bar.skipToMatchDay", { defaultValue: "Skip to match day" }),
              icon: <SkipForward aria-hidden="true" />,
              onSelect: onSkipToMatchDay,
            },
            {
              id: "skipToNextDay",
              label: t("onAir.bar.skipToNextDay", { defaultValue: "Skip to next day" }),
              icon: <ChevronRight aria-hidden="true" />,
              onSelect: onSkipToNextDay,
            },
            {
              id: "continue",
              label: t("onAir.bar.continue", { defaultValue: "Continue" }),
              icon: <Play aria-hidden="true" />,
              onSelect: onContinue,
            },
          ]}
        />
      </div>
      <div aria-hidden="true" data-slot="bar-rule" className="h-0.5 bg-club bg-[linear-gradient(90deg,var(--club)_0,var(--club)_60%,var(--club-secondary,var(--club))_60%,var(--club-secondary,var(--club))_100%)]" />

      {showStrip && group && groupDef && (
        <SectionStripV2
          group={group}
          activeTab={activeTab}
          onNavClick={navigate}
          badges={badges}
          label={t(groupDef.labelKey, { defaultValue: groupDef.defaultLabel })}
        />
      )}
    </header>
  );
}
