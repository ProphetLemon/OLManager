import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { useScrimPlans } from "@/hooks/useScrimPlans";
import type { TeamData, GameStateData, ScrimFocus, ScrimReportData } from "@/store/gameStore";
import type { TodayScrimContext, WeeklyScrimContext } from "@/lib/scrims/scrimContext";
import type { DecisionResult } from "@/lib/scrims/decisionResult";
import { NEXT_BLOCK_CANCELLATION } from "@/lib/scrims/decisionEffects";
import { buildPhoneHome } from "@/lib/scrims/phoneHome";
import { isEditable, phoneDoneTarget, slotRowId, type PhoneRowId } from "@/lib/scrims/phoneWeek";
import { buildRivalRows } from "@/lib/scrims/rivalOdds";
import { autofillDisabled } from "@/lib/scrims/scrimPlans";
import { type DeskPanel, type RiskLevel } from "@/lib/scrims/scrimDesk";
import type { DailyScrimAction } from "@/services/trainingService";
import { useBackDismisser } from "@/ui-v2/palette/useBackDismisser";
import type { DecisionOption } from "../ScrimDecisionPanel";
import { ScrimDecisionPane } from "./ScrimDecisionPane";
import { ScrimFollowUpPane } from "./ScrimFollowUpPane";
import { ScrimObjectivePane } from "./ScrimObjectivePane";
import { ScrimReportPane } from "./ScrimReportPane";
import { ScrimResultPane } from "./ScrimResultPane";
import { ScrimPickView } from "./ScrimPickView";
import { ScrimVolumePane } from "./ScrimVolumePane";
import { ScrimViewFrame } from "./ScrimViewFrame";
import { ScrimWeekHome } from "./ScrimWeekHome";

export interface ScrimsPhoneLayoutProps {
  gameState: GameStateData;
  myTeam: TeamData;
  weeklyContext: WeeklyScrimContext;
  todayContext: TodayScrimContext;
  teamNameById: ReadonlyMap<string, string>;
  weekdayLabels: readonly string[];
  /** "Wed A" for a slot of the week. */
  slotLabelOf: (slot: { labelDay: number; labelSuffix: string } | undefined) => string;
  /** The assistant handles scrims: every pane is read-only. */
  assistantControls: boolean;
  onAssistant: (next: boolean) => void;
  /** Why the setup cannot be changed (lock, assistant, passed days); null while it can. */
  setupBlockedText: string | null;
  staffSuggestions: readonly string[];
  isSaving: boolean;
  setIsSaving: (value: boolean) => void;
  onGameUpdate: (state: GameStateData) => void;
  onObjective: (next: ScrimFocus | null) => void;
  onVolume: (slots: number) => void;
  onFinalize: () => void;
  // Today
  panel: DeskPanel;
  todayMessage: string;
  todayRisk: RiskLevel | null;
  // Decision
  decisionReport: ScrimReportData | null;
  blockLabel: string | null;
  isFirstBlock: boolean;
  decisionOptions: readonly DecisionOption[];
  decisionSaving: DailyScrimAction | null;
  showCancelFollowups: boolean;
  onDecide: (id: DailyScrimAction) => void;
  onBackToDecision: () => void;
  /** The result of today's last decision and the slot it was taken on; null when there is none. */
  result: DecisionResult | null;
  resultSlotIndex: number | null;
  /** The one live line: the decision just applied, or the prompt of the open cancel step. */
  liveText: string;
  /** Bumped by the tab after a decision or a step change: focus goes to the pane's heading. */
  focusTick: number;
}

type View = PhoneRowId | "home";

/** What asks for focus after a render: the open view's heading, or the control of Semana that opened it. */
interface FocusRequest {
  to: "heading" | "home";
  /** A move the game made (not the player) leaves focus alone when it sits on a control outside this screen. */
  force: boolean;
  n: number;
}

/**
 * The Scrims tab on a phone. One selection, `selected`: "home" is Semana (the week, the hero and the
 * three entries), anything else is a view in a frame with a back control. The tab computes
 * everything; this owns which of them is open. The moves it makes by itself: on opening (Decide if
 * a block waits, else Semana), a row that starts to carry Decide (opens it) or Today (Semana shows
 * it in the hero), a decision's result (its block), a pick of the objective (to Volume, once) and
 * Done. Back, the frame's or the system's, returns to Semana.
 */
