import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Brain,
  CalendarDays,
  Lightbulb,
  Swords,
  Target,
  TrendingUp,
  Video,
  Zap,
  type LucideIcon,
} from "lucide-react";

import type { GameStateData, ScrimFocus } from "@/store/gameStore";
import {
  buildStaffSuggestions,
  buildScrimPlanSignals as deriveScrimPlanSignals,
  deriveDailyScrimBlockMeta,
  deriveTodayScrimContext,
  deriveWeeklyScrimContext,
  effectiveWeeklyScrimSlots,
} from "@/lib/scrims/scrimContext";
import {
  chooseDailyScrimAction,
  finalizeWeeklyScrimSetup,
  setWeeklyScrimObjective,
  setWeeklyScrimSlots,
  type DailyScrimAction,
} from "@/services/trainingService";
import { SCRIM_FOCUS_IMPACT_KEYS, SCRIM_FOCUS_OBJECTIVE_KEYS } from "@/lib/scrims/scrimFocusKeys";
import { useScrimContextWithFallback } from "@/hooks/useScrimContextWithFallback";
import { useSettingsStore } from "@/store/settingsStore";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui-v2/components/ui/card";
import { Badge } from "@/ui-v2/components/ui/badge";
import { cn } from "@/ui-v2/lib/utils";
import ScrimPlanningCardV2 from "./ScrimPlanningCardV2";

interface ScrimsTabV2Props {
  gameState: GameStateData;
  onGameUpdate: (state: GameStateData) => void;
}

const SCRIM_SLOT_OPTIONS = [2, 4, 6];
const ALLOW_SCRIM_CONTEXT_FALLBACK = true;
const SCRIM_OBJECTIVES: ScrimFocus[] = ["DraftPrep", "ChampionPool", "EarlyGame", "Teamfighting", "Macro", "Mental"];

function scrimFocusLabel(t: ReturnType<typeof useTranslation>["t"], focus: ScrimFocus): string {
  return t(SCRIM_FOCUS_OBJECTIVE_KEYS[focus]);
}

function scrimFocusImpactText(t: ReturnType<typeof useTranslation>["t"], focus: ScrimFocus | null): string {
  if (!focus) return t("scrims.noFocusImpactText");
  return t(SCRIM_FOCUS_IMPACT_KEYS[focus]);
}

type RiskLevel = "high" | "medium" | "low";

function riskLevel(opponentOvr: number, ownOvr: number, repGap: number): RiskLevel {
  if (opponentOvr >= 80) return "high";
  if (opponentOvr >= 77) return "medium";
  return Math.max(opponentOvr - ownOvr, Math.round(repGap / 4)) >= 4 ? "high" : Math.max(opponentOvr - ownOvr, Math.round(repGap / 4)) >= 2 ? "medium" : "low";
}

function riskColor(risk: RiskLevel): string {
  switch (risk) {
    case "high": return "text-negative border-negative/30 bg-negative/10";
    case "medium": return "text-warning border-warning/30 bg-warning/10";
    case "low": return "text-positive border-positive/30 bg-positive/10";
  }
}

function stateBorder(state: string): string {
  switch (state) {
    case "PlayedNeedsReview": return "border-warning/30 bg-warning/5";
    case "Reviewed": return "border-positive/30 bg-positive/5";
    case "Planned": return "border-primary/30 bg-primary/5";
    case "Cancelled": return "border-negative/30 bg-negative/5";
    default: return "border-border bg-muted/20";
  }
}

function stateIcon(state: string): LucideIcon {
  switch (state) {
    case "PlayedNeedsReview": return TrendingUp;
    case "Reviewed": return Zap;
    case "Planned": return Swords;
    case "Cancelled": return Lightbulb;
    default: return CalendarDays;
  }
}

