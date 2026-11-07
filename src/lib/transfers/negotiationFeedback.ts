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

/** Backend params carry money as raw integer strings; format them like the rest of the transfers UI. */
export function formatFeedbackParams(
  params: Record<string, string> | undefined,
): Record<string, string> {
  const formatted = { ...(params ?? {}) };
  const wage = Number(formatted.wage);
  if (formatted.wage !== undefined && Number.isFinite(wage)) {
    formatted.wage = formatVal(wage);
  }
  return formatted;
}
