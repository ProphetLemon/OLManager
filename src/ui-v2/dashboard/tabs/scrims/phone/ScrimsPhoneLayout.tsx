import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useScrimPlans } from "@/hooks/useScrimPlans";
import type { TeamData, GameStateData, ScrimFocus, ScrimReportData } from "@/store/gameStore";
import type { TodayScrimContext, WeeklyScrimContext } from "@/lib/scrims/scrimContext";
import type { DecisionResult } from "@/lib/scrims/decisionResult";
import { NEXT_BLOCK_CANCELLATION } from "@/lib/scrims/decisionEffects";
import { buildPhoneWeek, isEditable, phoneDoneTarget, slotRowId, type PhoneCell, type PhoneRowId } from "@/lib/scrims/phoneWeek";
import { buildRivalRows } from "@/lib/scrims/rivalOdds";
import { autofillDisabled } from "@/lib/scrims/scrimPlans";
import { isPlanClearedToday, type DeskPanel, type RiskLevel } from "@/lib/scrims/scrimDesk";
import type { DailyScrimAction } from "@/services/trainingService";
import type { DecisionOption } from "../ScrimDecisionPanel";
import { ScrimDecisionPane } from "./ScrimDecisionPane";
import { ScrimFollowUpPane } from "./ScrimFollowUpPane";
import { ScrimObjectivePane } from "./ScrimObjectivePane";
import { ScrimReportPane } from "./ScrimReportPane";
import { ScrimResultPane } from "./ScrimResultPane";
import { ScrimSlotPane } from "./ScrimSlotPane";
import { ScrimTodayPane } from "./ScrimTodayPane";
import { ScrimVolumePane } from "./ScrimVolumePane";
import { ScrimWeekList } from "./ScrimWeekList";

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
  todayOpponentName: string | null;
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

const flatCells = (rows: PhoneCell[][]) => rows.flat();

/**
 * The Scrims tab on a phone: the week as a list on the left and the pane of the selected row on the
 * right, both fixed inside the content area. The tab computes everything; this owns which row is
 * selected and nothing else. Only these things move the selection by themselves: the first open,
 * the row that starts to carry Decide or Today, a pick of the objective (to Volume, once) and Done.
 */
