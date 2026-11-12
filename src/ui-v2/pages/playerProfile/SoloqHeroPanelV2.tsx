import { AlertTriangle, ArrowDown, ArrowUp, Check, Info, Pause } from "lucide-react";
import type { ComponentType } from "react";
import { buildChips, formatNumber, formatSigned, type Chip, type ChipIcon, type ChipTone, type Translate } from "@/lib/players/soloqHistory";
import { SOLOQ_EMBLEM_URLS, SOLOQ_TIER_COLORS, tierFromLp } from "@/lib/players/soloq";
import { findPreset } from "@/lib/players/soloqDecay";
import { cn } from "@/ui-v2/lib/utils";
import type { SoloqHistoryState } from "./useSoloqHistory";

const CHIP_ICONS: Record<ChipIcon, ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  alert: AlertTriangle,
  pause: Pause,
  check: Check,
  down: ArrowDown,
  up: ArrowUp,
  info: Info,
};

const CHIP_TONES: Record<ChipTone, string> = {
  positive: "text-positive",
  warning: "text-warning",
  negative: "text-negative",
  dim: "text-muted-foreground",
};

interface SoloqHeroPanelV2Props {
  state: SoloqHistoryState;
  /** Today's cached LP on the player, used until (or without) a history. */
  fallbackLp: number | null | undefined;
  language: string;
  t: Translate;
}

/** SoloQ block of the hero: tier, LP, change since yesterday, and what happens next. */
export default function SoloqHeroPanelV2({ state, fallbackLp, language, t }: SoloqHeroPanelV2Props) {
  const history = state.status === "ready" ? state.history : null;
  const last = history && history.days.length > 0 ? history.days[history.days.length - 1] : null;
  const previous = history && history.days.length > 1 ? history.days[history.days.length - 2] : null;
  const lp = last ? last.lp : (fallbackLp ?? null);
  if (lp === null) return null;

  const tier = tierFromLp(lp);
  const decayOn = history !== null && history.decay_mode !== "Off";
  const preset = history ? findPreset(state.status === "ready" ? state.presets : null, history.decay_mode) : null;
  const chips: Chip[] = history
    ? buildChips(
        {
          decayOn,
          preset,
          today: last,
          lp,
          bank: history.bank_days,
          bankMax: history.bank_max,
          offset: history.offset_lp,
          language,
        },
        t,
      )
    : [];
  const change = last && previous ? last.lp - previous.lp : null;

  const seeLadder = () => {
    const target = document.getElementById("ladder");
    if (!target) return;
    const calm = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
  };

  return (
    <section
      aria-label={t("soloqHistory.hero.label")}
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-white/15 bg-black/30 p-4 backdrop-blur-xs md:w-72"
    >
      <div className="flex items-center gap-3">
        <img src={SOLOQ_EMBLEM_URLS[tier]} alt="" className="size-14 shrink-0 object-contain" />
        <div className="flex min-w-0 flex-col gap-1">
          <span className={cn("font-heading text-section uppercase leading-none", SOLOQ_TIER_COLORS[tier])}>
            {lp === 0 ? t("soloqHistory.floorTier") : tier}
          </span>
          {lp > 0 ? (
            <span className="flex items-baseline gap-1.5">
              <span className="font-heading text-title leading-none tabular-nums text-white">{formatNumber(lp, language)}</span>
              <span className="font-heading text-2xs uppercase tracking-wide text-muted-foreground">LP</span>
            </span>
          ) : null}
        </div>
      </div>
      {change !== null ? (
        <p className={cn("text-sm font-semibold", change > 0 ? "text-positive" : change < 0 ? "text-negative" : "text-muted-foreground")}>
          {change === 0
            ? t("soloqHistory.hero.noChange")
            : t("soloqHistory.hero.change", { change: formatSigned(change, language) })}
        </p>
      ) : null}
      {chips.length > 0 ? (
        <ul aria-label={t("soloqHistory.hero.statusLabel")} className="m-0 flex list-none flex-col gap-2 p-0">
          {chips.map((chip) => {
            const Icon = CHIP_ICONS[chip.icon];
            return (
              <li key={chip.id} className="flex items-start gap-2 text-sm text-foreground">
                <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", CHIP_TONES[chip.tone])} />
                <span>{chip.text}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {state.status === "ready" ? (
        <button
          type="button"
          onClick={seeLadder}
          className="inline-flex min-h-[var(--target-min)] items-center self-start rounded-md border border-white/25 px-3 font-heading text-sm font-bold uppercase tracking-wide text-foreground transition-colors hover:border-club-text hover:text-club-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {t("soloqHistory.hero.seeLadder")}
        </button>
      ) : null}
    </section>
  );
}
