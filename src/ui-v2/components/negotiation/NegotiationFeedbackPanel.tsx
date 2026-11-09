import { useTranslation } from "react-i18next";

import {
  formatFeedbackParams,
  type NegotiationFeedbackPanelData,
} from "@/lib/transfers/negotiationFeedback";
import { Badge } from "@/ui-v2/components/ui/badge";
import { Progress } from "@/ui-v2/components/ui/progress";
import { cn } from "@/ui-v2/lib/utils";

export type { NegotiationFeedbackPanelData };

interface NegotiationFeedbackPanelProps {
  feedback: NegotiationFeedbackPanelData | null;
  titleKey: string;
  roundKey: string;
  patienceKey: string;
  tensionKey: string;
  className?: string;
}

const LABEL_CLASS =
  "font-heading text-xs font-bold uppercase tracking-wider text-muted-foreground";

export default function NegotiationFeedbackPanel({
  feedback,
  titleKey,
  roundKey,
  patienceKey,
  tensionKey,
  className,
}: NegotiationFeedbackPanelProps) {
  const { t } = useTranslation();

  if (!feedback) {
    return null;
  }

  const params = formatFeedbackParams(feedback.params);

  return (
    <div className={cn("space-y-3 rounded-xl border border-border bg-muted/40 p-3", className)}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className={LABEL_CLASS}>{t(titleKey)}</p>
          <p className="mt-1 text-sm font-medium text-foreground">
            {t(feedback.headline_key, { ...params, defaultValue: feedback.headline_key })}
          </p>
        </div>
        <Badge variant="secondary">
          {t(roundKey, { count: feedback.round, defaultValue: `Round ${feedback.round}` })}
        </Badge>
      </div>

      {feedback.detail_key ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t(feedback.detail_key, { ...params, defaultValue: feedback.detail_key })}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <p className={LABEL_CLASS}>{t(patienceKey)}</p>
          <Progress value={feedback.patience} tone="success" showLabel />
        </div>
        <div className="space-y-1">
          <p className={LABEL_CLASS}>{t(tensionKey)}</p>
          <Progress value={feedback.tension} tone="danger" showLabel />
        </div>
      </div>
    </div>
  );
}
