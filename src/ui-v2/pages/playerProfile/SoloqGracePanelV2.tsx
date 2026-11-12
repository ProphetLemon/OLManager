import type { SoloQDecayPreset, SoloQHistoryDay } from "@/api/types";
import {
  DAY_KIND_VISUALS,
  LEGEND_GLYPH_PATHS,
  dayKindWord,
  formatNumber,
  formatShortDate,
  offsetOf,
  type DayTone,
  type Translate,
} from "@/lib/players/soloqHistory";
import { cn } from "@/ui-v2/lib/utils";

const TONE_CLASS: Record<DayTone, string> = {
  positive: "fill-positive",
  warning: "fill-warning",
  negative: "fill-negative",
  foreground: "fill-foreground",
  dim: "fill-none stroke-dim",
};

interface SoloqGracePanelV2Props {
  days: readonly SoloQHistoryDay[];
  selected: number;
  decayOn: boolean;
  bankMax: number;
  modeLabel: string;
  preset: Pick<SoloQDecayPreset, "decay_per_idle_day" | "recovery_per_played_day"> | null;
  language: string;
  t: Translate;
}

/** The grace period as a segmented meter, the last 28 days as a grid, and the rules in four lines. */
export default function SoloqGracePanelV2({ days, selected, decayOn, bankMax, modeLabel, preset, language, t }: SoloqGracePanelV2Props) {
  const day = days[selected];
  const rate = preset?.decay_per_idle_day ?? 0;
  const rec = preset?.recovery_per_played_day ?? 0;
  const held = offsetOf(day);

  let sentence: string;
  if (day.bank === 0 && day.kind === "Decay") sentence = t("soloqHistory.grace.usedDecay", { rate: formatNumber(rate, language) });
  else if (day.bank === 0) sentence = t("soloqHistory.grace.usedNext");
  else sentence = t("soloqHistory.grace.cover", { count: day.bank, next: day.bank + 1 });
  if (held > 0) sentence += ` ${t("soloqHistory.grace.held", { offset: formatNumber(held, language), rec: formatNumber(rec, language) })}`;

  const gridCount = Math.min(28, days.length);
  const gridStart = days.length - gridCount;
  const cells: number[] = [];
  for (let i = gridStart; i < days.length; i += 1) cells.push(i);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section aria-labelledby="soloq-grace-title" className="flex flex-col gap-3 rounded-xl border border-line bg-rail p-5">
        <h3 id="soloq-grace-title" className="font-heading text-section uppercase leading-tight">
          {t("soloqHistory.grace.title")}
        </h3>
        {decayOn ? (
          <>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-heading text-ovr leading-none tabular-nums">{day.bank}</span>
              <span className="text-muted-foreground">
                {t("soloqHistory.grace.ofDays", { cap: bankMax, date: formatShortDate(day.date, language) })}
              </span>
            </div>
            <div
              role="meter"
              aria-label={t("soloqHistory.grace.title")}
              aria-valuemin={0}
              aria-valuemax={bankMax}
              aria-valuenow={day.bank}
              className="grid gap-[3px]"
              style={{ gridTemplateColumns: `repeat(${Math.max(1, bankMax)}, minmax(0, 1fr))` }}
            >
              {Array.from({ length: bankMax }, (_, k) => (
                <span key={k} className={cn("h-4 rounded-[3px]", k < day.bank ? "bg-club" : "ring-[1.5px] ring-inset ring-dim")} />
              ))}
            </div>
            <p className="text-sm text-muted-foreground">{sentence}</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t("soloqHistory.grace.off")}</p>
        )}
        <div>
          <p className="mb-2 font-heading text-2xs uppercase tracking-wide text-muted-foreground">
            {t("soloqHistory.grace.activity", { count: gridCount })}
          </p>
          <ul
            aria-label={t("soloqHistory.grace.activity", { count: gridCount })}
            className="m-0 grid list-none grid-cols-[repeat(14,minmax(0,1fr))] gap-1 p-0"
          >
            {cells.map((index) => {
              const cell = days[index];
              const visual = DAY_KIND_VISUALS[cell.kind];
              return (
                <li
                  key={cell.date}
                  className={cn(
                    "flex aspect-square items-center justify-center rounded ring-1 ring-inset ring-line",
                    index === selected && "outline-2 outline-offset-2 outline-foreground",
                  )}
                >
                  <svg viewBox="0 0 16 16" aria-hidden className="size-full">
                    <path d={LEGEND_GLYPH_PATHS[visual.glyph]} className={TONE_CLASS[visual.tone]} strokeWidth="2" />
                  </svg>
                  <span className="sr-only">
                    {formatShortDate(cell.date, language)}: {dayKindWord(cell, decayOn, t)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section aria-labelledby="soloq-rules-title" className="flex flex-col gap-3 rounded-xl border border-line bg-rail p-5">
        <h3 id="soloq-rules-title" className="font-heading text-section uppercase leading-tight">
          {t("soloqHistory.rules.title")}
        </h3>
        {decayOn ? (
          <ol className="m-0 flex list-decimal flex-col gap-2 pl-5 text-muted-foreground">
            <li>{t("soloqHistory.rules.played", { cap: bankMax, rec: formatNumber(rec, language) })}</li>
            <li>{t("soloqHistory.rules.idle")}</li>
            <li>{t("soloqHistory.rules.loss", { rate: formatNumber(rate, language) })}</li>
            <li>{t("soloqHistory.rules.neutral")}</li>
          </ol>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {decayOn
            ? t("soloqHistory.rules.noteOn", {
                mode: modeLabel,
                rate: formatNumber(rate, language),
                cap: bankMax,
                rec: formatNumber(rec, language),
              })
            : t("soloqHistory.rules.noteOff")}
        </p>
      </section>
    </div>
  );
}
