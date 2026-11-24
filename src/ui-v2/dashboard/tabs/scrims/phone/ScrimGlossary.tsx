import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, ChartNoAxesColumn, CircleHelp, CircleX, Smile, Star, X, Zap, type LucideIcon } from "lucide-react";

import { Dialog, DialogContent, DialogTitle } from "@/ui-v2/components/ui/dialog";
import { useBackDismisser } from "@/ui-v2/palette/useBackDismisser";

const FOCUS_RING = "outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

/** The entries in the order the owner asked for: how to read the changes, then each number. */
const ENTRIES: ReadonlyArray<{ id: string; title: string; body: string; Icon: LucideIcon }> = [
  { id: "read", title: "scrims.phone.glossaryReadTitle", body: "scrims.phone.glossaryReadBody", Icon: ArrowUp },
  { id: "quality", title: "scrims.reportQuality", body: "scrims.phone.glossaryQualityBody", Icon: Star },
  { id: "morale", title: "scrims.phone.statMorale", body: "scrims.phone.glossaryMoraleBody", Icon: Smile },
  { id: "energy", title: "scrims.phone.statEnergy", body: "scrims.phone.glossaryEnergyBody", Icon: Zap },
  { id: "reputation", title: "scrims.reputation", body: "scrims.phone.glossaryRepBody", Icon: ChartNoAxesColumn },
  { id: "cancellations", title: "scrims.cancellations", body: "scrims.phone.glossaryCancelBody", Icon: CircleX },
];

/**
 * The "?" at the right end of a view's top row and the dialog it opens: what each number of a decision
 * means. A target of `--hit`; system Back closes the dialog first (as in Elegir rival); the dialog's body
 * may scroll, the page never does.
 */
export function GlossaryButton() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  useBackDismisser(open, () => setOpen(false));

  return (
    <>
      <button
        type="button"
        data-slot="glossary-open"
        aria-haspopup="dialog"
        aria-label={t("scrims.phone.glossaryTitle")}
        onClick={() => setOpen(true)}
        className={`flex size-[var(--hit)] items-center justify-center rounded-lg text-muted-foreground ${FOCUS_RING}`}
      >
        <CircleHelp aria-hidden="true" className="size-6" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-slot="glossary-dialog" className="max-h-[calc(100dvh-1rem)] max-w-[min(42rem,calc(100vw-2rem))] gap-2 overflow-y-auto p-4">
          <div className="flex items-center justify-between gap-2">
            <DialogTitle className="font-heading text-section uppercase">{t("scrims.phone.glossaryTitle")}</DialogTitle>
            <button
              type="button"
              data-slot="glossary-close"
              aria-label={t("common.close")}
              onClick={() => setOpen(false)}
              className={`flex size-[var(--hit)] shrink-0 items-center justify-center rounded-lg ${FOCUS_RING}`}
            >
              <X aria-hidden="true" className="size-6" />
            </button>
          </div>
          <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-2">
            {ENTRIES.map(({ id, title, body, Icon }) => (
              <div key={id} data-slot="glossary-entry" data-entry={id} className="flex min-w-0 gap-3">
                <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <dt className="font-heading text-entry font-bold uppercase tracking-wide">{t(title)}</dt>
                  <dd className="m-0 text-caption leading-4 text-muted-foreground">{t(body)}</dd>
                </div>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </>
  );
}
