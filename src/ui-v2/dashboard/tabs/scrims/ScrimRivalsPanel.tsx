import { useId } from "react";
import { useTranslation } from "react-i18next";

import type { RivalRow } from "@/lib/scrims/rivalOdds";

const ROW = "grid grid-cols-[minmax(0,1.7fr)_repeat(4,minmax(0,0.8fr))] items-center gap-2 border-t border-line py-1.5 text-sm tabular-nums";

/**
 * The clubs of the manager's competition with the numbers the scrim engine uses against each:
 * its OVR and scrim reputation, the chance to win and the chance it takes a slot.
 */
export function ScrimRivalsPanel({ rows }: { rows: readonly RivalRow[] }) {
  const { t } = useTranslation();
  const headingId = useId();
  if (rows.length === 0) return null;

  return (
    <section
      aria-labelledby={headingId}
      data-slot="scrim-rivals"
      className="flex flex-col gap-2.5 rounded-xl border border-line bg-card p-4 text-card-foreground sm:p-5"
    >
      <h2 id={headingId} className="font-heading text-lg font-semibold uppercase leading-tight tracking-wide">
        {t("scrims.rivalsTitle")}
      </h2>
      <div role="table" aria-label={t("scrims.rivalsTable")} className="flex flex-col">
        <div role="row" className={`${ROW} border-t-0 text-caption text-muted-foreground`}>
          <div role="columnheader">{t("scrims.rivalTeam")}</div>
          <div role="columnheader" className="text-end">OVR</div>
          <div role="columnheader" className="text-end">{t("scrims.rivalRep")}</div>
          <div role="columnheader" className="text-end">{t("scrims.rivalWin")}</div>
          <div role="columnheader" className="text-end">{t("scrims.rivalAccepts")}</div>
        </div>
        {rows.map((row) => (
          <div key={row.teamId} role="row" className={ROW}>
            <div role="cell" className="min-w-0 truncate font-sans">{row.name}</div>
            <div role="cell" className="text-end">{row.ovr}</div>
            <div role="cell" className="text-end">{row.reputation}</div>
            <div role="cell" className="text-end">{row.winPercent}%</div>
            <div role="cell" className="text-end">{row.acceptPercent}%</div>
          </div>
        ))}
      </div>
      <p className="text-caption text-muted-foreground">{t("scrims.rivalsNote")}</p>
    </section>
  );
}
