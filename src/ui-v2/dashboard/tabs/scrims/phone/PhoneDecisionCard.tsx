import { useId } from "react";
import { useTranslation } from "react-i18next";

import { DECISION_IMPACT_TAGS } from "@/lib/scrims/decisionTags";
import { cn } from "@/ui-v2/lib/utils";
import { CostMark, EffectLineText, isCostLine } from "../EffectText";
import type { DecisionOption } from "../ScrimDecisionPanel";
import { ScrimTag } from "../ScrimTag";

interface PhoneDecisionCardProps {
  option: DecisionOption;
  /** `card` stacks the label, tags and effects at full width; `row` puts the label and tags left and the effects right. */
  layout: "card" | "row";
  /** This card's decision is being saved. */
  saving: boolean;
  /** Some decision is being saved: every card keeps its place and stays focusable, but a press does nothing. */
  locked: boolean;
  onDecide: () => void;
  /** An extra line under the effects (the dashed mark of the reputation bar). */
  note?: string | null;
}

/**
 * One choice of a decision, one press decides. The whole card is the target (the button's `after`
 * covers it) and the button points to its tags and effects with `aria-describedby`, so a screen
 * reader hears what a choice costs as it lands on it. Never club-filled: an outline on the raised surface.
 */
export function PhoneDecisionCard({ option, layout, saving, locked, onDecide, note = null }: PhoneDecisionCardProps) {
  const { t } = useTranslation();
  const base = useId();
  const row = layout === "row";
  // A row sits under a heading that already says the block is cancelled and the day closes.
  const effects = row ? option.effects.filter((line) => line.kind !== "cancelsNext" && line.kind !== "closesDay") : option.effects;
  const cost = !row && option.effects.some(isCostLine);
  const tags = (
    <span id={`${base}-tags`} className={cn("flex flex-wrap gap-x-2", row ? "flex-col" : "justify-end")}>
      {DECISION_IMPACT_TAGS[option.id].map((tag) => (
        <ScrimTag key={tag} tag={tag} plain />
      ))}
    </span>
  );
  const button = (
    <button
      type="button"
      aria-disabled={locked || undefined}
      aria-describedby={`${base}-tags ${base}-effects`}
      onClick={() => {
        if (!locked) onDecide();
      }}
      className="min-w-0 text-start font-heading text-section font-semibold uppercase leading-tight tracking-wide outline-none after:absolute after:inset-0 after:rounded-lg aria-disabled:cursor-not-allowed"
    >
      {saving ? t("common.saving") : option.label}
    </button>
  );
  const effectList = (
    <ul id={`${base}-effects`} className="flex min-w-0 flex-col text-caption leading-tight">
      {effects.map((line, index) => (
        <EffectLineText key={`${line.kind}-${index}`} line={line} />
      ))}
    </ul>
  );

  return (
    <li
      data-slot="decision-card"
      data-layout={layout}
      className={cn(
        "relative rounded-lg border border-line bg-muted px-3 py-2 transition-colors hover:border-foreground",
        "has-[button:focus-visible]:outline-2 has-[button:focus-visible]:outline-offset-2 has-[button:focus-visible]:outline-ring",
        "has-[button[aria-disabled=true]]:opacity-65",
        row ? "grid min-h-[3.75rem] grid-cols-[9.375rem_minmax(0,1fr)] items-center gap-3 py-1" : "flex min-h-[5.25rem] flex-col gap-1",
      )}
    >
      {row ? (
        <div className="flex min-w-0 flex-col gap-0.5">
          {button}
          {tags}
        </div>
      ) : (
        <div className="flex items-start justify-between gap-x-2 gap-y-1">
          {button}
          <span className="flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1">
            {tags}
            {cost ? (
              <span aria-hidden="true">
                <CostMark />
              </span>
            ) : null}
          </span>
        </div>
      )}
      {effectList}
      {note ? <p className="text-caption text-muted-foreground">{note}</p> : null}
    </li>
  );
}
