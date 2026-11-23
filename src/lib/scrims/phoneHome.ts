import type { TodayScrimContext } from "./scrimContext";
import {
  buildPhoneWeek,
  isEditable,
  slotRowId,
  type PhoneObjectiveCell,
  type PhoneReportCell,
  type PhoneRowId,
  type PhoneSlotCell,
  type PhoneTag,
  type PhoneVolumeCell,
  type PhoneWeekInput,
} from "./phoneWeek";
import { todayBarOpponentId, type ChipRival, type RiskLevel } from "./scrimDesk";
import { scrimSetupBlockedKey } from "./setupLock";

/**
 * The home of the Scrims tab on the phone ("Semana") as data: the three entries, the hero (what
 * needs the manager, one of seven states, first match wins) and the day groups with each block's
 * state. Pure and built on `buildPhoneWeek`: it returns ids, keys and values, the component words them.
 */

export interface PhoneHomeInput extends PhoneWeekInput {
  /** Today's risk, which the tab estimates from the rosters (the context does not carry it). */
  todayRisk?: RiskLevel | null;
}

type Plans = readonly [string | null, string | null, string | null];

interface HeroBase {
  /** What a tap opens; null when the hero is not a control. */
  opens: PhoneRowId | null;
  /** The week is finalized or the assistant handles it: the hero shows a lock icon. */
  locked: boolean;
  /** `scrims.*` key of the lock sentence when locked, else null (slots passed is not a lock). */
  lockKey: string | null;
  /** `scrims.todayReviewed` or `scrims.todayCancelled` once the day is closed. */
  closedDayKey: string | null;
}

export type PhoneHero = HeroBase & (
  | { state: "decide"; slotIndex: number; opponentTeamId: string | null; result: "won" | "lost" | null; quality: number | null }
  | { state: "today"; slotIndex: number; opponentTeamId: string | null; risk: RiskLevel | null; plan: Plans; dayState: TodayScrimContext["state"] }
  | { state: "careerStartLate" }
  | { state: "nextObjective" }
  | { state: "nextSlot"; slotIndex: number }
  | { state: "upNext"; slotIndex: number; opponentTeamId: string | null; plan: Plans }
  | { state: "report"; wins: number; losses: number }
);

export type PhoneBlockState = "planned" | "played" | "cancelled" | "notPlayed" | "cleared" | "none";

export interface PhoneBlock {
  id: PhoneRowId;
  slotIndex: number;
  suffix: string;
  state: PhoneBlockState;
  rival: ChipRival;
  result: "won" | "lost" | null;
  quality: number | null;
  /** The block the hero is about, ringed with the hero's word. */
  isHero: boolean;
  heroWord: PhoneTag | null;
  /** The block is a button: it opens Elegir rival (editable, or read-only), Decidir or a result. */
  opens: boolean;
}

export interface PhoneDay {
  /** Monday-based weekday, an index into the translated weekday names. */
  weekday: number;
  blocks: PhoneBlock[];
}

export interface PhoneHome {
  entries: {
    objective: PhoneObjectiveCell;
    volume: PhoneVolumeCell;
    report: PhoneReportCell & { hasResult: boolean };
  };
  hero: PhoneHero;
  days: PhoneDay[];
}

const plansOf = (plan: readonly string[]): Plans => [plan[0] ?? null, plan[1] ?? null, plan[2] ?? null];

function blockState(cell: PhoneSlotCell): PhoneBlockState {
  switch (cell.status) {
    case "Played":
    case "Reviewed": return "played";
    case "Cancelled": return "cancelled";
    case "NotPlayed": return "notPlayed";
    default:
      if (cell.rival.kind === "team") return "planned";
      return cell.rival.kind === "cleared" ? "cleared" : "none";
  }
}

