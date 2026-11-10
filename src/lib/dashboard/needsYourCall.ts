import type { TFunction } from "i18next";
import type { DashboardAlert } from "@/lib/dashboard/helpers";
import type { BlockerData } from "@/services/advanceTimeService";
import type { PlayerData } from "@/store/gameStore";
import { isBackendEnforcedBlocker } from "@/lib/home/blockerRules";
import { getContractRiskLevel, getDaysUntil } from "@/lib/common/contractUtils";

export type CallSeverity = "hard" | "soft" | "info";
export type CallKind = "blocker" | "contract" | "alert";

/** Mirrors `TagTone` from the TagBlock primitive (kept structural so this module stays pure). */
export type CallTagTone =
  | "club"
  | "secondary"
  | "neutral"
  | "warning"
  | "positive"
  | "negative"
  | "info";

export interface CallItem {
  id: string;
  kind: CallKind;
  severity: CallSeverity;
  tagKey: string;
  tagTone: CallTagTone;
  headline: string;
  consequence?: string;
  actionLabelKey: string;
  target: { tab: string; context?: Record<string, unknown> };
}

export interface BuildCallItemsInput {
  alerts: DashboardAlert[];
  blockers: BlockerData[];
  canContinueAnyway: boolean;
  startingFive: PlayerData[];
  currentDate: string;
  maxContracts?: number;
  t: TFunction;
}

export interface BuildCallItemsResult {
  items: CallItem[];
  /** Everything that needs a call, including contract rows hidden by the cap. */
  total: number;
  hiddenContracts: number;
  /**
   * Items that need a decision or block advancing (hard or soft), hidden
   * contract renewals included. Notices (info) never count: the header chip and
   * the "resolve before continuing" copy follow this, not `total`.
   */
  decisions: number;
}

const TAG_KEYS: Record<CallKind, string> = {
  blocker: "onAir.tags.blocker",
  contract: "onAir.tags.contract",
  alert: "onAir.tags.alert",
};

const ACTIONS = {
  fixLineup: "onAir.calls.actions.fixLineup",
  openSquad: "onAir.calls.actions.openSquad",
  openScrims: "onAir.calls.actions.openScrims",
  openFinances: "onAir.calls.actions.openFinances",
  openContracts: "onAir.calls.actions.openContracts",
  openInbox: "onAir.calls.actions.openInbox",
  openAcademy: "onAir.calls.actions.openAcademy",
  renew: "onAir.calls.actions.renew",
  review: "onAir.calls.actions.review",
} as const;

interface BlockerRule {
  action: string;
  /** Always blocking regardless of `canContinueAnyway`. */
  alwaysHard?: boolean;
  /** Informational only. */
  info?: boolean;
  tab?: string;
  consequenceDefault: string;
}

const BLOCKER_RULES: Record<string, BlockerRule> = {
  incomplete_lineup: {
    action: ACTIONS.fixLineup,
    consequenceDefault: "The starting five is incomplete.",
  },
  main_roster_minimum: {
    action: ACTIONS.fixLineup,
    consequenceDefault: "The main roster is below the minimum size.",
  },
  main_missing_roles: {
    action: ACTIONS.fixLineup,
    consequenceDefault: "The main roster is missing a role.",
  },
  academy_missing_roles: {
    action: ACTIONS.openAcademy,
    tab: "Youth",
    consequenceDefault: "The academy roster is missing a role.",
  },
  key_contract_risk: {
    action: ACTIONS.openContracts,
    consequenceDefault: "A key player's contract is about to expire.",
  },
  contract_wage_risk: {
    action: ACTIONS.openContracts,
    consequenceDefault: "Contract wages put the budget at risk.",
  },
  scrim_setup_required: {
    action: ACTIONS.openScrims,
    alwaysHard: true,
    tab: "Scrims",
    consequenceDefault: "The weekly scrim setup is not finished.",
  },
  scrim_decision_required: {
    action: ACTIONS.openScrims,
    alwaysHard: true,
    tab: "Scrims",
    consequenceDefault: "A scrim decision is waiting for you.",
  },
  urgent_messages: {
    action: ACTIONS.openInbox,
    info: true,
    tab: "Inbox",
    consequenceDefault: "Urgent messages are waiting in your inbox.",
  },
};

const GENERIC_CONSEQUENCE = "Review this before moving on.";

/** Alert ids that describe the same condition as a backend blocker id. */
const ALERT_ALIASES: Record<string, string> = {
  urgent: "urgent_messages",
  match_lineup: "incomplete_lineup",
};

const ALERT_ACTIONS: Record<string, string> = {
  incomplete_lineup: ACTIONS.fixLineup,
  match_lineup: ACTIONS.fixLineup,
  urgent: ACTIONS.openInbox,
  finance_crisis: ACTIONS.openFinances,
  finance_runway: ACTIONS.openFinances,
  wage_pressure: ACTIONS.openFinances,
  sponsor_theme_esports: ACTIONS.openFinances,
  exhausted: ACTIONS.review,
};

