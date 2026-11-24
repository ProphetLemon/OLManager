import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Play, TriangleAlert } from "lucide-react";

import type { EffectLine } from "@/lib/scrims/decisionEffects";
import type { DailyScrimAction } from "@/services/trainingService";
import type { ScrimReportData } from "@/store/gameStore";
import { cn } from "@/ui-v2/lib/utils";
import { CostMark, EffectLineText, signed } from "../EffectText";
import type { DecisionOption } from "../ScrimDecisionPanel";
import { STATS, STAT_ICONS, STAT_KEYS, StatValue, useStatWords, type StatChange, type StatId } from "./PhoneStats";

/** The three stat columns: Calidad 88, Moral 68 and Energía 74 px. */
const COLUMNS = "minmax(0,1fr) 5.5rem 4.25rem 4.625rem";

export interface PhoneEffectsTableProps {
  options: readonly DecisionOption[];
  /** The report the decision is about: Calidad ends at its quality plus the change. */
  report: ScrimReportData;
  /** Rep scrims now: the cost says where it ends. */
  reputation?: number;
  /** The decision being saved, if any. */
  savingId: DailyScrimAction | null;
  onDecide: (id: DailyScrimAction) => void;
  /** A chevron at the end of every row: the follow-ups lead on to the result. */
  chevron?: boolean;
  /** The view's title already carries the cost (the follow-ups): no cost line or box on the rows. */
  costInTitle?: boolean;
}

type CostLine = Extract<EffectLine, { kind: "cancelsNext" | "cancelStep" }>;
const isCost = (line: EffectLine): line is CostLine => line.kind === "cancelsNext" || line.kind === "cancelStep";

/** What an option does to Calidad, Moral and Energía (Gravedad is left out on purpose: nothing reads it after the decision). */
export function statChanges(effects: readonly EffectLine[], report: ScrimReportData): Record<StatId, StatChange> {
  const quality = effects.find((line) => line.kind === "quality");
  const players = effects.find((line) => line.kind === "players");
  return {
    quality: quality?.kind === "quality" ? { delta: quality.delta, end: Math.min(100, report.quality + quality.delta) } : { delta: 0 },
    morale: { delta: players?.kind === "players" ? players.morale : 0 },
    energy: { delta: players?.kind === "players" ? players.condition : 0 },
  };
}

function Header({ chevron }: { chevron: boolean }) {
  const { t } = useTranslation();
  return (
    <div data-slot="effects-header" aria-hidden="true" className="grid h-5 shrink-0 items-center rounded-t-lg bg-card px-3" style={{ gridTemplateColumns: chevron ? `${COLUMNS} 1.25rem` : COLUMNS }}>
      <span />
      {STATS.map((stat) => {
        const Icon = STAT_ICONS[stat];
        return (
          <span key={stat} data-stat={stat} className="flex items-center justify-end gap-1 font-heading text-caption font-semibold uppercase tracking-wide text-muted-foreground">
            <Icon aria-hidden="true" className="size-3.5 shrink-0" />
            {t(STAT_KEYS[stat])}
          </span>
        );
      })}
    </div>
  );
}

/** The amber box of a cost: the word, where Rep scrims ends and the game's sentence. */
function CostBox({ line, reputation, sentenceId }: { line: CostLine; reputation: number; sentenceId?: string }) {
  const { t } = useTranslation();
  const after = Math.max(0, reputation + line.reputation);
  const sentence = t(line.kind === "cancelsNext" ? "scrims.effect.cancelsNext" : "scrims.effect.cancelStep", {
    label: line.label,
    rep: signed(line.reputation),
    count: line.cancellations,
  });
  return (
    <span data-slot="effects-cost" className="col-span-full flex flex-col gap-0.5 rounded-lg border border-warning bg-warning/10 px-3 py-1 text-caption leading-4">
      <span aria-hidden="true" className="flex items-center gap-2 font-semibold text-warning">
        <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="font-heading text-entry uppercase">{t("scrims.costMark")}</span>
        <span className="tabular-nums">
          {t("scrims.reputation")} {reputation} {"→"} {after}
        </span>
      </span>
      <span id={sentenceId} className="text-foreground">{sentence}</span>
    </span>
  );
}

/**
 * The effects of a decision as a table. The stat names are said once, in the header, with their icons, always
 * as Calidad, Moral and Energía; each option is a row and a button, with its name and its one-line description
 * on the left and a fixed column per stat. With one or two options the rows are taller and carry the option's
 * extra line (the neutral sentence, or the cost box); with more, the description is all a row has room for.
 */
