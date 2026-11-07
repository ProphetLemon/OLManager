import { useTranslation } from "react-i18next";

import { formatVal } from "@/lib/common/helpers";
import { Badge, ProgressBar } from "@/ui-v2/_legacy/components/ui";

export type NegotiationFeedbackPanelData = {
  mood: "calm" | "firm" | "tense" | "positive" | "guarded";
  headline_key: string;
  detail_key?: string | null;
  tension: number;
  patience: number;
  round: number;
  params?: Record<string, string>;
};

interface NegotiationFeedbackPanelProps {
  feedback: NegotiationFeedbackPanelData | null;
  titleKey: string;
  roundKey: string;
  patienceKey: string;
  tensionKey: string;
  className?: string;
}

/** Backend params carry money as raw integer strings; format them like the rest of the transfers UI. */
function formatFeedbackParams(params: Record<string, string> | undefined): Record<string, string> {
  const formatted = { ...(params ?? {}) };
  const wage = Number(formatted.wage);
  if (formatted.wage !== undefined && Number.isFinite(wage)) {
    formatted.wage = formatVal(wage);
  }
  return formatted;
}

export default function NegotiationFeedbackPanel({
  feedback,
  titleKey,
  roundKey,
  patienceKey,
  tensionKey,
  className = "",
}: NegotiationFeedbackPanelProps) {
  const { t } = useTranslation();

  if (!feedback) {
    return null;
  }

  const params = formatFeedbackParams(feedback.params);

  return (
    <div
      className={`rounded-xl border border-gray-200 dark:border-navy-700 bg-gray-50 dark:bg-navy-800/80 p-3 space-y-3 ${className}`.trim()}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-heading font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {t(titleKey)}
          </p>
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mt-1">
            {t(feedback.headline_key, {
              ...params,
              defaultValue: feedback.headline_key,
            })}
          </p>
        </div>
        <Badge variant="neutral">
          {t(roundKey, {
            count: feedback.round,
            defaultValue: `Round ${feedback.round}`,
          })}
        </Badge>
      </div>

      {feedback.detail_key ? (
        <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
          {t(feedback.detail_key, {
            ...params,
            defaultValue: feedback.detail_key,
          })}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <p className="text-xs font-heading font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {t(patienceKey)}
          </p>
          <ProgressBar value={feedback.patience} variant="success" size="md" showLabel />
        </div>
        <div className="space-y-1">
          <p className="text-xs font-heading font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {t(tensionKey)}
          </p>
          <ProgressBar value={feedback.tension} variant="danger" size="md" showLabel />
        </div>
      </div>
    </div>
  );
}