import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { GameStateData } from "../store/gameStore";
import { useGameStore } from "../store/gameStore";
import i18n from "@/i18n";
import { latestUserMatchSummary, type BlockerModal } from "./useAdvanceTime.helpers";
import {
  SCRIM_DECISION_BLOCKER_ID,
  SCRIM_SETUP_BLOCKER_ID,
  buildBlockerModal,
  resolveAdvanceMode,
} from "../lib/home/blockerRules";
import { scrimBlockerText } from "../lib/home/scrimBlockerText";
import { advanceTimeWithMode, skipToMatchDay } from "../services/advanceTimeService";
import { collectAdvanceBlockers } from "../lib/home/advanceBlockers";
import { autoConfigureWeeklyScrimSetup, delegateScrimDecision } from "../services/trainingService";
import { effectiveWeeklyScrimSlots, scrimSlotWeekdays, weekdayMondayBased } from "../lib/scrims/scrimContext";

export type MatchModeType = "live" | "spectator" | "delegate";

function textAdvanceBlocked(): string {
  return i18n.t("advance.blockers.advanceBlocked", {
    defaultValue: "Could not advance automatically. Review the pending blockers.",
  });
}

function noticeAssistantResolvedDecision(): string {
  return i18n.t("advance.notices.assistantResolvedDecision", {
    defaultValue: "Assistant Coach resolved the post-scrim decision automatically to unblock the advance.",
  });
}

function noticeAssistantConfiguredSetup(): string {
  return i18n.t("advance.notices.assistantConfiguredSetup", {
    defaultValue: "Assistant Coach configured the weekly scrim setup automatically.",
  });
}

function noticeAssistantResolvedDay(didSetup: boolean, didDecision: boolean): string {
  if (didSetup && didDecision) {
    return i18n.t("advance.notices.assistantResolvedDayBoth", {
      defaultValue:
        "Assistant Coach resolved the weekly setup and the post-scrim decision automatically to advance the day.",
    });
  }
  if (didSetup) {
    return i18n.t("advance.notices.assistantResolvedDaySetup", {
      defaultValue: "Assistant Coach resolved the weekly setup automatically to advance the day.",
    });
  }
  return i18n.t("advance.notices.assistantResolvedDayDecision", {
    defaultValue: "Assistant Coach resolved the post-scrim decision automatically to advance the day.",
  });
}

