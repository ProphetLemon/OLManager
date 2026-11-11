import i18n from "@/i18n";
import type { BlockerData } from "@/services/advanceTimeService";

/** Backend blocker ids this module words; the other ids are the scrim stops or keep the backend text. */
export const WORDED_BLOCKER_IDS: readonly string[] = [
  "urgent_messages",
  "incomplete_lineup",
  "key_contract_risk",
  "contract_wage_risk",
  "main_roster_minimum",
  "main_missing_roles",
  "academy_missing_roles",
];

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const str = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

/**
 * Words a roster or inbox blocker from its id and the values the backend sends
 * in `params`, through i18n. The backend `text` is only an English fallback, so a
 * blocker without usable params (an older save, an unknown id) returns null and
 * keeps that text.
 */
export function backendBlockerText(blocker: Pick<BlockerData, "id" | "params">): string | null {
  const p = blocker.params ?? {};
  switch (blocker.id) {
    case "urgent_messages": {
      const count = num(p.count);
      return count === null ? null : i18n.t("advance.blockers.urgentMessages", { count });
    }
    case "incomplete_lineup": {
      if (p.reason === "too_few") {
        const selected = num(p.selected);
        const required = num(p.required);
        return selected === null || required === null
          ? null
          : i18n.t("advance.blockers.incompleteLineupTooFew", { selected, required });
      }
      const roles = str(p.roles);
      const count = num(p.count);
      return p.reason === "missing_roles" && roles !== null && count !== null
        ? i18n.t("advance.blockers.incompleteLineupRoles", { roles, count })
        : null;
    }
    case "key_contract_risk": {
      const players = str(p.players);
      return players === null ? null : i18n.t("advance.blockers.keyContractRisk", { players });
    }
    case "contract_wage_risk": {
      const amount = num(p.amount);
      return amount === null ? null : i18n.t("advance.blockers.contractWageRisk", { amount });
    }
    case "main_roster_minimum": {
      const count = num(p.count);
      return count === null ? null : i18n.t("advance.blockers.mainRosterMinimum", { count });
    }
    case "main_missing_roles": {
      const roles = str(p.roles);
      return roles === null ? null : i18n.t("advance.blockers.mainMissingRoles", { roles });
    }
    case "academy_missing_roles": {
      const roles = str(p.roles);
      return roles === null ? null : i18n.t("advance.blockers.academyMissingRoles", { roles });
    }
    default:
      return null;
  }
}
