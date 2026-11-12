import { useState } from "react";
import { scrimOpponentLogo } from "@/lib/scrims/opponentLogo";
import { CalendarDays, Gauge, Lightbulb, SlidersHorizontal, Swords, Target } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { GameStateData, ScrimFocus } from "@/store/gameStore";
import {
  buildStaffSuggestions,
  buildScrimPlanSignals as deriveScrimPlanSignals,
  deriveDailyScrimBlockMeta,
  deriveTodayScrimContext,
  deriveWeeklyScrimContext,
  effectiveWeeklyScrimSlots,
} from "@/lib/scrims/scrimContext";
import { Card, CardBody, CardHeader, Select } from "@/ui-v2/_legacy/components/ui";
import {
  chooseDailyScrimAction,
  finalizeWeeklyScrimSetup,
  setWeeklyScrimObjective,
  setWeeklyScrimSlots,
  type DailyScrimAction,
} from "@/services/trainingService";
import { useScrimContextWithFallback } from "@/hooks/useScrimContextWithFallback";
import ScrimPlanningCard from "@/ui-v2/_legacy/components/scrims/ScrimPlanningCard";
import { useSettingsStore } from "@/store/settingsStore";

interface ScrimsTabProps {
  gameState: GameStateData;
  onGameUpdate?: (state: GameStateData) => void;
}

const SCRIM_SLOT_OPTIONS = [2, 4, 6];
const ALLOW_SCRIM_CONTEXT_FALLBACK = true;
const SCRIM_OBJECTIVES: ScrimFocus[] = [
  "DraftPrep",
  "ChampionPool",
  "EarlyGame",
  "Teamfighting",
  "Macro",
  "Mental",
];

function scrimFocusLabel(t: ReturnType<typeof useTranslation>["t"], focus: ScrimFocus): string {
  const labels: Record<ScrimFocus, string> = {
    DraftPrep: t("training.scrims.objectives.draftPrep"),
    ChampionPool: t("training.scrims.objectives.championPool"),
    EarlyGame: t("training.scrims.objectives.earlyGame"),
    Teamfighting: t("training.scrims.objectives.teamfighting"),
    Macro: t("training.scrims.objectives.macro"),
    Mental: t("training.scrims.objectives.mental"),
  };
  return labels[focus];
}

function scrimFocusImpactText(focus: ScrimFocus | null): string {
  if (!focus) return "Set a weekly direction so scrim decisions have clear impact.";
  const map: Record<ScrimFocus, string> = {
    DraftPrep: "Improves draft prep, ban reads, and composition plans.",
    ChampionPool: "Expands viable picks and reduces comfort-pick dependency.",
    EarlyGame: "Improves lane control, early tempo, and first rotations.",
    Teamfighting: "Improves teamfight execution, objective focus, and 5v5 coordination.",
    Macro: "Improves objective setup, map control, and mid/late decisions.",
    Mental: "Improves mental stability, recovery, and consistency under pressure.",
  };
  return map[focus];
}

function scrimFocusGrowthTags(focus: ScrimFocus | null): { primary: string[]; secondary: string[] } {
  if (!focus) {
    return { primary: [], secondary: [] };
  }
  const map: Record<ScrimFocus, { primary: string[]; secondary: string[] }> = {
    DraftPrep: {
      primary: ["Vision", "Decisions"],
      secondary: ["Leadership"],
    },
    ChampionPool: {
      primary: ["Mechanics", "Champion Pool"],
      secondary: ["Laning"],
    },
    EarlyGame: {
      primary: ["Laning", "Decisions"],
      secondary: ["Vision"],
    },
    Teamfighting: {
      primary: ["Teamfighting", "Discipline"],
      secondary: ["Positioning"],
    },
    Macro: {
      primary: ["Macro", "Decisions"],
      secondary: ["Coordination"],
    },
    Mental: {
      primary: ["Mental resilience", "Consistency"],
      secondary: ["Leadership"],
    },
  };
  return map[focus];
}