const SEVERITY_ORDER: Record<CallSeverity, number> = { hard: 0, soft: 1, info: 2 };

function toneFor(kind: CallKind, severity: CallSeverity): CallTagTone {
  if (severity === "info") return "info";
  if (kind === "blocker" && severity === "hard") return "negative";
  return "warning";
}

function consequenceFor(t: TFunction, id: string, fallback: string): string {
  return t(`onAir.calls.consequence.${id}`, { defaultValue: fallback }) as string;
}

function blockerItem(
  blocker: BlockerData,
  canContinueAnyway: boolean,
  t: TFunction,
): CallItem {
  const rule = BLOCKER_RULES[blocker.id];
  // Blockers the backend enforces are hard whatever the modal offered.
  const enforced = isBackendEnforcedBlocker(blocker);
  const severity: CallSeverity = enforced
    ? "hard"
    : !rule
    ? blocker.severity === "info"
      ? "info"
      : canContinueAnyway
        ? "soft"
        : "hard"
    : rule.alwaysHard
      ? "hard"
      : rule.info
        ? "info"
        : canContinueAnyway
          ? "soft"
          : "hard";
  return {
    id: `blocker:${blocker.id}`,
    kind: "blocker",
    severity,
    tagKey: TAG_KEYS.blocker,
    tagTone: toneFor("blocker", severity),
    headline: blocker.text,
    consequence: rule
      ? consequenceFor(t, blocker.id, rule.consequenceDefault)
      : consequenceFor(t, blocker.id, consequenceFor(t, "generic", GENERIC_CONSEQUENCE)),
    actionLabelKey: rule?.action ?? ACTIONS.review,
    target: { tab: rule?.tab ?? blocker.tab },
  };
}

function alertItem(alert: DashboardAlert, t: TFunction): CallItem {
  const severity: CallSeverity = alert.severity === "info" ? "info" : "soft";
  return {
    id: `alert:${alert.id}`,
    kind: "alert",
    severity,
    tagKey: TAG_KEYS.alert,
    tagTone: toneFor("alert", severity),
    headline: alert.text,
    consequence: consequenceFor(t, "generic", GENERIC_CONSEQUENCE),
    actionLabelKey: ALERT_ACTIONS[alert.id] ?? ACTIONS.review,
    target: { tab: alert.tab },
  };
}

interface ContractRow {
  item: CallItem;
  days: number;
}

function contractRows(
  players: PlayerData[],
  currentDate: string,
  t: TFunction,
): ContractRow[] {
  const rows: ContractRow[] = [];
  for (const player of players) {
    const risk = getContractRiskLevel(player.contract_end, currentDate);
    if (risk === "stable" || !player.contract_end) continue;
    const days = Math.max(0, getDaysUntil(player.contract_end, currentDate));
    const severity: CallSeverity = risk === "critical" ? "soft" : "info";
    rows.push({
      days,
      item: {
        id: `contract:${player.id}`,
        kind: "contract",
        severity,
        tagKey: TAG_KEYS.contract,
        tagTone: risk === "critical" ? "negative" : "warning",
        headline: player.match_name || player.full_name,
        consequence: t("onAir.calls.consequence.contract", {
          count: days,
          defaultValue: "Expires in {{count}} days",
        }) as string,
        actionLabelKey: ACTIONS.renew,
        target: { tab: "Squad", context: { playerId: player.id } },
      },
    });
  }
  return rows.sort((a, b) => a.days - b.days || a.item.id.localeCompare(b.item.id));
}

export function buildCallItems(input: BuildCallItemsInput): BuildCallItemsResult {
  const { alerts, blockers, canContinueAnyway, startingFive, currentDate, t } = input;
  const maxContracts = Math.max(0, input.maxContracts ?? 3);

  const seen = new Set<string>();
  const items: CallItem[] = [];
  const push = (item: CallItem) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    items.push(item);
  };

  const blockerIds = new Set(blockers.map((b) => b.id));
  for (const blocker of blockers) push(blockerItem(blocker, canContinueAnyway, t));
  for (const alert of alerts) {
    if (blockerIds.has(alert.id)) continue;
    const alias = ALERT_ALIASES[alert.id];
    if (alias && blockerIds.has(alias)) continue;
    push(alertItem(alert, t));
  }

  const rows = contractRows(startingFive, currentDate, t);
  rows.slice(0, maxContracts).forEach((row) => push(row.item));
  const hiddenContracts = Math.max(0, rows.length - maxContracts);
  const hiddenDecisions = rows
    .slice(maxContracts)
    .filter((row) => row.item.severity !== "info").length;

  // Array.prototype.sort is stable, so insertion order breaks severity ties.
  const sorted = items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.item.severity] - SEVERITY_ORDER[b.item.severity] ||
        a.index - b.index,
    )
    .map(({ item }) => item);

  const decisions = sorted.filter((item) => item.severity !== "info").length + hiddenDecisions;
  return { items: sorted, total: sorted.length + hiddenContracts, hiddenContracts, decisions };
}