export function PhoneEffectsTable({ options, report, reputation = 0, savingId, onDecide, chevron = false, costInTitle = false }: PhoneEffectsTableProps) {
  const { t } = useTranslation();
  const statWords = useStatWords();
  const base = useId();
  const roomy = options.length <= 2;
  const template = chevron ? `${COLUMNS} 1.25rem` : COLUMNS;

  return (
    <div data-slot="effects-table" className="relative flex h-full min-h-0 flex-col gap-0">
      <Header chevron={chevron} />
      <ul className="relative m-0 flex min-h-0 flex-1 list-none flex-col gap-1 p-0">
        {options.map((option) => {
          const changes = statChanges(option.effects, report);
          const cost = costInTitle ? undefined : option.effects.find(isCost);
          const neutral = option.effects.filter((line) => line.kind === "playsNext" || line.kind === "severeLoss" || (line.kind === "closesDay" && roomy && !cost));
          const saving = savingId === option.id;
          const spoken = [option.label, ...STATS.map((stat) => statWords(stat, changes[stat]))];
          if (cost) spoken.push(`${t("scrims.costMark")}: ${t("scrims.reputation")} ${reputation} → ${Math.max(0, reputation + cost.reputation)}`);
          const descId = `${base}-${option.id}-desc`;
          // Every visible sentence of the row is in the description, each once; the cost is in the name.
          const noteIds = neutral.map((_, index) => `${descId}-n${index}`);
          const costId = roomy && cost ? `${descId}-cost` : null;
          const describedBy = [descId, ...noteIds, ...(costId ? [costId] : [])].join(" ");
          return (
            <li key={option.id} data-slot="effects-row" className="flex min-h-[var(--hit)] min-w-0 shrink-0 grow basis-auto">
              <button
                type="button"
                data-option={option.id}
                aria-disabled={savingId !== null || undefined}
                aria-label={saving ? t("common.saving") : `${spoken.join(". ")}.`}
                aria-describedby={describedBy}
                onClick={() => {
                  if (savingId === null) onDecide(option.id);
                }}
                className="grid w-full min-w-0 content-center items-center gap-y-0.5 rounded-lg bg-card px-3 py-1 text-start outline-hidden transition-colors active:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-disabled:cursor-not-allowed"
                style={{ gridTemplateColumns: template }}
              >
                <span className="min-w-0 font-heading text-entry font-bold uppercase leading-4 tracking-wide">{saving ? t("common.saving") : option.label}</span>
                {STATS.map((stat) => (
                  <span key={stat} data-stat={stat} className="flex justify-end">
                    <StatValue change={changes[stat]} />
                  </span>
                ))}
                {chevron ? <ChevronRight data-slot="followup-chevron" aria-hidden="true" className="size-5 justify-self-end text-muted-foreground" /> : null}
                {cost && !roomy ? (
                  <>
                    <span id={descId} className="sr-only">{option.description}</span>
                    <span data-slot="effects-cost-line" aria-hidden="true" className="col-span-full text-caption leading-[0.9375rem] text-warning">
                    {t("scrims.costMark")} {"·"} {t(cost.kind === "cancelsNext" ? "scrims.effect.cancelsNext" : "scrims.effect.cancelStep", { label: cost.label, rep: signed(cost.reputation), count: cost.cancellations })}
                    </span>
                  </>
                ) : (
                  <span id={descId} className="col-span-full text-caption leading-[0.9375rem] text-muted-foreground">
                    {option.description}
                  </span>
                )}
                {roomy ? <Extras neutral={neutral} noteIds={noteIds} cost={cost} costId={costId} reputation={reputation} /> : null}
              </button>
            </li>
          );
        })}
      </ul>
      {/* A faint band over each stat column, from the header to the last row, so the eye keeps the column (above the rows, which are opaque). */}
      <div aria-hidden="true" data-slot="effects-bands" className="pointer-events-none absolute inset-0 z-10 grid px-3" style={{ gridTemplateColumns: template }}>
        <span />
        {STATS.map((stat) => (
          <span key={stat} className="bg-foreground/[0.06]" />
        ))}
        {chevron ? <span /> : null}
      </div>
    </div>
  );
}

function Extras({ neutral, noteIds, cost, costId, reputation }: { neutral: readonly EffectLine[]; noteIds: readonly string[]; cost: CostLine | undefined; costId: string | null; reputation: number }): ReactNode {
  if (neutral.length === 0 && !cost) return null;
  return (
    <>
      {neutral.map((line, index) => (
        <span key={`${line.kind}-${index}`} id={noteIds[index]} data-slot="effects-note" className="col-span-full mt-0.5 flex items-center gap-2 rounded-lg border border-line px-3 py-1 text-caption leading-4">
          {line.kind === "playsNext" ? <Play aria-hidden="true" className="size-3.5 shrink-0" /> : null}
          <ul className="m-0 min-w-0 list-none p-0 [&_li]:font-normal [&_li]:text-foreground [&_svg]:size-3.5">
            <EffectLineText line={line} />
          </ul>
        </span>
      ))}
      {cost ? <CostBox line={cost} reputation={reputation} sentenceId={costId ?? undefined} /> : null}
    </>
  );
}

/** The cost mark and the sentence the follow-ups' title carries: any follow-up cancels the next block. */
export function CancelNote({ line }: { line: Extract<EffectLine, { kind: "cancelsNext" }> }) {
  return (
    <div data-slot="followup-cost" className="flex max-w-[26rem] min-w-0 items-center gap-2">
      <CostMark className="shrink-0" />
      <ul className={cn("m-0 min-w-0 list-none p-0 text-caption leading-4 [&_li]:font-normal [&_li]:text-muted-foreground [&_svg]:hidden")}>
        <EffectLineText line={line} />
      </ul>
    </div>
  );
}
