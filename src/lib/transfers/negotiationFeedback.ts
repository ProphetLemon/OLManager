import { formatVal } from "@/lib/common/helpers";

export type NegotiationFeedbackPanelData = {
  mood: "calm" | "firm" | "tense" | "positive" | "guarded";
  headline_key: string;
  detail_key?: string | null;
  tension: number;
  patience: number;
  round: number;
  params?: Record<string, string>;
};

const MONEY_PARAM_KEYS = ["wage", "fee"] as const;

/** Backend params carry money as raw integer strings; format them like the rest of the transfers UI. */
export function formatFeedbackParams(
  params: Record<string, string> | undefined,
): Record<string, string> {
  const formatted = { ...(params ?? {}) };
  for (const key of MONEY_PARAM_KEYS) {
    const value = Number(formatted[key]);
    if (formatted[key] !== undefined && Number.isFinite(value)) {
      formatted[key] = formatVal(value);
    }
  }
  return formatted;
}
