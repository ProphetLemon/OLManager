import type { TFunction } from "i18next";

import type { CallItem, CallKind } from "./needsYourCall";

const TAG_DEFAULTS: Record<CallKind, string> = {
  blocker: "Blocker",
  contract: "Contract",
  alert: "Alert",
};

// English fallbacks for the pre-registered onAir.calls.actions.* keys.
const ACTION_DEFAULTS: Record<string, string> = {
  fixLineup: "Fix lineup",
  openSquad: "Open squad",
  openScrims: "Open scrims",
  openFinances: "Open finances",
  openContracts: "Open contracts",
  openInbox: "Open inbox",
  renew: "Renew",
  review: "Review",
};

/** A call's tag word ("Blocker"), the same on Home and in the lane. */
export function callTagLabel(item: CallItem, t: TFunction): string {
  return t(item.tagKey, { defaultValue: TAG_DEFAULTS[item.kind] }) as string;
}

/** A call's action ("Fix lineup"), the same on Home and in the lane. */
export function callActionLabel(item: CallItem, t: TFunction): string {
  const key = item.actionLabelKey;
  const leaf = key.slice(key.lastIndexOf(".") + 1);
  return t(key, { defaultValue: ACTION_DEFAULTS[leaf] ?? "Review" }) as string;
}
