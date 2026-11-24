import { ArrowLeft, ChevronRight, Loader2, Play, Save, SkipForward, Swords } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { usePhoneForm } from "@/hooks/usePhoneForm";
import { backControlLabel, groupTitle } from "@/lib/dashboard/describeLocation";
import { Button } from "@/ui-v2/components/ui/button";
import { ClubShield } from "@/ui-v2/components/ui/club-shield";
import { IconTip } from "@/ui-v2/components/ui/icon-tip";
import { Separator } from "@/ui-v2/components/ui/separator";
import { cn } from "@/ui-v2/lib/utils";
import { SplitButton } from "@/ui-v2/components/ui/split-button";
import { ClockPlate } from "@/ui-v2/shell/ClockPlate";
import type { DashboardAlert } from "@/ui-v2/_legacy/components/dashboard/dashboardHelpers";

interface Props {
  /** The location's own title (R21): the tab's label, or the entity's name on a profile or champion page. */
  title: string;
  currentDate: string;
  /** The same date, abbreviated (weekday, month, day): taken when the bar is narrow. Falls back to `currentDate`. */
  currentDateShort?: string;
  /** The title of where Back lands, or null when Back has nowhere to go (R20). */
  backTo: string | null;
  isAdvancing: boolean;
  /** The split is over: the clock stays put until the next season starts. */
  seasonComplete?: boolean;
  /** The closed period is a split with later splits in the season, not the season. */
  endsSplit?: boolean;
  isSaving: boolean;
  saveFlash: boolean;
  /** The last auto-save failed: the game is not on disk. */
  saveFailed?: boolean;
  hasMatchToday: boolean;
  dayPhase: string;
  /** Kept for API compatibility; the aggregate "to resolve" chip replaced the alert chip. */
  alerts: DashboardAlert[];
  onBack: () => void;
  onSave: () => void;
  onContinue: () => void;
  onSkipToMatchDay: () => void;
  onSkipToNextDay: () => void;
  teamName?: string;
  teamLogo?: string | null;
  activeTab?: string;
  isUnemployed?: boolean;
  callCount?: number;
  onShowCalls?: () => void;
  compact?: boolean;
  /** The phone's More trigger, between the date and Save (the rail has no stop for it). */
  more?: ReactNode;
}