export function useAdvanceTime(
  setGameState: (state: GameStateData) => void,
  hasMatchToday: boolean,
  defaultMatchMode: MatchModeType | undefined,
  scrimReviewMode: "manual" | "assistant",
  settingsLoaded: boolean,
  isUnemployed: boolean,
  seasonOver = false,
) {
  const navigate = useNavigate();
  const setShowFiredModal = useGameStore((s) => s.setShowFiredModal);
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [showContinueMenu, setShowContinueMenu] = useState(false);
  const [showMatchConfirm, setShowMatchConfirm] = useState(false);
  const [matchMode, setMatchMode] = useState<MatchModeType>("live");
  const [blockerModal, setBlockerModal] = useState<BlockerModal | null>(null);
  const [autoDelegationNotice, setAutoDelegationNotice] = useState<string | null>(null);
  const [matchPlayedNotice, setMatchPlayedNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!matchPlayedNotice) return;
    const timer = window.setTimeout(() => setMatchPlayedNotice(null), 8000);
    return () => window.clearTimeout(timer);
  }, [matchPlayedNotice]);

  useEffect(() => {
    if (!autoDelegationNotice) return;
    const timer = window.setTimeout(() => setAutoDelegationNotice(null), 8000);
    return () => window.clearTimeout(timer);
  }, [autoDelegationNotice]);

  // Sync matchMode with settings when loaded
  useEffect(() => {
    if (settingsLoaded && defaultMatchMode) {
      setMatchMode(defaultMatchMode);
    }
  }, [settingsLoaded, defaultMatchMode]);

  function hasScrimsToday(game: GameStateData): boolean {
    const teamId = game.manager?.team_id;
    if (!teamId) return false;
    const team = game.teams.find((candidate) => candidate.id === teamId);
    if (!team) return false;
    const slots = effectiveWeeklyScrimSlots(team);
    const weekdays = scrimSlotWeekdays(slots);
    const todayWeekday = weekdayMondayBased(game.clock.current_date);
    return weekdays.some((d) => d === todayWeekday);
  }

  function shouldFastForwardDay(game: GameStateData): boolean {
    return scrimReviewMode === "assistant" || !hasScrimsToday(game);
  }

  function isAssistantReviewMode(): boolean {
    return scrimReviewMode === "assistant";
  }

  /** The backend pre-check for `mode`; the Assistant Coach's own scrim stops are left out. */
  function collectBlockers(logContext: string, mode: string, includeScrimStops?: boolean) {
    return collectAdvanceBlockers(logContext, {
      mode,
      includeScrimStops,
      assistantResolvesScrims: isAssistantReviewMode(),
    });
  }

  function resetTransientUi(options?: {
    showContinueMenu?: boolean;
    showMatchConfirm?: boolean;
    blockerModal?: BlockerModal | null;
  }): void {
    setShowContinueMenu(options?.showContinueMenu ?? false);
    setShowMatchConfirm(options?.showMatchConfirm ?? false);
    setBlockerModal(options?.blockerModal ?? null);
  }

  const doAdvance = async (effectiveMode: string) => {
    console.info("[useAdvanceTime] doAdvance:start", {
      effectiveMode,
      hasMatchToday,
      matchMode,
    });
    setIsAdvancing(true);
    resetTransientUi();
    try {
      const applyAdvancedResult = async (initial: GameStateData): Promise<void> => {
        let nextGame = initial;
        const startDate = String(nextGame.clock.current_date);
        if (shouldFastForwardDay(nextGame)) {
          for (let i = 0; i < 5; i += 1) {
            if (String(nextGame.clock.current_date) !== startDate) break;
            const step = await advanceTimeWithMode(effectiveMode);
            if (!step || !(step.action === "advanced" || step.action === "phase_advanced") || !step.game) break;
            nextGame = step.game as GameStateData;
          }
        }
        setGameState(nextGame);
      };
      if (scrimReviewMode === "assistant") {
        let baselineDate: string | null = null;
        let didAutoScrimDecision = false;
        let didAutoScrimSetup = false;
        for (let attempt = 0; attempt < 12; attempt += 1) {
          const result = await advanceTimeWithMode(effectiveMode);
          console.info("[useAdvanceTime] doAdvance:assistant-loop", {
            attempt,
            action: result.action,
            date: result.game?.clock?.current_date,
          });

          if (result.action === "fired") {
            if (result.game) setGameState(result.game as GameStateData);
            setShowFiredModal(true);
            return;
          }

          if (result.action === "live_match") {
            navigate("/match", {
              state: {
                fixtureIndex: result.fixture_index,
                mode: result.mode || effectiveMode,
                snapshot: result.snapshot,
              },
            });
            return;
          }

          if ((result.action === "advanced" || result.action === "phase_advanced") && result.game) {
            const game = result.game as GameStateData;
            if (!baselineDate) {
              setGameState(game);
              return;
            }
            setGameState(game);
            if (String(game.clock.current_date) !== baselineDate) {
              if (didAutoScrimSetup || didAutoScrimDecision) {
                setAutoDelegationNotice(noticeAssistantResolvedDay(didAutoScrimSetup, didAutoScrimDecision));
              }
              return;
            }
            continue;
          }

          if (result.action === "blocked_scrim_setup" && result.game) {
            setGameState(result.game as GameStateData);
            const configured = await autoConfigureWeeklyScrimSetup();
            setGameState(configured);
            didAutoScrimSetup = true;
            if (!baselineDate) baselineDate = String(configured.clock.current_date);
            continue;
          }

          if (result.action === "blocked_scrim_decision" && result.game) {
            setGameState(result.game as GameStateData);
            const delegated = await delegateScrimDecision();
            setGameState(delegated);
            didAutoScrimDecision = true;
            if (!baselineDate) baselineDate = String(delegated.clock.current_date);
            continue;
          }

          if (result.action === "season_complete") return;
          if (result.game) setGameState(result.game as GameStateData);
          if (result.action.startsWith("blocked_")) {
            setBlockerModal({
              blockers: [{
                id: "advance_blocked",
                severity: "warn",
                tab: "Home",
                text: textAdvanceBlocked(),
              }],
            });
          }
          return;
        }

        setBlockerModal({
          blockers: [{
            id: "assistant_advance_limit",
            severity: "warn",
            tab: "Scrims",
            text: i18n.t("advance.blockers.assistantLimit", {
              defaultValue: "Assistant Coach reached the automatic advance attempt limit. Review the state manually.",
            }),
          }],
        });
        return;
      }

      const result = await advanceTimeWithMode(effectiveMode);
      console.info("[useAdvanceTime] doAdvance:result", {
        action: result.action,
        fixtureIndex: result.fixture_index,
        mode: result.mode || effectiveMode,
        hasGame: !!result.game,
        hasSnapshot: !!result.snapshot,
      });
      if (result.action === "fired") {
        if (result.game) setGameState(result.game as GameStateData);
        setShowFiredModal(true);
      } else if (result.action === "live_match") {
        navigate("/match", {
          state: {
            fixtureIndex: result.fixture_index,
            mode: result.mode || effectiveMode,
            snapshot: result.snapshot,
          },
        });
      } else if (result.action === "blocked_scrim_decision" && result.game) {
        setGameState(result.game as GameStateData);
        if (isAssistantReviewMode()) {
          try {
            const delegated = await delegateScrimDecision();
            setGameState(delegated);
            setAutoDelegationNotice(noticeAssistantResolvedDecision());
            const retry = await advanceTimeWithMode(effectiveMode);
            if (retry.action === "live_match") {
              navigate("/match", {
                state: {
                  fixtureIndex: retry.fixture_index,
                  mode: retry.mode || effectiveMode,
                  snapshot: retry.snapshot,
                },
              });
            } else if ((retry.action === "advanced" || retry.action === "phase_advanced") && retry.game) {
              await applyAdvancedResult(retry.game as GameStateData);
            } else if (retry.action === "blocked_scrim_decision") {
              setBlockerModal({
                blockers: [{
                  id: SCRIM_DECISION_BLOCKER_ID,
                  severity: "warn",
                  tab: "Scrims",
                  text: i18n.t("advance.blockers.scrimAutoFailed", {
                    defaultValue: "Automatic delegation could not resolve the scrim decision. Review it manually.",
                  }),
                }],
              });
            }
            return;
          } catch (error) {
            console.error("Failed to auto-delegate scrim decision:", error);
          }
        }
        setBlockerModal({
          blockers: [{
            id: SCRIM_DECISION_BLOCKER_ID,
            severity: "warn",
            tab: "Scrims",
            text: scrimBlockerText(SCRIM_DECISION_BLOCKER_ID),
          }],
        });
      } else if (result.action === "blocked_scrim_setup" && result.game) {
        setGameState(result.game as GameStateData);
        if (isAssistantReviewMode()) {
          try {
            const configured = await autoConfigureWeeklyScrimSetup();
            setGameState(configured);
            setAutoDelegationNotice(noticeAssistantConfiguredSetup());
            const retry = await advanceTimeWithMode(effectiveMode);
            if ((retry.action === "advanced" || retry.action === "phase_advanced") && retry.game) {
              await applyAdvancedResult(retry.game as GameStateData);
              return;
            }
          } catch (error) {
            console.error("Failed to auto-configure weekly scrim setup:", error);
          }
        }
        setBlockerModal({
          blockers: [{
            id: SCRIM_SETUP_BLOCKER_ID,
            severity: "warn",
            tab: "Scrims",
            text: scrimBlockerText(SCRIM_SETUP_BLOCKER_ID),
          }],
        });
      } else if ((result.action === "advanced" || result.action === "phase_advanced") && result.game) {
        await applyAdvancedResult(result.game as GameStateData);
      }
    } catch (err) {
      console.error("Failed to advance time:", err);
    } finally {
      console.info("[useAdvanceTime] doAdvance:complete", { effectiveMode });
      setIsAdvancing(false);
    }
  };

  const handleContinue = async (mode?: string) => {
    if (seasonOver) return;
    const effectiveMode = mode || matchMode;
    const resolvedMode = resolveAdvanceMode(isUnemployed, effectiveMode);
    console.info("[useAdvanceTime] handleContinue", {
      effectiveMode: resolvedMode,
      hasMatchToday,
      isAdvancing,
      matchMode,
      showMatchConfirm,
    });
    // If there's a match today, show confirmation modal first
    if (hasMatchToday && !showMatchConfirm) {
      console.info("[useAdvanceTime] handleContinue:showMatchConfirm", {
        effectiveMode: resolvedMode,
      });
      if (mode) setMatchMode(mode as MatchModeType);
      resetTransientUi({ showMatchConfirm: true });
      return;
    }
    if (isAdvancing) return;
    const blockers = await collectBlockers("handleContinue", resolvedMode);
    if (blockers.length > 0) {
      setBlockerModal(buildBlockerModal(blockers, "continue", () => doAdvance(resolvedMode)));
      return;
    }
    doAdvance(resolvedMode);
  };

  const handleConfirmMatch = () => {
    if (seasonOver) return;
    console.info("[useAdvanceTime] handleConfirmMatch", { matchMode });
    doAdvance(matchMode);
  };

  const handleSkipToMatchDay = async () => {
    if (seasonOver || isAdvancing) return;
    console.info("[useAdvanceTime] handleSkipToMatchDay:start");
    // skip_to_match_day never raises the scrim stops, so its pre-check leaves them out.
    const blockers = await collectBlockers(
      "handleSkipToMatchDay",
      resolveAdvanceMode(isUnemployed, matchMode),
      false,
    );
    if (blockers.length > 0) {
      setBlockerModal(buildBlockerModal(blockers, "skipToMatchDay"));
      return;
    }
    doSkipToMatchDay();
  };

  const handleSkipToNextDay = async () => {
    if (seasonOver || isAdvancing) return;
    console.info("[useAdvanceTime] handleSkipToNextDay:start");
    const blockers = await collectBlockers(
      "handleSkipToNextDay",
      resolveAdvanceMode(isUnemployed, matchMode),
    );
    if (blockers.length > 0) {
      setBlockerModal(buildBlockerModal(blockers, "skipToNextDay", doSkipToNextDay));
      return;
    }
    doSkipToNextDay();
  };

  const doSkipToNextDay = async () => {
    console.info("[useAdvanceTime] doSkipToNextDay:start");
    setIsAdvancing(true);
    resetTransientUi();
    try {
      let baselineDate: string | null = null;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const result = await advanceTimeWithMode(resolveAdvanceMode(isUnemployed, matchMode));
        console.info("[useAdvanceTime] doSkipToNextDay:attempt", {
          attempt,
          action: result.action,
          date: result.game?.clock?.current_date,
        });

        if (result.action === "fired") {
          if (result.game) setGameState(result.game as GameStateData);
          setShowFiredModal(true);
          return;
        }

        if (result.action === "live_match") {
          navigate("/match", {
            state: {
              fixtureIndex: result.fixture_index,
              mode: result.mode || matchMode,
              snapshot: result.snapshot,
            },
          });
          return;
        }

        if ((result.action === "advanced" || result.action === "phase_advanced") && result.game) {
          const game = result.game as GameStateData;
          setGameState(game);
          if (!baselineDate) {
            baselineDate = String(game.clock.current_date);
          }
          if (String(game.clock.current_date) !== baselineDate) {
            return;
          }
          continue;
        }

        if (result.action === "blocked_scrim_setup" && result.game) {
          setGameState(result.game as GameStateData);
          if (isAssistantReviewMode()) {
            const configured = await autoConfigureWeeklyScrimSetup();
            setGameState(configured);
            if (!baselineDate) baselineDate = String(configured.clock.current_date);
            continue;
          }
          setBlockerModal({
            blockers: [{
              id: SCRIM_SETUP_BLOCKER_ID,
              severity: "warn",
              tab: "Scrims",
              text: scrimBlockerText(SCRIM_SETUP_BLOCKER_ID),
            }],
          });
          return;
        }

        if (result.action === "blocked_scrim_decision" && result.game) {
          setGameState(result.game as GameStateData);
          if (isAssistantReviewMode()) {
            const delegated = await delegateScrimDecision();
            setGameState(delegated);
            if (!baselineDate) baselineDate = String(delegated.clock.current_date);
            continue;
          }
          setBlockerModal({
            blockers: [{
              id: SCRIM_DECISION_BLOCKER_ID,
              severity: "warn",
              tab: "Scrims",
              text: scrimBlockerText(SCRIM_DECISION_BLOCKER_ID),
            }],
          });
          return;
        }

        if (result.action === "season_complete") return;
        if (result.game) setGameState(result.game as GameStateData);
        if (result.action.startsWith("blocked_")) {
          setBlockerModal({
            blockers: [{
              id: "advance_blocked",
              severity: "warn",
              tab: "Home",
              text: textAdvanceBlocked(),
            }],
          });
        }
        return;
      }
    } catch (err) {
      console.error("Failed to skip to next day:", err);
    } finally {
      console.info("[useAdvanceTime] doSkipToNextDay:complete");
      setIsAdvancing(false);
    }
  };

  const doSkipToMatchDay = async () => {
    console.info("[useAdvanceTime] doSkipToMatchDay:start");
    setIsAdvancing(true);
    resetTransientUi();
    try {
      const result = await skipToMatchDay();
      console.info("[useAdvanceTime] doSkipToMatchDay:result", {
        action: result.action,
        daysSkipped: result.days_skipped,
        blockerCount: result.blockers?.length ?? 0,
        hasGame: !!result.game,
      });
      if (result.action === "fired") {
        if (result.game) setGameState(result.game as GameStateData);
        setShowFiredModal(true);
        return;
      }
      if (result.game) setGameState(result.game as GameStateData);
      if (result.match_simulated) {
        const summary = result.game ? latestUserMatchSummary(result.game as GameStateData) : null;
        setMatchPlayedNotice(
          summary
            ? i18n.t("dashboard.matchPlayedByStaff", { ...summary, defaultValue: "Your staff played the match." })
            : i18n.t("dashboard.matchPlayedByStaffNoScore", { defaultValue: "Your staff played the match." }),
        );
      }
      const hasScrimDecisionBlocker = (result.blockers ?? []).some((blocker) => blocker.id === SCRIM_DECISION_BLOCKER_ID);
      if (result.action === "blocked" && hasScrimDecisionBlocker && scrimReviewMode === "assistant") {
        try {
          const delegated = await delegateScrimDecision();
          setGameState(delegated);
          setAutoDelegationNotice(noticeAssistantResolvedDecision());
          const retry = await skipToMatchDay();
          if (retry.action === "fired") {
            if (retry.game) setGameState(retry.game as GameStateData);
            setShowFiredModal(true);
            return;
          }
          if (retry.game) setGameState(retry.game as GameStateData);
          if (retry.action === "blocked" && retry.blockers && retry.blockers.length > 0) {
            setBlockerModal(buildBlockerModal(retry.blockers, "skipToMatchDay"));
          }
          return;
        } catch (error) {
          console.error("Failed to auto-delegate scrim decision while skipping:", error);
        }
      }
      if (result.action === "blocked" && result.blockers && result.blockers.length > 0) {
        setBlockerModal(buildBlockerModal(result.blockers, "skipToMatchDay"));
      }
    } catch (err) {
      console.error("Failed to skip to match day:", err);
    } finally {
      console.info("[useAdvanceTime] doSkipToMatchDay:complete");
      setIsAdvancing(false);
    }
  };

  return {
    isAdvancing,
    showContinueMenu, setShowContinueMenu,
    showMatchConfirm, setShowMatchConfirm,
    matchMode, setMatchMode,
    blockerModal, setBlockerModal,
    autoDelegationNotice,
    matchPlayedNotice,
    handleContinue,
    handleConfirmMatch,
    handleSkipToMatchDay,
    handleSkipToNextDay,
  };
}