function buildHero(input: PhoneHomeInput, tagged: { cell: PhoneSlotCell | null; id: PhoneRowId; tag: PhoneTag } | null, cells: PhoneSlotCell[]): PhoneHero {
  const { week, today, readOnly = false, todayRisk = null } = input;
  const locked = week.setupLocked || readOnly;
  const base = {
    locked,
    lockKey: locked ? scrimSetupBlockedKey(week, readOnly) : null,
    closedDayKey: today.state === "Reviewed" ? "scrims.todayReviewed" : today.state === "Cancelled" ? "scrims.todayCancelled" : null,
  };
  const slotOf = (index: number) => week.slots.find((slot) => slot.slotIndex === index);

  if (tagged?.tag === "decide" && today.report) {
    const { report } = today;
    return { ...base, state: "decide", slotIndex: report.slot_index, opponentTeamId: report.opponent_team_id ?? null, result: report.won == null ? null : report.won ? "won" : "lost", quality: report.quality ?? null, opens: slotRowId(report.slot_index) };
  }
  if (tagged?.tag === "today" && tagged.cell) {
    const slot = slotOf(tagged.cell.slotIndex)!;
    return { ...base, state: "today", slotIndex: slot.slotIndex, opponentTeamId: todayBarOpponentId(today) ?? slot.plan[0] ?? null, risk: todayRisk, plan: plansOf(slot.plan), dayState: today.state, opens: null };
  }
  if (week.setupLocked && week.setupLockedReason === "career_started_late") return { ...base, state: "careerStartLate", opens: null };
  if (tagged?.tag === "next" && tagged.id === "objective") return { ...base, state: "nextObjective", opens: "objective" };
  if (tagged?.tag === "next" && tagged.cell) return { ...base, state: "nextSlot", slotIndex: tagged.cell.slotIndex, opens: tagged.cell.id };

  const upNext = cells.find((cell) => (cell.status === "Open" || cell.status === "Locked") && cell.rival.kind === "team");
  if (upNext) {
    const slot = slotOf(upNext.slotIndex)!;
    return {
      ...base, state: "upNext", slotIndex: slot.slotIndex, opponentTeamId: upNext.rival.kind === "team" ? upNext.rival.teamId : null,
      plan: plansOf(slot.plan), opens: isEditable(slot, week, readOnly) ? upNext.id : null,
    };
  }
  return { ...base, state: "report", wins: week.wins, losses: week.losses, opens: "report" };
}

export function buildPhoneHome(input: PhoneHomeInput): PhoneHome {
  const { week, readOnly = false } = input;
  const model = buildPhoneWeek(input);
  const [[objective], [volume, report], ...dayRows] = model.rows as [[PhoneObjectiveCell], [PhoneVolumeCell, PhoneReportCell], ...PhoneSlotCell[][]];
  const cells = dayRows.flat();
  const tagged = [objective, volume, report, ...cells].find((cell) => cell.tag);
  const hero = buildHero(
    input,
    tagged?.tag ? { cell: tagged.kind === "slot" ? tagged : null, id: tagged.id, tag: tagged.tag } : null,
    cells,
  );
  const heroSlot = "slotIndex" in hero ? hero.slotIndex : null;
  const heroWord: PhoneTag | null = hero.state === "decide" ? "decide" : hero.state === "today" ? "today" : heroSlot != null ? "next" : null;

  const days = dayRows.map((row): PhoneDay => ({
    weekday: row[0].weekday,
    blocks: row.map((cell): PhoneBlock => {
      const state = blockState(cell);
      const slot = week.slots.find((candidate) => candidate.slotIndex === cell.slotIndex)!;
      const isHero = cell.slotIndex === heroSlot;
      return {
        id: cell.id, slotIndex: cell.slotIndex, suffix: cell.suffix, state, rival: cell.rival, result: cell.result, quality: cell.quality,
        isHero, heroWord: isHero ? heroWord : null,
        opens: isEditable(slot, week, readOnly) || state === "played" || state === "planned",
      };
    }),
  }));

  const hasResult = week.slots.some((slot) => slot.resultWon != null);
  return { entries: { objective, volume, report: { ...report, hasResult } }, hero, days };
}