function riskBand(opponentOvr: number, ownOvr: number, repGap: number): "Bajo" | "Medio" | "Alto" {
  if (opponentOvr >= 80) return "Alto";
  if (opponentOvr >= 77) return "Medio";
  const pressure = Math.max(opponentOvr - ownOvr, Math.round(repGap / 4));
  if (pressure >= 4) return "Alto";
  if (pressure >= 2) return "Medio";
  return "Bajo";
}

function learningBand(ovrGap: number): "Bajo" | "Medio" | "Alto" {
  if (ovrGap >= 3) return "Alto";
  if (ovrGap >= 0) return "Medio";
  return "Bajo";
}

function weeklyObjectiveOutcome(
  objective: ScrimFocus | null,
  avgQuality: number,
  played: number,
  cancellations: number,
): "Cumplido" | "Parcial" | "Fallido" {
  if (!objective) return played >= 2 ? "Parcial" : "Fallido";
  if (played >= 3 && avgQuality >= 65 && cancellations <= 1) return "Cumplido";
  if (played >= 2 && avgQuality >= 55) return "Parcial";
  return "Fallido";
}

export default function ScrimsTab({
  gameState,
  onGameUpdate,
}: ScrimsTabProps) {
  const { t } = useTranslation();
  const { settings, updateSettings } = useSettingsStore();
  const [isSaving, setIsSaving] = useState(false);
  const [decisionSaving, setDecisionSaving] = useState<string | null>(null);
  const [decisionFeedback, setDecisionFeedback] = useState<string | null>(null);
  const [showCancelFollowups, setShowCancelFollowups] = useState(false);
  const dayPhase = gameState.day_phase ?? "Morning";
  const reviewPhaseActive = dayPhase === "ScrimBlock";
  const remoteScrimContext = useScrimContextWithFallback(gameState);
  const myTeam = gameState.teams.find(
    (team) => team.id === gameState.manager.team_id,
  );

  if (!myTeam) {
    return (
      <p className="text-gray-500 dark:text-gray-400">{t("common.noTeam")}</p>
    );
  }

  const fallbackWeeklyContext = deriveWeeklyScrimContext(gameState, myTeam);
  const fallbackTodayContext = deriveTodayScrimContext(gameState, myTeam);
  const weeklyContext = remoteScrimContext?.week ?? (ALLOW_SCRIM_CONTEXT_FALLBACK ? fallbackWeeklyContext : null);
  const todayContext = remoteScrimContext?.today ?? (ALLOW_SCRIM_CONTEXT_FALLBACK ? fallbackTodayContext : null);

  if (!weeklyContext || !todayContext) {
    return (
      <p className="text-gray-500 dark:text-gray-400">
        {t("scrims.loadingContext")}
      </p>
    );
  }
  const weeklyCapacity = weeklyContext.capacity;
  const plannedScrims = weeklyContext.planned;
  const played = weeklyContext.played;
  const wins = weeklyContext.wins;
  const losses = weeklyContext.losses;
  const objective = weeklyContext.objective;
  const teamNameById = new Map(gameState.teams.map((team) => [team.id, team.name]));
  const latestReports = weeklyContext.latestReports.slice(0, 3);
  const nextOfficialRivalName = weeklyContext.nextOfficialRivalTeamId
    ? teamNameById.get(weeklyContext.nextOfficialRivalTeamId) ?? weeklyContext.nextOfficialRivalTeamId
    : null;
  const todayOpponentName = (() => {
    const candidate = todayContext.resolvedOpponentTeamId ?? todayContext.opponentTeamId;
    if (!candidate) return null;
    return teamNameById.get(candidate) ?? candidate;
  })();
  const planSignals = deriveScrimPlanSignals(gameState, myTeam.id, weeklyContext);
  const estimatedTodayGap = todayContext.opponentTeamId
    ? Math.max(0, planSignals.maxOpponentOvr - planSignals.ownOvr)
    : 0;
  const estimatedRepGap = todayContext.opponentTeamId
    ? Math.max(0, planSignals.avgOpponentScrimReputation - weeklyContext.reputation)
    : 0;
  const todayRisk = riskBand(planSignals.maxOpponentOvr, planSignals.ownOvr, estimatedRepGap);
  const todayLearning = learningBand(estimatedTodayGap);
  const cancelCost = 5;
  const setupLocked = weeklyContext.setupLocked;
  const assistantControls = settings.scrim_review_mode === "assistant";
  const objectiveGrowth = scrimFocusGrowthTags(objective);
  const weeklyOutcome = weeklyObjectiveOutcome(
    weeklyContext.objective,
    weeklyContext.avgQuality,
    weeklyContext.played,
    weeklyContext.cancellations,
  );
  const weeklyMainGain = weeklyContext.avgQuality >= 65
    ? t("scrims.weeklyGainSolid")
    : weeklyContext.wins > weeklyContext.losses
      ? t("scrims.weeklyGainExecution")
      : t("scrims.weeklyGainExposure");
  const weeklyMainFailure = weeklyContext.topIssue
    ? t("scrims.weeklyFailureIssue", { defaultValue: "Issue recurrente: {{issue}}", issue: weeklyContext.topIssue })
    : weeklyContext.cancellations >= 2
      ? t("scrims.weeklyFailureCancellations")
      : t("scrims.weeklyFailureConsistency");
  const dailyBlockMeta = todayContext.report
    ? deriveDailyScrimBlockMeta(
      effectiveWeeklyScrimSlots(myTeam),
      gameState.clock.current_date,
      todayContext.report.slot_index,
    )
    : null;
  const isFirstBlock = dailyBlockMeta?.blockNumber === 1;
  const resultIsBad = Boolean(todayContext.report && !todayContext.report.won);
  const decisionOptions: Array<{ id: DailyScrimAction; label: string; description: string }> = (() => {
    if (!todayContext.report) return [];
    if (isFirstBlock && resultIsBad && !showCancelFollowups) {
      return [
        { id: "PushThrough", label: t("scrims.decision.pushThrough", "Push Through"), description: t("scrims.decision.pushThroughDesc", "Continue with higher risk to keep volume.") },
        { id: "CancelScrims", label: t("scrims.decision.cancelScrims", "Cancel scrims"), description: t("scrims.decision.cancelScrimsDesc", "Cancel next block and choose a technical follow-up.") },
      ];
    }
    if (isFirstBlock && !resultIsBad) {
      return [
        { id: "ContinueToBlock2", label: t("scrims.decision.continueBlock2", "Continue to block 2"), description: t("scrims.decision.continueBlock2Desc", "Keep today's plan.") },
        { id: "OfferRest", label: t("scrims.decision.offerRest", "Offer rest"), description: t("scrims.decision.offerRestDesc", "Cancel next block to recover.") },
      ];
    }
    if (isFirstBlock && resultIsBad && showCancelFollowups) {
      return [
        { id: "VodReview", label: t("scrims.decision.vodReview", "VOD Review"), description: t("scrims.decision.vodReviewDesc", "Analizar errores y ajustar plan.") },
        { id: "MentalReset", label: t("scrims.decision.mentalReset", "Mental Reset"), description: t("scrims.decision.mentalResetDesc", "Recover morale/condition.") },
        { id: "TargetedDrills", label: t("scrims.decision.targetedDrills", "Targeted Drills"), description: t("scrims.decision.targetedDrillsDesc", "Corregir issue puntual.") },
      ];
    }
    return [
      { id: "DayOff", label: t("scrims.decision.dayOff", "Day off"), description: t("scrims.decision.dayOffDesc", "Close the day and prioritize recovery.") },
      { id: "VodReview", label: t("scrims.decision.vodReview", "VOD Review"), description: t("scrims.decision.vodReviewDesc", "Analyze mistakes and adjust the plan.") },
      { id: "MentalReset", label: t("scrims.decision.mentalReset", "Mental Reset"), description: t("scrims.decision.mentalResetDesc", "Recover morale/condition.") },
      { id: "TargetedDrills", label: t("scrims.decision.targetedDrills", "Targeted Drills"), description: t("scrims.decision.targetedDrillsDesc", "Correct the specific issue.") },
    ];
  })();
  const decisionImpactTags: Record<DailyScrimAction, string[]> = {
    ContinueToBlock2: ["Momentum +", "Fatigue -", "Volume +"],
    OfferRest: ["Recovery +", "Fatigue +", "Volume -"],
    PushThrough: ["Volume +", "Learning +", "Mental -"],
    CancelScrims: ["Recovery +", "Risk -", "Volume -"],
    VodReview: ["Analysis +", "Quality +", "Recovery -"],
    MentalReset: ["Mental +", "Recovery +", "Technique -"],
    TargetedDrills: ["Issue +", "Mechanics +", "Fatigue -"],
    DayOff: ["Recovery +", "Mental +", "Volume -"],
  };

  const handleSetWeeklyCapacity = async (slots: number) => {
    if (setupLocked || assistantControls) return;
    setIsSaving(true);
    try {
      const updated = await setWeeklyScrimSlots(slots);
      onGameUpdate?.(updated);
    } catch (error) {
      console.error("Failed to save weekly scrim slots:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSetObjective = async (nextObjective: ScrimFocus | null) => {
    if (setupLocked || assistantControls) return;
    setIsSaving(true);
    try {
      const updated = await setWeeklyScrimObjective(nextObjective);
      onGameUpdate?.(updated);
    } catch (error) {
      console.error("Failed to save weekly scrim objective:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReviewDecision = async (decision: DailyScrimAction) => {
    if (!todayContext.report) return;
    if (decision === "CancelScrims") {
      setShowCancelFollowups(true);
      setDecisionFeedback("Scrims cancelled. Pick VOD Review, Mental Reset, or Targeted Drills to close the day.");
      return;
    }
    setDecisionSaving(decision);
    setDecisionFeedback(null);
    try {
      const updated = await chooseDailyScrimAction(todayContext.report.slot_index, decision);
      onGameUpdate?.(updated);
      setDecisionFeedback(t("scrims.reviewDecisionApplied"));
      setShowCancelFollowups(false);
    } catch (error) {
      console.error("Failed to choose post-scrim decision from ScrimsTab:", error);
    } finally {
      setDecisionSaving(null);
    }
  };

  const handleFinalizeSetup = async () => {
    if (setupLocked || assistantControls) return;
    setIsSaving(true);
    try {
      const updated = await finalizeWeeklyScrimSetup();
      onGameUpdate?.(updated);
    } catch (error) {
      console.error("Failed to finalize weekly scrim setup:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const staffSuggestions = buildStaffSuggestions(
    (key, fallback) => t(key, { defaultValue: fallback }),
    objective,
    weeklyCapacity,
    latestReports,
    weeklyContext.lossStreak,
    weeklyContext.cancellations,
    planSignals,
    weeklyContext.reputation,
  );

  return (
    <div className="w-[92%] max-w-[2000px] mx-auto flex flex-col gap-5">
      <Card accent="primary">
        <CardBody>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-heading font-bold uppercase tracking-wider text-primary-500 dark:text-primary-400">
                {t("scrims.pageKicker")}
              </p>
              <h2 className="mt-1 text-3xl font-heading font-bold uppercase tracking-wide text-gray-900 dark:text-white">
                {t("dashboard.scrims")}
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-gray-600 dark:text-gray-400">
                {t(
                  "scrims.pageDescription",
                  "Plan rivals, track weekly results, and set up better future practice blocks.",
                )}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-navy-600 dark:bg-navy-900/50">
                <CalendarDays className="mx-auto mb-1 h-4 w-4 text-primary-500" />
                <p className="text-2xl font-heading font-bold text-gray-900 dark:text-white">
                  {plannedScrims}/{weeklyCapacity}
                </p>
                <p className="text-2xs font-heading uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  {t("scrims.planned")}
                </p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-navy-600 dark:bg-navy-900/50">
                <Swords className="mx-auto mb-1 h-4 w-4 text-amber-400" />
                <p className="text-2xl font-heading font-bold text-gray-900 dark:text-white">
                  {wins}-{losses}
                </p>
                <p className="text-2xs font-heading uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  {t("scrims.weekRecord")}
                </p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-navy-600 dark:bg-navy-900/50">
                <Gauge className="mx-auto mb-1 h-4 w-4 text-accent-500" />
                <p className="text-2xl font-heading font-bold text-gray-900 dark:text-white">
                  {weeklyContext.reputation}
                </p>
                <p className="text-2xs font-heading uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  {t("scrims.reputation")}
                </p>
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span>{t("scrims.played")}: {played}</span>
            <span>{t("scrims.cancellations")}: {weeklyContext.cancellations}</span>
            {nextOfficialRivalName ? (
              <span>
                {t("scrims.nextOfficialRival")}: {nextOfficialRivalName}
                {weeklyContext.nextOfficialRivalCompetition ? ` · ${weeklyContext.nextOfficialRivalCompetition}` : ""}
              </span>
            ) : null}
          </div>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <span className="inline-flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-gray-500 dark:text-gray-400" />
            {t("scrims.weeklySetup")}
          </span>
        </CardHeader>
        <CardBody>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div className="space-y-2">
              <label className="block text-xs font-heading font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                <span className="inline-flex items-center gap-2">
                  <Target className="h-4 w-4" />
                  {t("training.scrims.weeklyObjective")}
                </span>
              </label>
              <Select
                value={objective ?? ""}
                onChange={(event) => void handleSetObjective((event.target.value || null) as ScrimFocus | null)}
                disabled={isSaving || setupLocked || assistantControls}
                variant="muted"
                fullWidth
              >
                <option value="">{t("training.scrims.objectives.none")}</option>
                {SCRIM_OBJECTIVES.map((focus) => (
                  <option key={focus} value={focus}>{scrimFocusLabel(t, focus)}</option>
                ))}
              </Select>
              <p className="text-xs text-gray-500 dark:text-gray-400">{scrimFocusImpactText(objective)}</p>
              {objective ? (
                <div className="flex flex-wrap items-center gap-2 text-2xs font-heading uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  <span>Main growth:</span>
                  {objectiveGrowth.primary.map((tag) => (
                    <span key={`primary-${tag}`}>{tag} +</span>
                  ))}
                  <span>· Secondary:</span>
                  {objectiveGrowth.secondary.map((tag) => (
                    <span key={`secondary-${tag}`}>{tag} +</span>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="space-y-2">
              <p className="text-xs font-heading font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                {t("scrims.weeklyVolume")}
              </p>
              <div className="flex flex-wrap gap-2">
                {SCRIM_SLOT_OPTIONS.map((slots) => (
                  <button
                    key={slots}
                    type="button"
                    disabled={isSaving || setupLocked || assistantControls}
                    onClick={() => void handleSetWeeklyCapacity(slots)}
                    className={`rounded-lg border px-3 py-2 text-sm font-heading font-bold uppercase tracking-wider transition-colors ${
                      weeklyCapacity === slots
                        ? "border-primary-500 bg-primary-500 text-white"
                        : "border-gray-200 text-gray-600 hover:border-gray-300 dark:border-navy-600 dark:text-gray-300 dark:hover:border-navy-500"
                    }`}
                  >
                    {slots}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3 dark:border-navy-700">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {setupLocked
                ? t("scrims.setupLocked", "Weekly setup is locked until next week.")
                : assistantControls
                  ? "Assistant Coach is handling scrims automatically this week."
                  : t("scrims.setupUnlockWindow", "You can set objective, volume, and rivals before the first scrim block this week.")}
            </p>
            <button
              type="button"
              disabled={isSaving || setupLocked || assistantControls}
              onClick={() => void handleFinalizeSetup()}
              className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-heading font-bold uppercase tracking-wider text-gray-700 transition-colors hover:border-gray-300 disabled:opacity-60 dark:border-navy-600 dark:text-gray-200 dark:hover:border-navy-500"
            >
              {t("scrims.finalizeSetup", "Lock weekly choices")}
            </button>
          </div>
          {staffSuggestions.length > 0 ? (
            <div className="mt-4 border-t border-gray-100 pt-3 dark:border-navy-700">
              <p className="mb-2 inline-flex items-center gap-2 text-xs font-heading font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                <Lightbulb className="h-4 w-4" />
                {t("training.scrims.staffSuggestions", "Sugerencias del staff")}
              </p>
              <div className="grid gap-2 md:grid-cols-2">
                {staffSuggestions.slice(0, 2).map((suggestion) => (
                  <p key={suggestion} className="rounded-xl border border-gray-200 bg-transparent p-3 text-sm leading-relaxed text-gray-600 dark:border-navy-600 dark:text-gray-300">
                    {suggestion}
                  </p>
                ))}
              </div>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <ScrimPlanningCard
        gameState={gameState}
        weeklyContext={weeklyContext}
        onGameUpdate={onGameUpdate}
        isSaving={isSaving}
        setIsSaving={setIsSaving}
        readOnly={assistantControls || setupLocked}
      />

        </div>

        <aside className="flex flex-col gap-5 xl:sticky xl:top-4 xl:self-start">
      <Card>
        <CardHeader>{t("scrims.assistantCoach", "Assistant Coach")}</CardHeader>
        <CardBody>
          <div className="rounded-xl border border-gray-200 p-3 dark:border-navy-600">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-heading font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">
                {t("scrims.delegation", "Scrim delegation")}
              </p>
              <button
                type="button"
                onClick={() => void updateSettings({ scrim_review_mode: settings.scrim_review_mode === "assistant" ? "manual" : "assistant" })}
                className={`rounded-lg border px-3 py-1 text-xs font-heading font-bold uppercase tracking-wider ${settings.scrim_review_mode === "assistant" ? "border-primary-500 bg-primary-500 text-white" : "border-gray-200 text-gray-700 dark:border-navy-600 dark:text-gray-300"}`}
              >
                {settings.scrim_review_mode === "assistant" ? "Assistant" : "Manual"}
              </button>
            </div>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              {t("scrims.assistantModeHint", "In Assistant mode, Continue advances 1 day and staff resolves scrim decisions automatically.")}
            </p>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>{t("scrims.todayBlock", "Today's block")}</CardHeader>
        <CardBody>
          <div className="rounded-lg border border-gray-200 bg-transparent p-3 text-sm text-gray-700 dark:border-navy-600 dark:text-gray-200">
            <p>
              {todayContext.state === "PlayedNeedsReview"
                ? t("scrims.todayNeedsReview", "Today's scrim was played and is waiting for a review decision.")
                : todayContext.state === "Reviewed"
                  ? t("scrims.todayReviewed", "Today's review was already applied. Continue with prep/training.")
                  : todayContext.state === "Planned"
                    ? t("scrims.todayPlanned", "A scrim is planned today. Confirm Plan A/B/C still makes sense.")
                    : todayContext.state === "Cancelled"
                      ? t("scrims.todayCancelled", "Today's scrim block was cancelled. Prioritize recovery or drills.")
                      : t("scrims.todayNoScrim", "No active scrim today. Adjust your weekly plan with intent.")}
            </p>
            {todayOpponentName ? (
              <div className="mt-3 flex items-center gap-3 rounded-xl border border-gray-200 bg-transparent p-3 dark:border-navy-600">
                {(todayContext.resolvedOpponentTeamId ?? todayContext.opponentTeamId) ? (
                  <img
                    src={scrimOpponentLogo(gameState.teams, (todayContext.resolvedOpponentTeamId ?? todayContext.opponentTeamId) as string)}
                    alt={`${todayOpponentName} logo`}
                    className="h-9 w-9 shrink-0 rounded-lg bg-black/20 object-contain p-1"
                    loading="lazy"
                    onError={(event) => {
                      event.currentTarget.style.display = "none";
                    }}
                  />
                ) : null}
                <div className="min-w-0">
                  <p className="text-2xs font-heading font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    {t("scrims.todayOpponent", "Today's rival")}
                  </p>
                  <p className="truncate font-heading text-sm font-bold uppercase tracking-wide text-gray-900 dark:text-white">
                    {todayOpponentName}
                  </p>
                </div>
              </div>
            ) : null}
            {todayContext.state === "Planned" ? (
              <div className="mt-3 space-y-1 text-xs">
                <p>
                  {t("scrims.todayRisk", "Risk")}: <strong>{todayRisk}</strong>
                  {estimatedTodayGap > 0 ? ` · Gap OVR +${estimatedTodayGap}` : ""}
                  {estimatedRepGap > 0 ? ` · Gap rep +${estimatedRepGap}` : ""}
                </p>
                <p>
                  {t("scrims.todayLearning", "Learning value")}: <strong>{todayLearning}</strong>
                </p>
                <p>
                  {t("scrims.todayCancelCost", "Cancel cost")}: <strong>-{cancelCost} scrim rep</strong>
                </p>
              </div>
            ) : null}
            {(todayContext.state === "PlayedNeedsReview" || todayContext.state === "Reviewed") && todayContext.report ? (
              <div className="mt-3 rounded-lg border border-gray-200 bg-transparent p-4 text-sm dark:border-navy-600">
                <p className="font-heading text-xs font-bold uppercase tracking-wider text-gray-300">
                  {t("scrims.postScrimFeedback", "Post-scrim feedback")}
                </p>
                <p className="mt-1 text-gray-900 dark:text-gray-100">
                  {todayContext.report.won
                    ? t("scrims.reviewWin", {
                        team: todayOpponentName ?? todayContext.report.opponent_team_id,
                        defaultValue: "Win vs {{team}}",
                      })
                    : t("scrims.reviewLoss", {
                        team: todayOpponentName ?? todayContext.report.opponent_team_id,
                        defaultValue: "Loss vs {{team}}",
                      })}
                  {` · ${t("scrims.reportQuality", "Quality")}: ${todayContext.report.quality}`}
                </p>
                <p className="mt-1 text-gray-900 dark:text-gray-100">
                  {t("scrims.reportFocus", "Focus")}: {todayContext.report.focus}
                  {todayContext.report.issue ? ` · ${t("scrims.detectedIssue", "Detected issue")}: ${todayContext.report.issue}` : ""}
                </p>
                {todayContext.state === "PlayedNeedsReview" && reviewPhaseActive ? (
                  <p className="mt-2 text-gray-600 dark:text-gray-300">
                    {t("scrims.postScrimNextActionReview", "Next action: choose a review decision in Home to turn this block into concrete progress.")}
                  </p>
                ) : (
                  <p className="mt-2 text-gray-600 dark:text-gray-300">
                    {t("scrims.postScrimNextActionContinue", "Review already applied: use this feedback to adjust rival and focus for the next block.")}
                  </p>
                )}
                {todayContext.state === "PlayedNeedsReview" && reviewPhaseActive ? (
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    {isFirstBlock
                      ? showCancelFollowups
                        ? "Block 1/2: now choose the technical follow-up to close the day."
                        : "Block 1/2: first decide whether to keep pressure or cancel scrims."
                      : "Block 2/2: close the day with recovery or targeted work."}
                  </p>
                ) : null}
                {todayContext.state === "PlayedNeedsReview" && reviewPhaseActive ? (
                  <div className="mt-3 grid gap-3">
                    {decisionOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        disabled={decisionSaving !== null}
                        onClick={() => void handleReviewDecision(option.id)}
                      className="rounded-xl border-2 border-gray-200 bg-transparent p-4 text-left transition-all hover:border-gray-300 disabled:opacity-60 dark:border-navy-600 dark:hover:border-navy-500"
                      >
                        <span className="block font-heading text-sm font-bold uppercase tracking-wider text-gray-800 dark:text-gray-200">
                          {decisionSaving === option.id ? t("common.saving", "Guardando") : option.label}
                        </span>
                        <span className="mt-1 block text-xs leading-snug text-gray-500 dark:text-gray-400">{option.description}</span>
                        <span className="mt-3 flex flex-wrap gap-2">
                          {decisionImpactTags[option.id].map((tag) => (
                            <span
                              key={tag}
                              className="text-2xs font-heading uppercase tracking-wider text-gray-500 dark:text-gray-400"
                            >
                              {tag}
                            </span>
                          ))}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
                {decisionFeedback ? (
                  <p className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-gray-700 dark:border-navy-600 dark:bg-navy-800/40 dark:text-gray-300">
                    {decisionFeedback}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>{t("scrims.weeklyReportInline", "Weekly summary")}</CardHeader>
        <CardBody>
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-xs font-heading font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                {t("scrims.recentReports", "Recent reports")}
              </p>
              {latestReports.length > 0 ? (
                <div className="space-y-2">
                  {latestReports.map((report) => (
                    <div
                      key={`${report.week_key}-${report.slot_index}`}
                      className="rounded-xl border border-gray-200 bg-transparent p-3 dark:border-navy-600"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <img
                            src={scrimOpponentLogo(gameState.teams, report.opponent_team_id)}
                            alt={`${teamNameById.get(report.opponent_team_id) ?? report.opponent_team_id} logo`}
                            className="h-7 w-7 shrink-0 rounded bg-black/20 object-contain p-1"
                            loading="lazy"
                            onError={(event) => {
                              event.currentTarget.style.display = "none";
                            }}
                          />
                          <p className="truncate font-heading text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300">
                            {teamNameById.get(report.opponent_team_id) ?? report.opponent_team_id}
                          </p>
                        </div>
                        <span className="shrink-0 text-2xs font-heading font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                          {report.won ? "W" : "L"}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                        {t("scrims.reportFocus", "Foco")}: {report.focus} · {t("scrims.reportQuality", "Calidad")}: {report.quality}
                      </p>
                      {report.issue ? (
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          {t("scrims.detectedIssue", "Problema detectado")}: {report.issue}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">{t("scrims.noRecentReports", "No reports yet this week.")}</p>
              )}
            </div>
            <div className="rounded-xl border border-gray-200 bg-transparent p-3 dark:border-navy-600">
              {weeklyContext.avgQuality > 0 ? (
                <>
                  <p className="font-heading text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    {weeklyOutcome}
                  </p>
                  <p className="mt-2 text-sm text-gray-700 dark:text-gray-200">
                    {t("training.scrims.weeklyObjective", "Weekly objective")}: <strong>{weeklyContext.objective ?? t("training.scrims.objectives.none", "No objective set")}</strong>
                  </p>
                  <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                    {wins}-{losses} · {t("scrims.played", "Jugadas")}: {played} · {t("scrims.reportQuality", "Calidad")}: {weeklyContext.avgQuality}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="text-2xs font-heading uppercase tracking-wider text-gray-500 dark:text-gray-400">{weeklyMainGain}</span>
                    <span className="text-2xs font-heading uppercase tracking-wider text-gray-500 dark:text-gray-400">{weeklyMainFailure}</span>
                  </div>
                </>
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">{t("scrims.noWeeklyReportYet", "Complete scrims to generate the weekly summary.")}</p>
              )}
            </div>
          </div>
        </CardBody>
      </Card>
        </aside>
      </div>
    </div>
  );
}

