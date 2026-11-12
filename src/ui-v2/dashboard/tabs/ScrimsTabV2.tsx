import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";

import type { GameStateData, ScrimFocus } from "@/store/gameStore";
import {
  buildStaffSuggestions,
  buildScrimPlanSignals as deriveScrimPlanSignals,
  deriveDailyScrimBlockMeta,
  deriveTodayScrimContext,
  dateKey,
  deriveWeeklyScrimContext,
  effectiveWeeklyScrimSlots,
  teamLolOvr,
  type ScrimDayState,
} from "@/lib/scrims/scrimContext";
import {
  chooseDailyScrimAction,
  finalizeWeeklyScrimSetup,
  setWeeklyScrimObjective,
  setWeeklyScrimSlots,
  type DailyScrimAction,
} from "@/services/trainingService";
import { dailyScrimDecisionActions } from "@/lib/scrims/dailyDecisionActions";
import { decisionEffectLines, NEXT_BLOCK_CANCELLATION, type DecisionEffectContext } from "@/lib/scrims/decisionEffects";
import { buildDecisionResult, type DecisionResult } from "@/lib/scrims/decisionResult";
import { deskPanel, riskLevel, type RiskLevel } from "@/lib/scrims/scrimDesk";
import { nextPlanningMonday, scrimSetupBlockedKey } from "@/lib/scrims/setupLock";
import { formatDate } from "@/lib/formatting/dateFormatting";
import { useScrimContextWithFallback } from "@/hooks/useScrimContextWithFallback";
import { useSettingsStore } from "@/store/settingsStore";
import { Button } from "@/ui-v2/components/ui/button";
import { ScrimDeskPanel } from "./scrims/ScrimDeskPanel";
import { ScrimDecisionPanel } from "./scrims/ScrimDecisionPanel";
import { ScrimDecisionResult } from "./scrims/ScrimDecisionResult";
import { ScrimSetupPanel } from "./scrims/ScrimSetupPanel";
import { ScrimSetupRecap } from "./scrims/ScrimSetupRecap";
import { ScrimStaffSuggestions } from "./scrims/ScrimStaffSuggestions";
import { ScrimTodayPanel } from "./scrims/ScrimTodayPanel";
import { ScrimWeekGauges } from "./scrims/ScrimWeekGauges";
import { ScrimWeekStrip } from "./scrims/ScrimWeekStrip";
import { ScrimWeeklyReport } from "./scrims/ScrimWeeklyReport";

interface ScrimsTabV2Props {
  gameState: GameStateData;
  onGameUpdate: (state: GameStateData) => void;
}

const ALLOW_SCRIM_CONTEXT_FALLBACK = true;

const DECISION_TEXT_KEY: Record<DailyScrimAction, string> = {
  ContinueToBlock2: "continueBlock2",
  OfferRest: "offerRest",
  PushThrough: "pushThrough",
  CancelScrims: "cancelScrims",
  VodReview: "vodReview",
  MentalReset: "mentalReset",
  TargetedDrills: "targetedDrills",
  DayOff: "dayOff",
};

function todayStateKey(state: ScrimDayState): string {
  switch (state) {
    case "PlayedNeedsReview": return "scrims.pendingReview";
    case "Reviewed": return "scrims.reviewed";
    case "Planned": return "scrims.planned";
    case "Cancelled": return "scrims.cancelled";
    default: return "scrims.noScrim";
  }
}

