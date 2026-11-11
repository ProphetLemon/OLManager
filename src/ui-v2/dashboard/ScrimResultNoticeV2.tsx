import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/ui-v2/components/ui/button";

export interface ScrimResultNoticeV2Props {
  /** One line per scrim resolved by the last advance; `null` when there is no notice. */
  lines: string[] | null;
  /** The Assistant Coach notice of the same advance, shown inside this notice instead of beside it. */
  assistantNote: string | null;
  onOpenScrims: () => void;
  onDismiss: () => void;
}

export function ScrimResultNoticeV2({ lines, assistantNote, onOpenScrims, onDismiss }: ScrimResultNoticeV2Props) {
  const { t } = useTranslation();
  const count = lines?.length ?? 1;
  const title = t("dashboard.scrimResultTitle", {
    count,
    defaultValue: count === 1 ? "Scrim result" : "Scrim results",
  });

  return (
    <>
      <div role="status" aria-live="polite" className="sr-only" data-slot="scrim-result-live">
        {lines ? [title, ...lines, assistantNote].filter(Boolean).join(". ") : ""}
      </div>
      {lines ? (
        <section
          aria-label={title}
          data-slot="scrim-result-notice"
          className="flex shrink-0 items-start gap-3 border-b border-line bg-secondary px-4 py-2 text-sm text-foreground"
        >
          <div className="min-w-0 flex-1">
            <p className="font-heading font-bold uppercase">{title}</p>
            <ul className="list-disc ps-5">
              {lines.map((line, index) => (
                <li key={`${index}-${line}`}>{line}</li>
              ))}
            </ul>
            {assistantNote ? <p className="mt-1 text-dim">{assistantNote}</p> : null}
          </div>
          <Button variant="outline" size="touch" onClick={onOpenScrims}>
            {t("dashboard.scrimResultOpen", { defaultValue: "Open Scrims" })}
          </Button>
          <Button
            variant="ghost"
            size="icon-touch"
            onClick={onDismiss}
            aria-label={t("dashboard.scrimResultDismiss", { defaultValue: "Dismiss" })}
          >
            <X aria-hidden="true" className="size-4" />
          </Button>
        </section>
      ) : null}
    </>
  );
}
