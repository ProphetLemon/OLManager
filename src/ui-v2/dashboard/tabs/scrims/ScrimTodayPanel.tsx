import { useTranslation } from "react-i18next";

interface ScrimTodayPanelProps {
  /** What the day asks of the manager, already worded for the state of the day. */
  message: string;
  /** Plan B and Plan C of the block about to be played; null once it has been played or cancelled. */
  fallbacks: { planB: string | null; planC: string | null } | null;
}

/** Today's body of the wide column: the week is locked and there is nothing to decide right now. */
export function ScrimTodayPanel({ message, fallbacks }: ScrimTodayPanelProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4 p-4 sm:p-5">
      <p className="font-medium">{message}</p>
      {fallbacks ? (
        <dl className="flex flex-wrap gap-x-10 gap-y-3 border-t border-line pt-4">
          <div className="flex flex-col gap-0.5">
            <dt className="text-caption text-muted-foreground">{t("training.scrims.planB")}</dt>
            <dd className="font-heading text-section font-semibold uppercase leading-tight tracking-wide">
              {fallbacks.planB ?? t("training.scrims.noFallback")}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-caption text-muted-foreground">{t("training.scrims.planC")}</dt>
            <dd className="font-heading text-section font-semibold uppercase leading-tight tracking-wide">
              {fallbacks.planC ?? t("training.scrims.noFallback")}
            </dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
}