const DECISION_META: Record<DailyScrimAction, { icon: LucideIcon; color: string }> = {
  ContinueToBlock2: { icon: TrendingUp, color: "text-positive" },
  OfferRest: { icon: Brain, color: "text-info" },
  PushThrough: { icon: Zap, color: "text-warning" },
  CancelScrims: { icon: Lightbulb, color: "text-negative" },
  VodReview: { icon: Video, color: "text-purple-400" },
  MentalReset: { icon: Brain, color: "text-cyan-400" },
  TargetedDrills: { icon: Target, color: "text-orange-400" },
  DayOff: { icon: CalendarDays, color: "text-muted-foreground" },
};

export function ScrimsTabV2({ gameState, onGameUpdate }: ScrimsTabV2Props) {
  const { t } = useTranslation();
  const { settings, updateSettings } = useSettingsStore();
  const [isSaving, setIsSaving] = useState(false);
  const [decisionSaving, setDecisionSaving] = useState<string | null>(null);
  const [decisionFeedback, setDecisionFeedback] = useState<string | null>(null);
  const [showCancelFollowups, setShowCancelFollowups] = useState(false);
  const remoteScrimContext = useScrimContextWithFallback(gameState);
  const myTeam = gameState.teams.find((t) => t.id === gameState.manager.team_id);

  if (!myTeam) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="font-heading text-sm uppercase tracking-wider text-muted-foreground">{t("common.noTeam")}</p>
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

  const weeklyCapacity = weeklyContext.capacity;
  const plannedScrims = weeklyContext.planned;
  const played = weeklyContext.played;
  const wins = weeklyContext.wins;
  const losses = weeklyContext.losses;
  const objective = weeklyContext.objective;
  const teamNameById = new Map(gameState.teams.map((t) => [t.id, t.name]));
  const latestReports = weeklyContext.latestReports.slice(0, 3);
  const todayOpponentName = (() => {
    const c = todayContext.resolvedOpponentTeamId ?? todayContext.opponentTeamId;
    return c ? teamNameById.get(c) ?? c : null;
  })();
  const planSignals = deriveScrimPlanSignals(gameState, myTeam.id, weeklyContext);
  const estimatedRepGap = todayContext.opponentTeamId ? Math.max(0, planSignals.avgOpponentScrimReputation - weeklyContext.reputation) : 0;
  const todayRisk = riskLevel(planSignals.maxOpponentOvr, planSignals.ownOvr, estimatedRepGap);
  const setupLocked = weeklyContext.setupLocked;
  const assistantControls = settings.scrim_review_mode === "assistant";
  const dailyBlockMeta = todayContext.report ? deriveDailyScrimBlockMeta(effectiveWeeklyScrimSlots(myTeam), gameState.clock.current_date, todayContext.report.slot_index) : null;
  const isFirstBlock = dailyBlockMeta?.blockNumber === 1;
  const staffSuggestions = buildStaffSuggestions(
    (key, fb) => t(key, { defaultValue: fb }), objective, weeklyCapacity, latestReports,
    weeklyContext.lossStreak, weeklyContext.cancellations, planSignals, weeklyContext.reputation,
  );

  const decisionOptions: Array<{ id: DailyScrimAction; label: string; description: string }> = (() => {
    if (!todayContext.report) return [];
    if (isFirstBlock && !todayContext.report.won && !showCancelFollowups) {
      return [
        { id: "PushThrough", label: t("scrims.decision.pushThrough"), description: t("scrims.decision.pushThroughDesc") },
        { id: "CancelScrims", label: t("scrims.decision.cancelScrims"), description: t("scrims.decision.cancelScrimsDesc") },
      ];
    }
    if (isFirstBlock && todayContext.report.won) {
      return [
        { id: "ContinueToBlock2", label: t("scrims.decision.continueBlock2"), description: t("scrims.decision.continueBlock2Desc") },
        { id: "OfferRest", label: t("scrims.decision.offerRest"), description: t("scrims.decision.offerRestDesc") },
      ];
    }
    if (showCancelFollowups) {
      return [
        { id: "VodReview", label: t("scrims.decision.vodReview"), description: t("scrims.decision.vodReviewDesc") },
        { id: "MentalReset", label: t("scrims.decision.mentalReset"), description: t("scrims.decision.mentalResetDesc") },
        { id: "TargetedDrills", label: t("scrims.decision.targetedDrills"), description: t("scrims.decision.targetedDrillsDesc") },
      ];
    }
    return [
      { id: "DayOff", label: t("scrims.decision.dayOff"), description: t("scrims.decision.dayOffDesc") },
      { id: "VodReview", label: t("scrims.decision.vodReview"), description: t("scrims.decision.vodReviewDesc") },
      { id: "MentalReset", label: t("scrims.decision.mentalReset"), description: t("scrims.decision.mentalResetDesc") },
      { id: "TargetedDrills", label: t("scrims.decision.targetedDrills"), description: t("scrims.decision.targetedDrillsDesc") },
    ];
  })();

  const decisionImpactTags: Record<DailyScrimAction, string[]> = {
    ContinueToBlock2: [t("scrims.tags.momentumPlus"), t("scrims.tags.fatigueMinus"), t("scrims.tags.volumePlus")],
    OfferRest: [t("scrims.tags.recoveryPlus"), t("scrims.tags.fatiguePlus"), t("scrims.tags.volumeMinus")],
    PushThrough: [t("scrims.tags.volumePlus"), t("scrims.tags.learningPlus"), t("scrims.tags.mentalMinus")],
    CancelScrims: [t("scrims.tags.recoveryPlus"), t("scrims.tags.riskMinus"), t("scrims.tags.volumeMinus")],
    VodReview: [t("scrims.tags.analysisPlus"), t("scrims.tags.qualityPlus"), t("scrims.tags.recoveryMinus")],
    MentalReset: [t("scrims.tags.mentalPlus"), t("scrims.tags.recoveryPlus"), t("scrims.tags.techniqueMinus")],
    TargetedDrills: [t("scrims.tags.issuePlus"), t("scrims.tags.mechanicsPlus"), t("scrims.tags.fatigueMinus")],
    DayOff: [t("scrims.tags.recoveryPlus"), t("scrims.tags.mentalPlus"), t("scrims.tags.volumeMinus")],
  };

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
    if (!todayContext.report) return;
    if (decision === "CancelScrims") { setShowCancelFollowups(true); setDecisionFeedback(t("scrims.cancelFollowupPrompt")); return; }
    setDecisionSaving(decision);
    setDecisionFeedback(null);
    try {
      const updated = await chooseDailyScrimAction(todayContext.report.slot_index, decision);
      onGameUpdate(updated);
      setDecisionFeedback(t("scrims.reviewDecisionApplied"));
      setShowCancelFollowups(false);
    } catch (e) { console.error(e); }
    finally { setDecisionSaving(null); }
  };

  const todayState = todayContext.state;
  const StateIcon = stateIcon(todayState);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-6 scrollbar-v2">


      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_360px]">
        {/* ── Main column ── */}
        <div className="flex flex-col gap-4">
          <ScrimPlanningCardV2
            gameState={gameState}
            weeklyContext={weeklyContext}
            onGameUpdate={onGameUpdate}
            isSaving={isSaving}
            setIsSaving={setIsSaving}
            readOnly={assistantControls || setupLocked}
          />
        </div>

        {/* ── Sidebar ── */}
        <aside className="flex flex-col gap-4 xl:sticky xl:top-4 xl:self-start">
          {/* Assistant coach */}
          <Card>
            <CardHeader className="space-y-0">
              <CardTitle className="flex items-center gap-2 font-heading text-sm uppercase tracking-widest text-muted-foreground">
                <Brain className="size-4" />
                {t("scrims.assistantCoach")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 p-3">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{t("scrims.delegation")}</p>
                  <p className="mt-0.5 font-heading text-2xs uppercase tracking-wider text-muted-foreground/60">
                    {settings.scrim_review_mode === "assistant" ? t("scrims.autoMode") : t("scrims.manualControl")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => updateSettings({ scrim_review_mode: settings.scrim_review_mode === "assistant" ? "manual" : "assistant" })}
                  className={cn(
                    "shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                    settings.scrim_review_mode === "assistant"
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {settings.scrim_review_mode === "assistant" ? t("scrims.assistantLabel") : t("scrims.manualLabel")}
                </button>
              </div>
            </CardContent>
          </Card>

          {/* ── Gauges ── */}
          <Card>
            <CardContent className="flex flex-col gap-4 py-4 md:flex-row md:items-center md:justify-between">
              <div className="flex w-full gap-1.5">
                {/* Planned gauge */}
                <div className="flex-1 min-w-0 rounded-lg border border-border bg-muted/30 px-2 py-2 text-center">
                  <p className="font-heading text-base font-bold text-foreground tabular-nums">{plannedScrims}/{weeklyCapacity}</p>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${weeklyCapacity > 0 ? (plannedScrims / weeklyCapacity) * 100 : 0}%` }}
                    />
                  </div>
                  <p className="mt-1 font-heading text-2xs uppercase tracking-wider text-muted-foreground">{t("scrims.planned")}</p>
                </div>
                {/* W/L gauge */}
                <div className="flex-1 min-w-0 rounded-lg border border-border bg-muted/30 px-2 py-2 text-center">
                  <p className="font-heading text-base font-bold tabular-nums">
                    <span className="text-positive">{wins}</span>
                    <span className="text-muted-foreground/40">-</span>
                    <span className="text-negative">{losses}</span>
                  </p>
                  <div className="mt-1 flex h-1 overflow-hidden rounded-full bg-muted">
                    {played > 0 && (
                      <>
                        <div className="h-full bg-positive transition-all" style={{ width: `${(wins / played) * 100}%` }} />
                        <div className="h-full bg-negative transition-all" style={{ width: `${(losses / played) * 100}%` }} />
                      </>
                    )}
                  </div>
                  <p className="mt-1 font-heading text-2xs uppercase tracking-wider text-muted-foreground">{t("scrims.weekRecord")}</p>
                </div>
                {/* Rep gauge */}
                <div className="flex-1 min-w-0 rounded-lg border border-border bg-muted/30 px-2 py-2 text-center">
                  <p className="font-heading text-base font-bold text-foreground tabular-nums">{weeklyContext.reputation}</p>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-amber-400 transition-all"
                      style={{ width: `${Math.min(100, weeklyContext.reputation * 10)}%` }}
                    />
                  </div>
                  <p className="mt-1 font-heading text-2xs uppercase tracking-wider text-muted-foreground">{t("scrims.reputation")}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Weekly setup */}
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="font-heading text-sm uppercase tracking-widest text-muted-foreground">
                <Target className="mr-1.5 inline size-4" />
                {t("scrims.weeklySetup")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-4 md:flex-row md:items-end">
                <div className="flex-1 space-y-2">
                  <label className="font-heading text-2xs font-bold uppercase tracking-wider text-muted-foreground">
                    <Target className="mr-1 inline size-3.5" />
                    {t("training.scrims.weeklyObjective")}
                  </label>
                  <select
                    value={objective ?? ""}
                    onChange={(e) => handleSetObjective((e.target.value || null) as ScrimFocus | null)}
                    disabled={isSaving || setupLocked || assistantControls}
                    className="w-full rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-xs text-foreground disabled:opacity-50"
                  >
                    <option value="">{t("training.scrims.objectives.none")}</option>
                    {SCRIM_OBJECTIVES.map((f) => (
                      <option key={f} value={f}>{scrimFocusLabel(t, f)}</option>
                    ))}
                  </select>
                  {objective && <p className="text-xs text-muted-foreground">{scrimFocusImpactText(t, objective)}</p>}
                </div>
                <div className="space-y-2">
                  <p className="font-heading text-2xs font-bold uppercase tracking-wider text-muted-foreground">{t("scrims.weeklyVolume")}</p>
                  <div className="flex gap-2">
                    {SCRIM_SLOT_OPTIONS.map((slots) => (
                      <button
                        key={slots}
                        type="button"
                        disabled={isSaving || setupLocked || assistantControls}
                        onClick={() => handleSetWeeklyCapacity(slots)}
                        className={cn(
                          "rounded-md border px-3 py-1.5 font-heading text-xs font-bold uppercase tracking-wider transition-colors",
                          weeklyCapacity === slots
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border text-muted-foreground hover:border-primary/50",
                        )}
                      >
                        {slots}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                <p className="text-xs text-muted-foreground">
                  {setupLocked ? t("scrims.setupLocked") : assistantControls ? t("scrims.assistantHandling") : t("scrims.setupUnlockWindow")}
                </p>
                <button
                  type="button"
                  disabled={isSaving || setupLocked || assistantControls}
                  onClick={handleFinalizeSetup}
                  className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
                >
                  {t("scrims.finalizeSetup")}
                </button>
              </div>
              {staffSuggestions.length > 0 && (
                <div className="mt-4 border-t border-border pt-3">
                  <p className="mb-2 flex items-center gap-1 text-2xs font-bold uppercase tracking-wider text-muted-foreground">
                    <Lightbulb className="size-3.5" />
                    {t("training.scrims.staffSuggestions")}
                  </p>
                  <div className="grid gap-2 md:grid-cols-2">
                    {staffSuggestions.slice(0, 2).map((s, i) => (
                      <p key={i} className="rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">{s}</p>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
          {/* Today's block */}
          <Card className={stateBorder(todayState)}>
            <CardHeader className="space-y-0">
              <CardTitle className="flex items-center gap-2 font-heading text-sm uppercase tracking-widest text-muted-foreground">
                <StateIcon className="size-4" />
                {t("scrims.todayBlock")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {/* State badge */}
                <div className="flex items-center gap-2">
                  {todayState === "PlayedNeedsReview" && <Badge className="border-warning/30 bg-warning/10 text-warning">{t("scrims.pendingReview")}</Badge>}
                  {todayState === "Reviewed" && <Badge className="border-positive/30 bg-positive/10 text-positive">{t("scrims.reviewed")}</Badge>}
                  {todayState === "Planned" && <Badge className="border-primary/30 bg-primary/10 text-club-text">{t("scrims.planned")}</Badge>}
                  {todayState === "Cancelled" && <Badge className="border-negative/30 bg-negative/10 text-negative">{t("scrims.cancelled")}</Badge>}
                  {todayState !== "PlayedNeedsReview" && todayState !== "Reviewed" && todayState !== "Planned" && todayState !== "Cancelled" && (
                    <Badge variant="outline" className="text-muted-foreground">{t("scrims.noScrim")}</Badge>
                  )}
                </div>

                {todayOpponentName && (
                  <div className="rounded-lg border border-border bg-muted/20 p-3">
                    <p className="font-heading text-2xs uppercase tracking-wider text-muted-foreground">{t("scrims.todayOpponent")}</p>
                    <p className="font-heading text-sm font-bold uppercase tracking-wide text-foreground">{todayOpponentName}</p>
                    {todayContext.state === "Planned" && (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{t("scrims.todayRisk")}:</span>
                        <span className={cn("rounded-md border px-1.5 py-0.5 text-2xs font-bold uppercase tracking-wider", riskColor(todayRisk))}>
                          {t(`scrims.risk.${todayRisk}`)}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Post-scrim review decisions */}
                {todayContext.state === "PlayedNeedsReview" && todayContext.report && todayContext.canReview && (
                  <div className="space-y-2">
                    <p className="font-heading text-2xs font-bold uppercase tracking-wider text-muted-foreground">
                      {isFirstBlock ? (showCancelFollowups ? t("scrims.cancelFollowupTitle") : t("scrims.blockDecisionTitle")) : t("scrims.closeDayTitle")}
                    </p>
                    {decisionOptions.map((opt) => {
                      const meta = DECISION_META[opt.id];
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          disabled={decisionSaving !== null}
                          onClick={() => handleReviewDecision(opt.id)}
                          className={cn(
                            "group relative w-full overflow-hidden rounded-xl border-2 p-3 text-left transition-all",
                            "hover:border-primary/50",
                            decisionSaving === opt.id && "pointer-events-none opacity-50",
                          )}
                        >
                          <div className="flex items-start gap-3">
                            <div className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/30", meta.color)}>
                              <meta.icon className="size-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="font-heading text-xs font-bold uppercase tracking-wider text-foreground">
                                {decisionSaving === opt.id ? t("common.saving") : opt.label}
                              </p>
                              <p className="mt-0.5 text-xs text-muted-foreground">{opt.description}</p>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {decisionImpactTags[opt.id].map((tag) => (
                                  <Badge
                                    key={tag}
                                    variant="outline"
                                    className={cn(
                                      "text-2xs",
                                      tag.includes("+") ? "border-positive/20 text-positive" : "border-negative/20 text-negative",
                                    )}
                                  >
                                    {tag}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {decisionFeedback && (
                  <p className="rounded-md bg-primary/10 px-2 py-1 text-xs text-club-text">{decisionFeedback}</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Weekly summary */}
          <Card>
            <CardHeader className="space-y-0">
              <CardTitle className="flex items-center gap-2 font-heading text-sm uppercase tracking-widest text-muted-foreground">
                <TrendingUp className="size-4" />
                {t("scrims.weeklyReportInline")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {/* W/L sparkline */}
                {played > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-heading text-2xs font-bold uppercase tracking-wider text-muted-foreground">
                        {t("scrims.streaks")}
                      </span>
                      <span className="font-heading text-2xs tabular-nums text-muted-foreground/60">
                        {t("scrims.played")}: {played}
                      </span>
                    </div>
                    <div className="flex h-4 gap-0.5 overflow-hidden rounded-md">
                      {latestReports.slice(0, 7).map((r, i) => (
                        <div
                          key={`${r.week_key}-${r.slot_index}-${i}`}
                          className={cn(
                            "flex-1 rounded-sm transition-all",
                            r.won ? "bg-positive/60" : "bg-negative/60",
                          )}
                          title={`${teamNameById.get(r.opponent_team_id) ?? r.opponent_team_id}: ${r.won ? "W" : "L"}`}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Recent reports */}
                <div>
                  <p className="mb-2 font-heading text-2xs font-bold uppercase tracking-wider text-muted-foreground">
                    {t("scrims.recentReports")}
                  </p>
                  {latestReports.length > 0 ? (
                    <div className="space-y-2">
                      {latestReports.map((r) => (
                        <div key={`${r.week_key}-${r.slot_index}`} className="rounded-lg border border-border bg-muted/20 p-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs font-medium text-foreground">
                              {teamNameById.get(r.opponent_team_id) ?? r.opponent_team_id}
                            </p>
                            <span className={cn("text-2xs font-bold", r.won ? "text-positive" : "text-negative")}>
                              {r.won ? "W" : "L"}
                            </span>
                          </div>
                          <p className="mt-0.5 text-2xs text-muted-foreground">{scrimFocusLabel(t, r.focus)} · Q{r.quality}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">{t("scrims.noRecentReports")}</p>
                  )}
                </div>

                {/* Quality & objective */}
                {weeklyContext.avgQuality > 0 && (
                  <div className="rounded-lg border border-border bg-muted/20 p-3">
                    <div className="flex items-center justify-between">
                      <p className="font-heading text-2xs font-bold uppercase tracking-wider text-foreground">{t("scrims.weeklyObjective")}</p>
                      <span className="font-heading text-2xs tabular-nums text-muted-foreground">Q: {weeklyContext.avgQuality}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="flex-1">
                        <p className="text-xs text-muted-foreground">{wins}-{losses}</p>
                      </div>
                      {weeklyContext.lossStreak > 1 && (
                        <Badge className="border-negative/30 bg-negative/10 text-2xs text-negative">
                          {t("scrims.lossStreak", { count: weeklyContext.lossStreak })}
                        </Badge>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