export function ScrimsPhoneLayout(props: ScrimsPhoneLayoutProps) {
  const { t } = useTranslation();
  const {
    gameState, myTeam, weeklyContext: week, todayContext: today, teamNameById, weekdayLabels, slotLabelOf,
    assistantControls, setupBlockedText, isSaving, setIsSaving, onGameUpdate, showCancelFollowups, result, resultSlotIndex, focusTick,
  } = props;
  const locked = week.setupLocked || assistantControls;
  const paneRef = useRef<HTMLDivElement>(null);
  const { setSlotPlan, autofill } = useScrimPlans({ gameState, weeklyContext: week, onGameUpdate, setIsSaving });
  const rivals = useMemo(() => buildRivalRows(gameState, myTeam, week.reputation), [gameState, myTeam, week.reputation]);

  const model = useMemo(() => buildPhoneWeek({ week, today, readOnly: assistantControls }), [week, today, assistantControls]);
  const cells = flatCells(model.rows);
  const tagged = cells.find((cell) => cell.tag);
  const tagKey = tagged ? `${tagged.id}:${tagged.tag}` : "";

  // The career's first week has nothing to plan: open where its sentence is instead of on the report.
  const initialRow = week.setupLockedReason === "career_started_late" && model.openRow === "report" ? "volume" : model.openRow;
  const [selected, setSelected] = useState<PhoneRowId>(initialRow);
  // A move the player asked for (Done, Decide <slot>) unmounts the button that had focus: focus goes to the new pane's heading.
  const [movedTick, setMovedTick] = useState(0);
  const goTo = (id: PhoneRowId) => {
    setSelected(id);
    setMovedTick((tick) => tick + 1);
  };
  const current = cells.some((cell) => cell.id === selected) ? selected : model.openRow;
  const resultRow = result && resultSlotIndex != null ? slotRowId(resultSlotIndex) : null;

  // The tag moves because the game moved (a block was played, the day advanced): the pane follows it
  // to Decide or Today. A Next tag moves with the manager's own picks, so it never drags the pane, and
  // while a decision's result is on screen it stays there (its button leads to the block that waits).
  const lastTag = useRef(tagKey);
  useEffect(() => {
    if (lastTag.current === tagKey) return;
    lastTag.current = tagKey;
    if (!tagged || tagged.tag === "next" || current === resultRow) return;
    setSelected(tagged.id);
  }, [tagKey, tagged, current, resultRow]);

  // The result belongs on the block it was taken on, even if the player tapped another row during the save.
  // After the tag effect above, so it wins when both fire for the same change.
  useEffect(() => {
    if (result && resultSlotIndex != null) setSelected(slotRowId(resultSlotIndex));
  }, [result, resultSlotIndex]);

  useEffect(() => {
    if (focusTick > 0 || movedTick > 0) paneRef.current?.querySelector<HTMLElement>("[data-pane-heading]")?.focus();
  }, [focusTick, movedTick]);

  const decisionSlot = props.panel === "decision" && props.decisionReport ? props.decisionReport.slot_index : null;
  const ghostReputation = Math.max(0, week.reputation + NEXT_BLOCK_CANCELLATION.reputation);
  const rowLabel = (id: PhoneRowId) => {
    if (id === "volume") return t("scrims.phone.volume", { defaultValue: "Volume" });
    const slot = id.startsWith("slot:") ? week.slots.find((entry) => slotRowId(entry.slotIndex) === id) : undefined;
    return slotLabelOf(slot);
  };

  const body = (() => {
    if (current === "objective") {
      return (
        <ScrimObjectivePane
          objective={week.objective}
          disabled={isSaving || locked}
          blockedText={setupBlockedText}
          onSelect={(next) => {
            props.onObjective(next);
            setSelected("volume");
          }}
        />
      );
    }
    if (current === "volume") {
      return (
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
      );
    }
    if (current === "report") return <ScrimReportPane week={week} teamNameById={teamNameById} suggestions={props.staffSuggestions} />;

    const slotIndex = Number(current.slice("slot:".length));
    const slot = week.slots.find((entry) => entry.slotIndex === slotIndex);
    if (!slot) return null;
    const label = slotLabelOf(slot);

    if (decisionSlot === slotIndex && props.decisionReport) {
      if (showCancelFollowups) {
        return (
          <ScrimFollowUpPane options={props.decisionOptions} savingId={props.decisionSaving} onDecide={props.onDecide} onBack={props.onBackToDecision} />
        );
      }
    }
    if (result && resultSlotIndex === slotIndex) {
      const waiting = decisionSlot != null && decisionSlot !== slotIndex ? decisionSlot : null;
      return (
        <ScrimResultPane
          result={result}
          statusText={props.liveText}
          nextSlotLabel={waiting != null ? slotLabelOf(week.slots.find((entry) => entry.slotIndex === waiting)) : null}
          onDecideNext={() => waiting != null && goTo(slotRowId(waiting))}
        />
      );
    }
    if (decisionSlot === slotIndex && props.decisionReport) {
      return (
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
      );
    }
    if (props.panel === "today" && today.slotIndex === slotIndex) {
      const open = today.state === "Planned" || today.state === "Confirmed";
      const names = (index: number) => (slot.plan[index] ? teamNameById.get(slot.plan[index]) ?? slot.plan[index] : null);
      return (
        <ScrimTodayPane
          slotLabel={label}
          dayState={today.state}
          message={props.todayMessage}
          facts={open ? { opponent: props.todayOpponentName, risk: props.todayRisk } : null}
          plans={open ? [names(0), names(1), names(2)] : null}
          lockText={setupBlockedText}
        />
      );
    }
    const target = phoneDoneTarget(week, slotIndex, assistantControls);
    return (
      <ScrimSlotPane
        key={current}
        slotLabel={label}
        plan={[0, 1, 2].map((index) => slot.plan[index] ?? "")}
        rivals={rivals}
        teamNameById={teamNameById}
        readOnly={!isEditable(slot, week, assistantControls)}
        disabled={isSaving}
        blockedText={setupBlockedText}
        doneTo={rowLabel(target)}
        resolvedTeamId={slot.resolvedOpponentTeamId}
        cleared={isPlanClearedToday(slot, week)}
        onPick={(priorityIndex, teamId) => setSlotPlan(slotIndex, priorityIndex, teamId)}
        onDone={() => goTo(target)}
      />
    );
  })();

  return (
    // 8 px margins and gap, 4 px on top and none under: two panes of 282 in a content area of 286.
    <div className="grid h-full min-h-0 grid-cols-[17rem_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-2 px-2 pb-0 pt-1">
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {props.liveText}
      </div>
      <ScrimWeekList
        model={model}
        selectedId={current}
        teamNameById={teamNameById}
        weekdayLabels={weekdayLabels}
        ghostReputation={showCancelFollowups ? ghostReputation : null}
        onSelect={setSelected}
      />
      <div ref={paneRef} className="min-h-0 min-w-0 overflow-hidden rounded-lg bg-card text-card-foreground shadow-[inset_0_0_0_1px_var(--line)]">
        {body}
      </div>
    </div>
  );
}
