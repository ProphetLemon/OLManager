import { useTranslation } from "react-i18next";
import { Ban, ClipboardList, Flag, Heart, Layers, Swords, Target, type LucideIcon } from "lucide-react";

import { SCRIM_FOCUS_IMPACT_KEYS, SCRIM_FOCUS_OBJECTIVE_KEYS } from "@/lib/scrims/scrimFocusKeys";
import type { ScrimFocus } from "@/store/gameStore";
import { cn } from "@/ui-v2/lib/utils";
import { LockNote, PhoneOption } from "./PhoneOption";
import { ScrimViewFrame } from "./ScrimViewFrame";

export interface ScrimObjectivePaneProps {
  /** The view's name: the frame's heading and the name of its back control. */
  title: string;
  onBack: () => void;
  objective: ScrimFocus | null;
  /** The setup is locked, a save is running or the assistant handles it: the choices keep their place and cannot be changed. */
  disabled: boolean;
  /** Why it is locked; null while it can be edited. */
  blockedText: string | null;
  /** One tap saves; `null` is "No objective set". */
  onSelect: (next: ScrimFocus | null) => void;
}

// The same order as the desktop setup panel.
const OBJECTIVES: ScrimFocus[] = ["DraftPrep", "ChampionPool", "EarlyGame", "Teamfighting", "Macro", "Mental"];

const ICONS: Record<ScrimFocus | "none", LucideIcon> = {
  none: Ban,
  DraftPrep: ClipboardList,
  ChampionPool: Layers,
  EarlyGame: Target,
  Teamfighting: Swords,
  Macro: Flag,
  Mental: Heart,
};

/**
 * Objetivo (frame Objective): seven choices in two columns read top to bottom, each a button with one
 * icon, its label in full and a check or a hollow ring, and the impact of the chosen one in the eighth cell.
 * Heights: 4 + 48 (the frame's top row) + 8 + 4 x 48 and 3 x 6 (the left column) + 12 = 282 of 286; the
 * impact sentence (12 px on 16) may take three lines in the last row, which is 48 to 51 high.
 */
export function ScrimObjectivePane({ title, onBack, objective, disabled, blockedText, onSelect }: ScrimObjectivePaneProps) {
  const { t } = useTranslation();
  const impact = objective ? t(SCRIM_FOCUS_IMPACT_KEYS[objective]) : t("scrims.noFocusImpactText");

  const choice = (key: ScrimFocus | "none", label: string, chosen: boolean, value: ScrimFocus | null) => {
    const Icon = ICONS[key];
    return (
      <PhoneOption key={key} checked={chosen} disabled={disabled} onSelect={() => onSelect(value)} className="self-start py-1">
        <Icon data-slot="objective-icon" aria-hidden="true" className={cn("size-6 shrink-0", chosen ? "text-club-text" : "text-muted-foreground")} />
        <span className={cn("min-w-0 flex-1 text-entry leading-tight", chosen ? "font-semibold" : "font-medium")}>{label}</span>
      </PhoneOption>
    );
  };

  return (
    <ScrimViewFrame title={title} onBack={onBack} lead={blockedText ? <LockNote>{blockedText}</LockNote> : undefined}>
      <div data-slot="scrim-objective-pane" className="h-full min-h-0 pb-3 pt-2">
        <div
          role="group"
          aria-label={t("training.scrims.weeklyObjective")}
          className="grid grid-flow-col grid-cols-[minmax(0,7fr)_minmax(0,5fr)] grid-rows-[repeat(3,3rem)_minmax(3rem,auto)] gap-x-2 gap-y-1.5"
        >
          {choice("none", t("training.scrims.objectives.none"), objective === null, null)}
          {OBJECTIVES.map((focus) => choice(focus, t(SCRIM_FOCUS_OBJECTIVE_KEYS[focus]), objective === focus, focus))}
          <p className="m-0 flex items-center border-s-[3px] border-club ps-3 text-caption leading-4">
            <span>
              <span className="me-1 font-heading text-entry font-semibold text-muted-foreground">{t("scrims.impactLabel")}</span>{" "}
              {impact}
            </span>
          </p>
        </div>
      </div>
    </ScrimViewFrame>
  );
}
