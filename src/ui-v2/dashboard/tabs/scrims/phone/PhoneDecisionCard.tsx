import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";

import type { EffectLine } from "@/lib/scrims/decisionEffects";
import type { ScrimReportData } from "@/store/gameStore";
import { cn } from "@/ui-v2/lib/utils";
import { CostMark, EffectLineText } from "../EffectText";
import type { DecisionOption } from "../ScrimDecisionPanel";
import { ChangeValue, PlayersChange, ReputationBar } from "./PhoneChange";

/** `card`: one of two options at full height; `dense`: one of several, a row of three columns; `hairline`: a follow-up, a row between hairlines. */
export type DecisionCardLayout = "card" | "dense" | "hairline";

interface PhoneDecisionCardProps {
  option: DecisionOption;
  layout: DecisionCardLayout;
  /** The report the decision is about: the before of the quality and the severity. */
  report: ScrimReportData;
  /** Rep scrims now: the bar's value, from which the dashed mark is drawn. */
  reputation: number;
  /** This card's decision is being saved. */
  saving: boolean;
  /** Some decision is being saved: every card keeps its place and stays focusable, but a press does nothing. */
  locked: boolean;
  onDecide: () => void;
}

/** The sentence of a cost, said once and quietly: the amber chip beside it already carries the cost. */
const PLAIN = "[&_li]:font-normal [&_li]:text-muted-foreground [&_svg]:hidden";

/** Lines a layout leaves out because the screen already says them once (the follow-ups' title, the dense rows' top row). */
const OMITTED: Record<DecisionCardLayout, readonly EffectLine["kind"][]> = { card: [], dense: ["closesDay"], hairline: ["cancelsNext", "closesDay"] };

const isCancel = (line: EffectLine): line is Extract<EffectLine, { kind: "cancelStep" | "cancelsNext" }> => line.kind === "cancelStep" || line.kind === "cancelsNext";

function Pair({ label, tone, before, after }: { label: string; tone: "gain"; before: number; after: number }) {
  return (
    <li className="flex min-w-0 items-center justify-between gap-2 text-caption leading-[1.125rem]">
      <span className="min-w-0 truncate text-muted-foreground">{label}</span>
      <ChangeValue tone={tone} before={before} after={after} />
    </li>
  );
}

/**
 * One choice of a decision, one press decides. The title is the real button and its `after` covers the
 * whole card, so the target is the card; the button points to the description and the effects with
 * `aria-describedby`, so a screen reader hears what a choice does as it lands on it. The effects are
 * short before-and-after pairs; an option that cancels shows Rep scrims as a bar with a dashed mark.
 * No tag words and no dimming: the card that saves says Saving.
 */
export function PhoneDecisionCard({ option, layout, report, reputation, saving, locked, onDecide }: PhoneDecisionCardProps) {
  const { t } = useTranslation();
  const base = useId();
  const dense = layout === "dense";
  const hairline = layout === "hairline";
  const shown = option.effects.filter((line) => !OMITTED[layout].includes(line.kind));
  const cancel = hairline ? undefined : shown.find(isCancel);
  const repAfter = cancel ? Math.max(0, reputation + cancel.reputation) : 0;
  const players = shown.find((line) => line.kind === "players");

  const rows: ReactNode[] = [];
  shown.forEach((line, index) => {
    if (line.kind === "quality") rows.push(<Pair key={index} label={t("scrims.reportQuality")} tone="gain" before={report.quality} after={report.quality + line.delta} />);
    if (line.kind === "severity") rows.push(<Pair key={index} label={t("scrims.effect.severityLabel")} tone="gain" before={report.severity} after={Math.max(0, report.severity + line.delta)} />);
  });
  const sentences = shown.filter((line) => line.kind !== "quality" && line.kind !== "severity" && line.kind !== "players");

  const button = (
    <button
      type="button"
      aria-disabled={locked || undefined}
      aria-describedby={`${base}-desc ${base}-effects`}
      onClick={() => {
        if (!locked) onDecide();
      }}
      className={cn(
        "min-w-0 text-start font-heading font-bold uppercase tracking-wide outline-none after:absolute after:inset-0 after:rounded-[inherit] aria-disabled:cursor-not-allowed",
        dense ? "text-entry leading-tight" : "text-section leading-none",
      )}
    >
      {saving ? t("common.saving") : option.label}
    </button>
  );

  const effects = (
    <ul id={`${base}-effects`} className="m-0 flex min-w-0 list-none flex-col gap-0.5 p-0">
      {rows}
      {players?.kind === "players" ? (
        <li className="text-caption leading-[1.125rem]">
          <PlayersChange morale={players.morale} condition={players.condition} />
        </li>
      ) : null}
      {cancel ? (
        <li className="flex items-center gap-2 text-caption leading-[1.125rem]">
          <span className="shrink-0 text-muted-foreground">{t("scrims.reputation")}</span>
          <ReputationBar className="min-w-8 flex-1" label={t("scrims.reputation")} value={reputation} after={repAfter} />
          <ChangeValue tone="cost" before={reputation} after={repAfter} />
        </li>
      ) : null}
      {sentences.map((line, index) => (
        <li key={`${line.kind}-${index}`} className="text-caption leading-4">
          <ul className={cn("m-0 list-none p-0", isCancel(line) && PLAIN)}>
            <EffectLineText line={line} />
          </ul>
        </li>
      ))}
    </ul>
  );

  return (
    <li
      data-slot="decision-card"
      data-layout={layout}
      className={cn(
        "relative flex min-h-[var(--hit)] min-w-0 flex-1 basis-0 items-center transition-colors",
        "has-[button:focus-visible]:outline-2 has-[button:focus-visible]:outline-offset-2 has-[button:focus-visible]:outline-ring",
        layout === "card" && "rounded-xl bg-card px-4 py-2.5",
        dense && "rounded-lg bg-card px-3 py-0.5",
        hairline && "border-t border-line px-2 py-1",
      )}
    >
      <div
        className={cn(
          "grid w-full min-w-0 items-center gap-x-3.5",
          layout === "card" && "grid-cols-[10.5rem_minmax(0,1fr)]",
          dense && "grid-cols-[6.5rem_minmax(0,1fr)_11.5rem] gap-x-2.5",
          hairline && "grid-cols-[11.5rem_minmax(0,1fr)_10rem_1.25rem] gap-x-3",
        )}
      >
        <div className={cn("min-w-0", layout === "card" ? "flex flex-col gap-1" : "contents")}>
          {button}
          <p id={`${base}-desc`} className={cn("m-0 text-caption text-muted-foreground", dense ? "line-clamp-3 leading-[0.9375rem]" : "leading-[0.9375rem]")}>
            {option.description}
          </p>
        </div>
        {effects}
        {hairline ? <ChevronRight data-slot="followup-chevron" aria-hidden="true" className="size-5 text-muted-foreground" /> : null}
      </div>
    </li>
  );
}

/** The cost mark and the sentence the follow-ups' title carries: any follow-up cancels the next block. */
export function CancelNote({ line }: { line: Extract<EffectLine, { kind: "cancelsNext" }> }) {
  return (
    <div data-slot="followup-cost" className="flex max-w-[26rem] min-w-0 items-center gap-2">
      <CostMark className="shrink-0" />
      <ul className={cn("m-0 min-w-0 list-none p-0 text-caption leading-4", PLAIN)}>
        <EffectLineText line={line} />
      </ul>
    </div>
  );
}