export function ScrimsTabV2({ gameState, onGameUpdate }: ScrimsTabV2Props) {
  const { t, i18n } = useTranslation();
  const { settings, updateSettings } = useSettingsStore();
  const [isSaving, setIsSaving] = useState(false);
  const [decisionSaving, setDecisionSaving] = useState<DailyScrimAction | null>(null);
  const [statusText, setStatusText] = useState("");
  const [lastResult, setLastResult] = useState<{ date: string; value: DecisionResult } | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const [showCancelFollowups, setShowCancelFollowups] = useState(false);
  const remoteScrimContext = useScrimContextWithFallback(gameState);
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const myTeam = gameState.teams.find((team) => team.id === gameState.manager.team_id);

  // After a decision lands the focus goes to the heading of the wide column, which survives the
  // change of body: the card that had it is gone.
  useEffect(() => {
    if (focusTick > 0) headingRef.current?.focus();
  }, [focusTick]);

  if (!myTeam) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="font-heading text-sm uppercase tracking-wide text-muted-foreground">{t("common.noTeam")}</p>
      </div>
    );
  }

  const fallbackWeekly = deriveWeeklyScrimContext(gameState, myTeam);
  const fallbackToday = deriveTodayScrimContext(gameState, myTeam);
  const weeklyContext = remoteScrimContext?.week ?? (ALLOW_SCRIM_CONTEXT_FALLBACK ? fallbackWeekly : null);
  const todayContext = remoteScrimContext?.today ?? (ALLOW_SCRIM_CONTEXT_FALLBACK ? fallbackToday : null);

  if (!weeklyContext || !todayContext) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">{t("scrims.loadingContext")}</p>
      </div>
    );
  }

  const weekdayLabels = [
    t("training.days.mon"), t("training.days.tue"), t("training.days.wed"),
    t("training.days.thu"), t("training.days.fri"), t("training.days.sat"), t("training.days.sun"),
  ];
  const teamNameById = new Map(gameState.teams.map((team) => [team.id, team.name]));
  const objective = weeklyContext.objective;
  const latestReports = weeklyContext.latestReports.slice(0, 3);
  const setupLocked = weeklyContext.setupLocked;
  const assistantControls = settings.scrim_review_mode === "assistant";
  const setupBlockedKey = scrimSetupBlockedKey(weeklyContext, assistantControls);
  const setupBlockedText = setupBlockedKey
    ? t(setupBlockedKey, {
        date: formatDate(nextPlanningMonday(gameState.clock.current_date), i18n.language, {
          weekday: "long",
          month: "long",
          day: "numeric",
        }),
      })
    : null;
  const planSignals = deriveScrimPlanSignals(gameState, myTeam.id, weeklyContext);
  const staffSuggestions = buildStaffSuggestions(
    (key, fb) => t(key, { defaultValue: fb }), objective, weeklyContext.capacity, latestReports,
    weeklyContext.lossStreak, weeklyContext.cancellations, planSignals, weeklyContext.reputation,
  );

  // ── Today ──
  const todayOpponentId = todayContext.resolvedOpponentTeamId ?? todayContext.opponentTeamId;
  const todayOpponentName = todayOpponentId ? teamNameById.get(todayOpponentId) ?? todayOpponentId : null;
  const todayOpponentTeam = todayOpponentId ? gameState.teams.find((team) => team.id === todayOpponentId) : undefined;
  let todayRisk: RiskLevel | null = null;
  if (todayContext.state === "Planned" && todayOpponentId) {
    const repGap = Math.max(0, (todayOpponentTeam?.scrim_reputation ?? 50) - weeklyContext.reputation);
    todayRisk = riskLevel(teamLolOvr(gameState, todayOpponentId), teamLolOvr(gameState, myTeam.id), repGap);
  }
  const todaySlot = todayContext.slotIndex != null ? weeklyContext.slots[todayContext.slotIndex] : undefined;
  const slotLabelOf = (slot: { labelDay: number; labelSuffix: string } | undefined) =>
    slot ? `${weekdayLabels[slot.labelDay] ?? ""}${slot.labelSuffix ? ` ${slot.labelSuffix}` : ""}`.trim() : "";

  const dailyBlockMeta = todayContext.report
    ? deriveDailyScrimBlockMeta(effectiveWeeklyScrimSlots(myTeam), gameState.clock.current_date, todayContext.report.slot_index)
    : null;
  const isFirstBlock = dailyBlockMeta?.blockNumber === 1;
  const panel = deskPanel(todayContext, weeklyContext);

  const decisionReport = todayContext.report;
  const decisionContext: DecisionEffectContext | null = decisionReport
    ? {
        isFirstBlock,
        report: decisionReport,
        lossStreak: weeklyContext.lossStreak,
        ownReputation: weeklyContext.reputation,
        opponentReputation: gameState.teams.find((team) => team.id === decisionReport.opponent_team_id)?.scrim_reputation ?? 50,
        nextBlockLabel: isFirstBlock ? "B" : null,
      }
    : null;
  const decisionOptions = decisionReport && decisionContext
    ? dailyScrimDecisionActions({
        isFirstBlock,
        won: Boolean(decisionReport.won),
        showCancelFollowups,
      }).map((id) => ({
        id,
        label: t(`scrims.decision.${DECISION_TEXT_KEY[id]}`),
        description: t(`scrims.decision.${DECISION_TEXT_KEY[id]}Desc`),
        effects: decisionEffectLines(id, decisionContext),
      }))
    : [];

  const handleSetWeeklyCapacity = async (slots: number) => {
    if (setupLocked || assistantControls) return;
    setIsSaving(true);
    try { const updated = await setWeeklyScrimSlots(slots); onGameUpdate(updated); }
    catch (e) { console.error(e); }
    finally { setIsSaving(false); }
  };

  const handleSetObjective = async (next: ScrimFocus | null) => {
    if (setupLocked || assistantControls) return;
    setIsSaving(true);
    try { const updated = await setWeeklyScrimObjective(next); onGameUpdate(updated); }
    catch (e) { console.error(e); }
    finally { setIsSaving(false); }
  };

  const handleFinalizeSetup = async () => {
    if (setupLocked || assistantControls) return;
    setIsSaving(true);
    try { const updated = await finalizeWeeklyScrimSetup(); onGameUpdate(updated); }
    catch (e) { console.error(e); }
    finally { setIsSaving(false); }
  };

  const handleReviewDecision = async (decision: DailyScrimAction) => {
    if (!decisionReport || !decisionContext) return;
    if (decision === "CancelScrims") {
      setShowCancelFollowups(true);
      setLastResult(null);
      setStatusText(t("scrims.cancelFollowupPrompt"));
      setFocusTick((tick) => tick + 1);
      return;
    }
    const effectLines = decisionEffectLines(decision, decisionContext);
    const before = {
      quality: decisionReport.quality,
      severity: decisionReport.severity,
      reputation: weeklyContext.reputation,
      cancellations: weeklyContext.cancellations,
    };
    setDecisionSaving(decision);
    setStatusText("");
    try {
      const updated = await chooseDailyScrimAction(decisionReport.slot_index, decision);
      const updatedTeam = updated.teams?.find((team) => team.id === myTeam.id);
      const updatedReport = updatedTeam?.scrim_reports?.find(
        (entry) => entry.date === decisionReport.date && entry.slot_index === decisionReport.slot_index,
      );
      const playerLine = effectLines.find((line) => line.kind === "players");
      const value = buildDecisionResult({
        action: decision,
        isFirstBlock,
        before,
        after: {
          quality: updatedReport?.quality ?? before.quality,
          severity: updatedReport?.severity ?? before.severity,
          reputation: updatedTeam?.scrim_reputation ?? before.reputation,
          cancellations: updatedTeam?.scrim_weekly_cancellations ?? before.cancellations,
        },
        players: playerLine?.kind === "players" ? playerLine : { morale: 0, condition: 0 },
        nextBlockLabel: decisionContext.nextBlockLabel,
        nextReportWaiting: Boolean(
          updatedTeam?.scrim_reports?.some(
            (entry) => entry.date === decisionReport.date && entry.slot_index === decisionReport.slot_index + 1 && entry.post_decision == null,
          ),
        ),
      });
      onGameUpdate(updated);
      setLastResult({ date: dateKey(gameState.clock.current_date), value });
      setStatusText(`${t("scrims.reviewDecisionApplied")}: ${t(`scrims.decision.${DECISION_TEXT_KEY[decision]}`)}`);
      setShowCancelFollowups(false);
      setFocusTick((tick) => tick + 1);
    } catch (e) { console.error(e); }
    finally { setDecisionSaving(null); }
  };

  const handleBackToBlockDecision = () => {
    setShowCancelFollowups(false);
    setStatusText("");
    setFocusTick((tick) => tick + 1);
  };

  const result = lastResult && lastResult.date === dateKey(gameState.clock.current_date) ? lastResult.value : null;

  // ── The wide column ──
  const panelTitle = panel === "decision"
    ? isFirstBlock
      ? showCancelFollowups ? t("scrims.cancelFollowupTitle") : t("scrims.blockDecisionTitle")
      : t("scrims.closeDayTitle")
    : panel === "today" ? t("scrims.todayBlock") : t("scrims.weeklySetup");

  const todayMessage = (() => {
    switch (todayContext.state) {
      case "Planned":
        return t("scrims.nothingToDecide", { slot: slotLabelOf(todaySlot), opponent: todayOpponentName ?? "" });
      case "Reviewed": return t("scrims.todayReviewed");
      case "Cancelled": return t("scrims.todayCancelled");
      case "PlayedNeedsReview": return t("scrims.todayNeedsReview");
      default: return t("scrims.todayNoScrim");
    }
  })();
  const fallbackNames = todayContext.state === "Planned" && todaySlot
    ? {
        planB: todaySlot.plan[1] ? teamNameById.get(todaySlot.plan[1]) ?? todaySlot.plan[1] : null,
        planC: todaySlot.plan[2] ? teamNameById.get(todaySlot.plan[2]) ?? todaySlot.plan[2] : null,
      }
    : null;

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-4 sm:p-6 scrollbar-v2">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div>
          <h1 className="font-heading text-title font-bold uppercase leading-tight tracking-wide">{t("scrims.pageKicker")}</h1>
          <p className="text-muted-foreground">{t("scrims.pageDescription")}</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="font-heading text-base font-semibold uppercase tracking-wide">{t("scrims.assistantCoach")}</span>
          <Button
            type="button"
            size="touch"
            variant={assistantControls ? "club" : "outline"}
            aria-pressed={assistantControls}
            onClick={() => updateSettings({ scrim_review_mode: assistantControls ? "manual" : "assistant" })}
          >
            {assistantControls ? <Check aria-hidden="true" /> : null}
            {t("scrims.assistantLabel")}
          </Button>
          <p className="text-caption text-muted-foreground">
            {t("scrims.delegation")}: {assistantControls ? t("scrims.autoMode") : t("scrims.manualControl")}
          </p>
        </div>
      </header>

      {assistantControls ? <p className="text-sm text-muted-foreground">{t("scrims.assistantModeHint")}</p> : null}

      <ScrimWeekStrip
        week={weeklyContext}
        teamNameById={teamNameById}
        weekdayLabels={weekdayLabels}
        todayOpponentName={todayOpponentName}
        todayRisk={todayRisk}
      />

      <div className="flex flex-wrap items-start gap-5">
        <main className="flex min-w-0 flex-[999_1_35rem] flex-col gap-5">
          <ScrimDeskPanel ref={headingRef} id={headingId} title={panelTitle} badge={t(todayStateKey(todayContext.state))}>
            {panel === "setup" ? (
              <ScrimSetupPanel
                gameState={gameState}
                weeklyContext={weeklyContext}
                onGameUpdate={onGameUpdate}
                isSaving={isSaving}
                setIsSaving={setIsSaving}
                readOnly={setupLocked || assistantControls}
                blockedText={setupBlockedText}
                weekdayLabels={weekdayLabels}
                onObjective={handleSetObjective}
                onVolume={handleSetWeeklyCapacity}
                onFinalize={handleFinalizeSetup}
              />
            ) : null}
            {panel === "today" ? <ScrimTodayPanel message={todayMessage} fallbacks={fallbackNames} /> : null}
            {panel === "decision" && todayContext.report ? (
              <ScrimDecisionPanel
                report={todayContext.report}
                slotLabel={slotLabelOf(weeklyContext.slots[todayContext.report.slot_index])}
                blockLabel={dailyBlockMeta?.blockLabel ?? null}
                options={decisionOptions}
                savingId={decisionSaving}
                onDecide={handleReviewDecision}
                onBack={showCancelFollowups ? handleBackToBlockDecision : null}
              />
            ) : null}
          </ScrimDeskPanel>
          <ScrimDecisionResult result={result} statusText={statusText} />
          {panel !== "setup" ? (
            <ScrimSetupRecap
              key={panel}
              gameState={gameState}
              weeklyContext={weeklyContext}
              blockedText={setupBlockedText}
              defaultOpen={panel === "today"}
            />
          ) : null}
        </main>

        <aside aria-label={t("scrims.weekContext")} className="flex min-w-0 max-w-[26.25rem] flex-[1_1_21.25rem] flex-col gap-5">
          <ScrimWeekGauges
            week={weeklyContext}
            ghostReputation={panel === "decision" && showCancelFollowups ? Math.max(0, weeklyContext.reputation + NEXT_BLOCK_CANCELLATION.reputation) : null}
          />
          <ScrimStaffSuggestions suggestions={staffSuggestions} />
        </aside>
      </div>

      <ScrimWeeklyReport week={weeklyContext} teamNameById={teamNameById} />
    </div>
  );
}