/** Broadcast bar: crumb (team, group) over the title, clock, decisions chip, save and advance. */
export function DashboardHeaderV2({
  title,
  currentDate,
  currentDateShort,
  backTo,
  isAdvancing,
  seasonComplete = false,
  endsSplit = false,
  isSaving,
  saveFlash,
  saveFailed = false,
  hasMatchToday,
  dayPhase,
  onBack,
  onSave,
  onContinue,
  onSkipToMatchDay,
  onSkipToNextDay,
  teamName = "",
  teamLogo = null,
  activeTab = "",
  isUnemployed = false,
  callCount = 0,
  onShowCalls,
  compact = false,
  more,
}: Props) {
  const { t } = useTranslation();
  // The phone re-lays the same bar as one row: no shield, team or crumb, a stacked date, More.
  const phone = usePhoneForm();

  const phaseLabels: Record<string, string> = {
    Morning: t("onAir.bar.phase.morning", { defaultValue: "Morning" }),
    ScrimBlock: t("onAir.bar.phase.scrimBlock", { defaultValue: "Scrims" }),
  };
  const phase = dayPhase ? { key: dayPhase, label: phaseLabels[dayPhase] ?? dayPhase } : undefined;

  // The crumb: the team (not while unemployed) and the group of the tab, when it has one.
  // On a profile it is the tab the profile was opened from.
  const crumbTeam = !isUnemployed && teamName ? teamName : "";
  const crumbGroup = groupTitle(activeTab, t) ?? "";
  const canGoBack = backTo !== null;
  const backLabel = backControlLabel(t, backTo);

  const saveLabel = saveFailed
    ? t("onAir.bar.autoSaveFailed", { defaultValue: "Auto-save failed. Press Save to keep your progress." })
    : t("onAir.bar.save", { defaultValue: "Save" });
  const continueLabel = seasonComplete
    ? endsSplit
      ? t("endOfSeason.splitComplete", { defaultValue: "Split Complete" })
      : t("endOfSeason.seasonComplete", { defaultValue: "Season Complete" })
    : hasMatchToday
      ? t("onAir.bar.matchDay", { defaultValue: "Match" })
      : t("onAir.bar.continue", { defaultValue: "Continue" });

  const crumbTitle = [crumbTeam, crumbGroup].filter(Boolean).join(", ");
  const chipLabel = t("onAir.bar.toResolve", { count: callCount, defaultValue: "{{count}} to resolve" });

  return (
    // A container: the bar gives way to its own width (R17), not the window's, because the
    // rail and its panel take a different share of the window in each mode.
    <header className="@container shrink-0 bg-card">
      <div
        data-slot="bar-row"
        className={
          phone
            ? "flex h-[var(--hit)] items-center gap-1 px-2"
            : cn("flex min-h-[3.75rem] flex-wrap items-center gap-y-2 py-2", compact ? "gap-x-2 px-3" : "gap-x-3 px-4")
        }
      >
        {/* Title group: a row of its own under 58rem, the rest of the row above. Never hidden. */}
        <div
          data-slot="bar-title"
          className={
            phone
              ? "flex min-w-0 flex-1 items-center gap-1"
              : "flex min-w-0 basis-full items-center gap-3 @min-[58rem]:basis-0 @min-[58rem]:flex-1"
          }
        >
          {/* Back is always here, so the title never moves (R20). With nowhere to go it stays
              focusable and named, but aria-disabled: never `disabled`, which would drop it from
              the tab order and kill its tip. One element throughout, so focus survives its rename. */}
          <Button
            variant="ghost"
            size="icon-touch"
            onClick={canGoBack ? onBack : undefined}
            aria-label={backLabel}
            aria-disabled={canGoBack ? undefined : true}
            data-slot="bar-back"
            // Dimmed, it gives no hover wash or press nudge (the ghost variant's dark hover and the
            // base press each need their own override), and forced colours show it as GrayText,
            // which they give only to :disabled, on hover too, or `hover:text-dim` would win (R53).
            className={cn(
              "shrink-0",
              !canGoBack &&
                "cursor-default text-dim hover:bg-transparent hover:text-dim dark:hover:bg-transparent active:not-aria-[haspopup]:translate-y-0 forced-colors:text-[color:GrayText] forced-colors:hover:text-[color:GrayText]",
            )}
          >
            <IconTip label={backLabel} followFocus className="inline-flex">
              <ArrowLeft aria-hidden="true" className="size-4" />
            </IconTip>
          </Button>
          {!phone && <Separator orientation="vertical" className="h-5 shrink-0" />}
          {!phone && teamName && <ClubShield name={teamName} logoUrl={teamLogo} size="md" className="shrink-0" />}
          <div className="min-w-0 flex-1">
            {!phone && (crumbTeam || crumbGroup) && (
              // text-nav, not text-caption: the shell keeps its own label token (R16); caption was 6.75 px at the old 9 px Android root.
              <p data-slot="crumb" title={crumbTitle} className="truncate text-nav leading-tight text-dim">
                {crumbTeam && <span>{crumbTeam}</span>}
                {crumbTeam && crumbGroup && (
                  <>
                    <span aria-hidden="true"> · </span>
                    <span className="sr-only">, </span>
                  </>
                )}
                {crumbGroup && <span>{crumbGroup}</span>}
              </p>
            )}
            <h1
              title={title}
              className={cn("truncate font-heading font-bold leading-tight text-foreground", phone ? "text-section" : "text-title")}
            >
              {title}
            </h1>
          </div>
        </div>

        {/* Actions: the clock gives way first (short date), then the chip goes icon-only; under
            58rem this group drops to the second row and wraps again if it must. */}
        <div
          data-slot="bar-actions"
          className={cn(
            "flex items-center",
            phone ? "shrink-0 gap-1" : cn("min-w-0 max-w-full flex-wrap @min-[58rem]:flex-nowrap", compact ? "gap-2" : "gap-3"),
          )}
        >
        <ClockPlate dateLabel={currentDate} dateShortLabel={currentDateShort} phase={phase} stacked={phone} className={compact ? "hidden" : undefined} />

        {callCount > 0 && onShowCalls && (
          <Button
            variant="outline"
            size="touch"
            onClick={onShowCalls}
            aria-label={chipLabel}
            data-slot="resolve-chip"
            className="shrink-0 gap-2 rounded-full border-warning/40 bg-warning/10 px-3.5 text-warning hover:bg-warning/20 hover:text-warning"
          >
            <span aria-hidden="true" className="size-2 rounded-full bg-warning" />
            {/* Under 64rem only the count stays; the name is the aria-label either way. */}
            <span data-part="chip-text" className="@max-[64rem]:hidden">
              {chipLabel}
            </span>
            <span data-part="chip-count" aria-hidden="true" className="hidden tabular-nums @max-[64rem]:inline">
              {callCount}
            </span>
          </Button>
        )}

        {more}

        <Button
          variant="outline"
          size="icon-touch"
          onClick={onSave}
          disabled={isSaving}
          aria-label={saveLabel}
          title={saveLabel}
          className="relative shrink-0"
        >
          {saveFailed && !isSaving && (
            <span aria-hidden="true" className="absolute end-1 top-1 size-2 rounded-full bg-warning" />
          )}
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
          className={cn(
            "shrink-0 @max-[22rem]:[&>button:first-child]:px-3 @max-[22rem]:[&>button:first-child]:text-base",
            phone && "ms-2 [&>button:first-child]:px-3 [&>button:first-child]:text-base",
          )}
          label={continueLabel}
          icon={hasMatchToday ? <Swords aria-hidden="true" /> : <Play aria-hidden="true" />}
          onClick={onContinue}
          disabled={seasonComplete}
          loading={isAdvancing}
          menuLabel={t("onAir.bar.continueMenu", { defaultValue: "More ways to advance" })}
          items={[
            {
              id: "skipToMatchDay",
              label: t("onAir.bar.skipToMatchDay", { defaultValue: "Simulate to next match" }),
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
      </div>
      <div aria-hidden="true" data-slot="bar-rule" className="h-0.5 bg-club bg-[linear-gradient(90deg,var(--club)_0,var(--club)_60%,var(--club-secondary,var(--club))_60%,var(--club-secondary,var(--club))_100%)]" />
    </header>
  );
}