export function ScrimsPhoneLayout(props: ScrimsPhoneLayoutProps) {
  const { t } = useTranslation();
  const {
    gameState, myTeam, weeklyContext: week, todayContext: today, teamNameById, weekdayLabels, slotLabelOf,
    assistantControls, setupBlockedText, isSaving, setIsSaving, onGameUpdate, showCancelFollowups, result, resultSlotIndex, focusTick,
  } = props;
  const locked = week.setupLocked || assistantControls;
  const rootRef = useRef<HTMLDivElement>(null);
  const { setSlotPlan, autofill } = useScrimPlans({ gameState, weeklyContext: week, onGameUpdate, setIsSaving });
  const rivals = useMemo(() => buildRivalRows(gameState, myTeam, week.reputation), [gameState, myTeam, week.reputation]);

  const home = useMemo(
    () => buildPhoneHome({ week, today, readOnly: assistantControls, todayRisk: props.todayRisk }),
    [week, today, assistantControls, props.todayRisk],
  );
  const { hero } = home;
  // Only Decide and Today move the screen by themselves; the key changes when the game moves the tag.
  const tagKey = hero.state === "decide" || hero.state === "today" ? `${hero.state}:${hero.slotIndex}` : "";

  const [selected, setSelected] = useState<View>(() =>
    result && resultSlotIndex != null ? slotRowId(resultSlotIndex) : hero.state === "decide" ? slotRowId(hero.slotIndex) : "home",
  );
  const [focusRequest, setFocusRequest] = useState<FocusRequest>({ to: "heading", force: true, n: 0 });
  // The control of Semana that opened the view, so closing it gives focus back there.
  const opener = useRef<string | null>(null);
  const request = (to: FocusRequest["to"], force: boolean) => setFocusRequest((previous) => ({ to, force, n: previous.n + 1 }));
  const goTo = (id: PhoneRowId) => {
    opener.current = null;
    setSelected(id);
    request("heading", true);
  };
  const goHome = useCallback(() => {
    setSelected("home");
    request("home", true);
  }, []);
  const open = (id: PhoneRowId, control: string) => {
    goTo(id);
    opener.current = control;
  };

  const slotExists = (id: View) => id === "home" || !id.startsWith("slot:") || week.slots.some((entry) => slotRowId(entry.slotIndex) === id);
  const current: View = slotExists(selected) ? selected : "home";
  const resultRow = result && resultSlotIndex != null ? slotRowId(resultSlotIndex) : null;
  const currentRef = useRef(current);
  currentRef.current = current;
  // A game-made move asks for focus without taking it from a control outside this screen.
  const gameMove = (to: View) => {
    opener.current = null;
    setSelected(to);
    setFocusRequest((previous) => ({ to: to === "home" ? "home" : "heading", force: false, n: previous.n + 1 }));
  };
  // A day that advances is the game's move; a tag that appears because of the manager's own pick is not.
  const date = gameState.clock.current_date;
  const lastDate = useRef(date);

  // The tag moves because the game moved (a block was played, the day advanced): Decide opens its block,
  // Today goes back to Semana, whose hero shows it. While a decision's result is on screen it stays there
  // (its button leads to the block that waits). A Next tag moves with the manager's own picks, so it never moves anything.
  const lastTag = useRef(tagKey);
  useEffect(() => {
    if (lastTag.current === tagKey) return;
    lastTag.current = tagKey;
    const dayMoved = lastDate.current !== date;
    if (!tagKey || current === resultRow) return;
    if (hero.state === "decide") gameMove(slotRowId(hero.slotIndex));
    else if (current !== "home" && (dayMoved || current !== slotRowId(hero.state === "today" ? hero.slotIndex : -1))) gameMove("home");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagKey, hero, current, resultRow, date]);

  useEffect(() => {
    lastDate.current = date;
  }, [date]);

  // The result belongs on the block it was taken on, even if the player tapped another one during the save.
  // After the tag effect above, so it wins when both fire for the same change.
  useEffect(() => {
    if (result && resultSlotIndex != null && currentRef.current !== slotRowId(resultSlotIndex)) gameMove(slotRowId(resultSlotIndex));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, resultSlotIndex]);

  useEffect(() => {
    if (focusTick > 0) rootRef.current?.querySelector<HTMLElement>("[data-pane-heading]")?.focus();
  }, [focusTick]);

  useEffect(() => {
    if (focusRequest.n === 0) return;
    const root = rootRef.current;
    const active = document.activeElement;
    if (!focusRequest.force && active && active !== document.body && !root?.contains(active)) return;
    if (focusRequest.to === "heading") {
      root?.querySelector<HTMLElement>("[data-pane-heading]")?.focus();
      return;
    }
    const target = (opener.current && root?.querySelector<HTMLElement>(`[data-home-control="${opener.current}"]`)) || root?.querySelector<HTMLElement>('[data-home-control="objective"]');
    target?.focus();
  }, [focusRequest]);

  // The system's Back closes a view the way the frame's back control does (and does nothing on Semana).
  useBackDismisser(current !== "home", goHome);

  const decisionSlot = props.panel === "decision" && props.decisionReport ? props.decisionReport.slot_index : null;
  const ghostReputation = Math.max(0, week.reputation + NEXT_BLOCK_CANCELLATION.reputation);
  const rowLabel = (id: PhoneRowId) => {
    if (id === "volume") return t("scrims.phone.volume", { defaultValue: "Volume" });
    const slot = id.startsWith("slot:") ? week.slots.find((entry) => slotRowId(entry.slotIndex) === id) : undefined;
    return slotLabelOf(slot);
  };

  /** `selfFramed`: the view draws its own frame (its top row holds controls of its own). */
  const view = (): { title: string; content: ReactNode; selfFramed?: boolean } | null => {
    if (current === "home") return null;
    if (current === "objective") {
      return {
        title: t("scrims.phone.objective"),
        selfFramed: true,
        content: (
          <ScrimObjectivePane
            title={t("scrims.phone.objective")}
            onBack={goHome}
            objective={week.objective}
            disabled={isSaving || locked}
            blockedText={setupBlockedText}
            onSelect={(next) => {
              props.onObjective(next);
              goTo("volume");
            }}
          />
        ),
      };
    }
    if (current === "volume") {
      return {
        title: t("scrims.phone.volume"),
        content: (
          <ScrimVolumePane
            capacity={week.capacity}
            weekdayLabels={weekdayLabels}
            disabled={isSaving || locked}
            autofillDisabled={autofillDisabled(week, { isSaving, readOnly: locked })}
            blockedText={setupBlockedText}
            assistant={assistantControls}
            onVolume={props.onVolume}
            onAutofill={autofill}
            onAssistant={props.onAssistant}
            onFinalize={props.onFinalize}
          />
        ),
      };
    }
    if (current === "report") {
      return { title: t("scrims.phone.report"), content: <ScrimReportPane week={week} teamNameById={teamNameById} suggestions={props.staffSuggestions} /> };
    }

    const slotIndex = Number(current.slice("slot:".length));
    const slot = week.slots.find((entry) => entry.slotIndex === slotIndex)!;
    const label = slotLabelOf(slot);

    if (decisionSlot === slotIndex && props.decisionReport && showCancelFollowups) {
      return {
        title: t("scrims.decision.cancelScrims"),
        content: <ScrimFollowUpPane options={props.decisionOptions} savingId={props.decisionSaving} onDecide={props.onDecide} onBack={props.onBackToDecision} />,
      };
    }
    if (result && resultSlotIndex === slotIndex) {
      const waiting = decisionSlot != null && decisionSlot !== slotIndex ? decisionSlot : null;
      return {
        title: t("scrims.reviewBlockTitle"),
        content: (
          <ScrimResultPane
            result={result}
            statusText={props.liveText}
            nextSlotLabel={waiting != null ? slotLabelOf(week.slots.find((entry) => entry.slotIndex === waiting)) : null}
            onDecideNext={() => waiting != null && goTo(slotRowId(waiting))}
          />
        ),
      };
    }
    if (decisionSlot === slotIndex && props.decisionReport) {
      return {
        title: t("scrims.phone.decideSlot", { slot: label }),
        content: (
          <ScrimDecisionPane
            report={props.decisionReport}
            slotLabel={label}
            blockLabel={props.blockLabel}
            options={props.decisionOptions}
            savingId={props.decisionSaving}
            onDecide={props.onDecide}
            closeDay={!props.isFirstBlock}
            ghostReputation={props.isFirstBlock ? ghostReputation : null}
            lockText={setupBlockedText}
          />
        ),
      };
    }
    const target = phoneDoneTarget(week, slotIndex, assistantControls);
    return {
      title: label,
      selfFramed: true,
      content: (
        <ScrimPickView
          key={current}
          slotLabel={label}
          myTeam={myTeam}
          teams={gameState.teams}
          plan={[0, 1, 2].map((index) => slot.plan[index] ?? "")}
          rivals={rivals}
          ownReputation={week.reputation}
          readOnly={!isEditable(slot, week, assistantControls)}
          disabled={isSaving}
          blockedText={setupBlockedText}
          doneTo={rowLabel(target)}
          onPick={(priorityIndex, teamId) => setSlotPlan(slotIndex, priorityIndex, teamId)}
          onDone={() => goTo(target)}
          onBack={goHome}
        />
      ),
    };
  };
  const openView = view();

  return (
    <div ref={rootRef} data-slot="scrim-phone-layout" className="h-full min-h-0">
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {props.liveText}
      </div>
      {openView ? (
        openView.selfFramed ? (
          openView.content
        ) : (
          <ScrimViewFrame title={openView.title} onBack={goHome}>
            {openView.content}
          </ScrimViewFrame>
        )
      ) : (
        <ScrimWeekHome
          home={home}
          myTeam={myTeam}
          teams={gameState.teams}
          weekdayLabels={weekdayLabels}
          teamNameById={teamNameById}
          todayMessage={props.todayMessage}
          lockText={setupBlockedText}
          onOpen={open}
        />
      )}
    </div>
  );
}
