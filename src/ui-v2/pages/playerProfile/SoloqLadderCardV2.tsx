import { ChevronLeft, ChevronRight, LineChart } from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";
import type { SoloQHistoryDay } from "@/api/types";
import { findPreset } from "@/lib/players/soloqDecay";
import { SOLOQ_TIER_COLORS, tierFromLp } from "@/lib/players/soloq";
import {
  DAY_KIND_VISUALS,
  LEGEND_GLYPH_PATHS,
  buildChartModel,
  buildKpis,
  buildStory,
  clampIndex,
  dayKindWord,
  focusLabel,
  formatLongDate,
  formatNumber,
  offsetOf,
  rangeOptions,
  rangeStart,
  selectedDayStatus,
  type DayGlyph,
  type DayTone,
  type Kpi,
  type Translate,
} from "@/lib/players/soloqHistory";
import { Button } from "@/ui-v2/components/ui/button";
import { Card, CardContent } from "@/ui-v2/components/ui/card";
import { SegmentedControl } from "@/ui-v2/components/ui/segmented-control";
import { cn } from "@/ui-v2/lib/utils";
import SoloqDayTableV2 from "./SoloqDayTableV2";
import SoloqGracePanelV2 from "./SoloqGracePanelV2";
import SoloqLpChartV2 from "./SoloqLpChartV2";
import SoloqSettingsLink from "./SoloqSettingsLink";
import type { SoloqHistoryState } from "./useSoloqHistory";

export interface SoloqMatchNote {
  opponent: string;
  won: boolean;
  kda: string;
}

const TONE_FILL: Record<DayTone, string> = {
  positive: "fill-positive",
  warning: "fill-warning",
  negative: "fill-negative",
  foreground: "fill-foreground",
  dim: "fill-none stroke-dim",
};

const KPI_TONE: Record<Exclude<Kpi["tone"], "tier">, string> = {
  foreground: "text-foreground",
  positive: "text-positive",
  negative: "text-negative",
  dim: "text-muted-foreground",
};

interface SoloqLadderCardV2Props {
  state: SoloqHistoryState;
  language: string;
  t: Translate;
  /** Matches the player played, by YYYY-MM-DD, to say what happened on a match day. */
  matchesByDate?: ReadonlyMap<string, SoloqMatchNote>;
  /** The profile's scout action, shown in the "no history yet" state. */
  scoutAction?: ReactNode;
}

/** The LP history of one player: story, KPIs, chart, day inspector, grace period and rules. */
export default function SoloqLadderCardV2({ state, language, t, matchesByDate, scoutAction }: SoloqLadderCardV2Props) {
  if (state.status !== "ready") return null;
  const { history, presets } = state;
  const decayOn = history.decay_mode !== "Off";
  const preset = findPreset(presets, history.decay_mode);
  const modeLabel = t(`soloqDecay.modes.${history.decay_mode.toLowerCase()}`);

  return (
    <section id="ladder" aria-labelledby="soloq-ladder-title" className="mb-5 scroll-mt-4">
      <Card>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <div className="min-w-0 flex-1 basis-72">
              <h2 id="soloq-ladder-title" className="font-heading text-section uppercase leading-tight">
                {t("soloqHistory.title")}
              </h2>
              <p className="mt-1.5 max-w-prose text-muted-foreground">
                {t("soloqHistory.decayStatus", { mode: modeLabel })}
              </p>
              <SoloqSettingsLink
                label={t("soloqHistory.changeInSettings")}
                className="inline-flex min-h-[var(--target-min)] items-center text-club-text underline underline-offset-4 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
              <p className="max-w-prose text-xs text-muted-foreground">{t("soloqHistory.scope")}</p>
            </div>
          </div>

          {history.days.length === 0 ? (
            <EmptyHistory
              followed={history.followed}
              decayOn={decayOn}
              bank={history.bank_days}
              bankMax={history.bank_max}
              offset={history.offset_lp}
              language={language}
              scoutAction={scoutAction}
              t={t}
            />
          ) : (
            <LadderBody
              days={history.days}
              decayOn={decayOn}
              bankMax={history.bank_max}
              modeLabel={modeLabel}
              preset={preset}
              language={language}
              matchesByDate={matchesByDate}
              t={t}
            />
          )}
        </CardContent>
      </Card>
    </section>
  );
}

interface EmptyHistoryProps {
  followed: boolean;
  decayOn: boolean;
  bank: number;
  bankMax: number;
  offset: number;
  language: string;
  scoutAction?: ReactNode;
  t: Translate;
}

function EmptyHistory({ followed, decayOn, bank, bankMax, offset, language, scoutAction, t }: EmptyHistoryProps) {
  const grace = decayOn
    ? `${t("soloqHistory.empty.grace", { bank, cap: bankMax })} ${
        offset > 0 ? t("soloqHistory.empty.held", { offset: formatNumber(offset, language) }) : t("soloqHistory.empty.noneHeld")
      }`
    : t("soloqHistory.empty.graceOff");

  return (
    <div className="flex flex-wrap items-start gap-6">
      <div className="flex min-w-0 flex-[999_1_28rem] flex-col items-start gap-3 rounded-xl border border-line bg-rail p-7">
        <LineChart aria-hidden className="size-10 text-dim" />
        <h3 className="font-heading text-section uppercase leading-tight">
          {followed ? t("soloqHistory.empty.startedTitle") : t("soloqHistory.empty.title")}
        </h3>
        <p className="max-w-prose">{followed ? t("soloqHistory.empty.startedText") : t("soloqHistory.empty.text")}</p>
        {!followed ? scoutAction : null}
      </div>
      <section
        aria-labelledby="soloq-empty-grace-title"
        className="flex min-w-0 max-w-md flex-[1_1_20rem] flex-col gap-3 rounded-xl border border-line bg-rail p-5"
      >
        <h3 id="soloq-empty-grace-title" className="font-heading text-section uppercase leading-tight">
          {t("soloqHistory.empty.graceTitle")}
        </h3>
        <p>{grace}</p>
      </section>
    </div>
  );
}

interface LadderBodyProps {
  days: readonly SoloQHistoryDay[];
  decayOn: boolean;
  bankMax: number;
  modeLabel: string;
  preset: ReturnType<typeof findPreset>;
  language: string;
  matchesByDate?: ReadonlyMap<string, SoloqMatchNote>;
  t: Translate;
}

function LadderBody({ days, decayOn, bankMax, modeLabel, preset, language, matchesByDate, t }: LadderBodyProps) {
  const total = days.length;
  const last = total - 1;
  const options = rangeOptions(total);
  const [range, setRange] = useState<number>(options[options.length - 1]);
  const [picked, setPicked] = useState<number | null>(null);
  const [tableOpen, setTableOpen] = useState(false);
  const tableId = useId();
  const sliderId = useId();

  const activeRange = options.includes(range) ? range : options[options.length - 1];
  const start = rangeStart(total, activeRange);
  const sel = clampIndex(picked, start, last);
  const day = days[sel];
  const previous = sel > 0 ? days[sel - 1] : null;
  const rangeLength = last - start + 1;

  const story = useMemo(
    () => buildStory({ days, start, decayOn, preset, bankMax, language }, t),
    [days, start, decayOn, preset, bankMax, language, t],
  );
  const kpis = useMemo(() => buildKpis({ days, start, decayOn, language }, t), [days, start, decayOn, language, t]);
  const model = useMemo(
    () => buildChartModel({ days, start, sel, decayOn, language, headline: story.headline }, t),
    [days, start, sel, decayOn, language, story.headline, t],
  );

  const status = selectedDayStatus(day, previous, { decayOn, bankMax, language }, t);
  const held = offsetOf(day);
  const diff = day.lp - day.formula_lp;
  const tier = tierFromLp(day.lp);
  const match = matchesByDate?.get(day.date.slice(0, 10));
  const sliderText = `${formatLongDate(day.date, language)}. ${
    day.lp === 0 ? t("soloqHistory.floorTier") : `${formatNumber(day.lp, language)} LP, ${tier}`
  }. ${status}`;

  const legend: Array<{ glyph: DayGlyph; tone: DayTone; label: string }> = [
    { ...DAY_KIND_VISUALS.Played, label: t("soloqHistory.kinds.played") },
    { ...DAY_KIND_VISUALS.Idle, label: t(decayOn ? "soloqHistory.kinds.grace" : "soloqHistory.kinds.idle") },
  ];
  if (decayOn) legend.push({ ...DAY_KIND_VISUALS.Decay, label: t("soloqHistory.kinds.decay") });
  legend.push({ ...DAY_KIND_VISUALS.Match, label: t("soloqHistory.legend.match") });
  legend.push({ ...DAY_KIND_VISUALS.Rest, label: t("soloqHistory.legend.rest") });

  return (
    <>
      {options.length > 1 ? (
        <div className="-mt-2 flex justify-end">
          <SegmentedControl
            ariaLabel={t("soloqHistory.range.label")}
            value={String(activeRange)}
            onValueChange={(value) => setRange(Number(value))}
            options={options.map((option) => ({ value: String(option), label: t("soloqHistory.range.option", { count: option }) }))}
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <p className="max-w-[34ch] font-heading text-title leading-tight">{story.headline}</p>
        <p className="max-w-[70ch] text-muted-foreground">{story.sub}</p>
      </div>

      <div className="flex flex-wrap gap-3">
        {kpis.map((kpi) => (
          <div key={kpi.id} className="flex min-w-0 flex-[1_1_12rem] flex-col gap-1.5 rounded-xl border border-line bg-card px-4 py-3.5">
            <span className="font-heading text-2xs uppercase tracking-wide text-muted-foreground">{kpi.label}</span>
            <span
              className={cn(
                "font-heading text-title leading-none tabular-nums",
                kpi.tone === "tier" && kpi.tier ? SOLOQ_TIER_COLORS[kpi.tier] : kpi.tone === "tier" ? "" : KPI_TONE[kpi.tone],
              )}
            >
              {kpi.value}
            </span>
            <span className="text-xs text-muted-foreground">{kpi.sub}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[999_1_34rem] flex-col gap-3.5">
          <div role="group" aria-label={t("soloqHistory.readout.group")} className="flex flex-wrap gap-2.5">
            <ReadoutCell className="flex-[2_1_16rem]" label={formatLongDate(day.date, language)}>
              <span className="font-semibold">{status}</span>
            </ReadoutCell>
            <ReadoutCell label={decayOn ? t("soloqHistory.readout.withDecay") : "LP"}>
              <span className="flex flex-wrap items-baseline gap-x-2.5">
                <span className="font-heading text-title leading-none tabular-nums">
                  {t("soloqHistory.lpValue", { value: formatNumber(day.lp, language) })}
                </span>
                <span className={cn("font-heading text-base uppercase", SOLOQ_TIER_COLORS[tier])}>
                  {day.lp === 0 ? t("soloqHistory.floorTier") : tier}
                </span>
              </span>
            </ReadoutCell>
            {decayOn ? (
              <>
                <ReadoutCell label={t("soloqHistory.readout.formula")}>
                  <span className="flex flex-wrap items-baseline gap-x-2.5">
                    <span className="font-heading text-title leading-none tabular-nums text-muted-foreground">
                      {t("soloqHistory.lpValue", { value: formatNumber(day.formula_lp, language) })}
                    </span>
                    <span className={cn("font-semibold", diff < 0 ? "text-negative" : "text-muted-foreground")}>
                      {diff === 0
                        ? t("soloqHistory.readout.sameLp")
                        : t("soloqHistory.readout.diffWithDecay", { diff: `${diff < 0 ? "−" : "+"}${formatNumber(Math.abs(diff), language)}` })}
                    </span>
                  </span>
                </ReadoutCell>
                <ReadoutCell label={t("soloqHistory.readout.offset")}>
                  <span className="font-heading text-title leading-none tabular-nums">
                    {held > 0 ? t("soloqHistory.lpValue", { value: formatNumber(-held, language) }) : t("soloqHistory.lpValue", { value: "0" })}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {held > 0
                      ? day.lp === 0
                        ? t("soloqHistory.readout.offsetFloor")
                        : t("soloqHistory.readout.offsetHeld")
                      : t("soloqHistory.readout.offsetNone")}
                  </span>
                </ReadoutCell>
              </>
            ) : (
              <ReadoutCell label={t("soloqHistory.readout.decay")}>
                <span className="text-foreground">{t("soloqHistory.readout.decayOff")}</span>
              </ReadoutCell>
            )}
            <ReadoutCell label={t("soloqHistory.readout.focusMatch")}>
              <span className="font-semibold">{focusLabel(day.focus, t)}</span>
              <span className="text-xs text-muted-foreground">
                {match
                  ? t(match.won ? "soloqHistory.readout.matchWon" : "soloqHistory.readout.matchLost", {
                      opponent: match.opponent,
                      kda: match.kda,
                    })
                  : day.kind === "Match"
                    ? dayKindWord(day, decayOn, t)
                    : t("soloqHistory.readout.noMatch")}
              </span>
            </ReadoutCell>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="touch"
              aria-label={t("soloqHistory.ctl.prev")}
              disabled={sel <= start}
              onClick={() => setPicked(Math.max(start, sel - 1))}
            >
              <ChevronLeft aria-hidden />
              {t("soloqHistory.ctl.day")}
            </Button>
            <Button
              variant="outline"
              size="touch"
              aria-label={t("soloqHistory.ctl.next")}
              disabled={sel >= last}
              onClick={() => setPicked(Math.min(last, sel + 1))}
            >
              {t("soloqHistory.ctl.day")}
              <ChevronRight aria-hidden />
            </Button>
            <Button variant="outline" size="touch" disabled={sel === last} onClick={() => setPicked(null)}>
              {t("soloqHistory.ctl.today")}
            </Button>
            <p className="m-0 ml-1.5 text-xs text-muted-foreground">
              {t(sel === last ? "soloqHistory.ctl.hintToday" : "soloqHistory.ctl.hint", { index: sel - start + 1, total: rangeLength })}
            </p>
          </div>

          <SoloqLpChartV2 model={model} decayOn={decayOn} start={start} last={last} onSelect={setPicked} t={t} />

          <div className="flex flex-col gap-0.5">
            <label htmlFor={sliderId} className="font-heading text-2xs uppercase tracking-wide text-muted-foreground">
              {t("soloqHistory.ctl.slider")}
            </label>
            <input
              id={sliderId}
              type="range"
              min={start}
              max={last}
              step={1}
              value={sel}
              onChange={(event) => setPicked(Number(event.target.value))}
              aria-valuetext={sliderText}
              className="m-0 h-11 w-full accent-club"
            />
          </div>

          <ul aria-label={t("soloqHistory.legend.label")} className="m-0 flex list-none flex-wrap items-center gap-x-5 gap-y-2.5 p-0 text-muted-foreground">
            <li className="inline-flex items-center gap-2">
              <svg width="30" height="10" aria-hidden>
                <line x1="0" x2="30" y1="5" y2="5" className="stroke-club-text" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
              LP
            </li>
            {decayOn ? (
              <>
                <li className="inline-flex items-center gap-2">
                  <svg width="30" height="10" aria-hidden>
                    <line x1="2" x2="28" y1="5" y2="5" className="stroke-club-text" strokeWidth="4" strokeDasharray="3 6" strokeLinecap="round" />
                  </svg>
                  {t("soloqHistory.legend.decaying")}
                </li>
                <li className="inline-flex items-center gap-2">
                  <svg width="30" height="10" aria-hidden>
                    <line x1="0" x2="30" y1="5" y2="5" className="stroke-muted-foreground" strokeWidth="1.5" strokeDasharray="6 4" />
                  </svg>
                  {t("soloqHistory.readout.formula")}
                </li>
              </>
            ) : null}
            {legend.map((item) => (
              <li key={item.label} className="inline-flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                  <path d={LEGEND_GLYPH_PATHS[item.glyph]} className={TONE_FILL[item.tone]} strokeWidth="2" />
                </svg>
                {item.label}
              </li>
            ))}
            <li className="ml-auto">
              <Button
                variant="outline"
                size="touch"
                aria-expanded={tableOpen}
                aria-controls={tableId}
                onClick={() => setTableOpen((open) => !open)}
              >
                {t(tableOpen ? "soloqHistory.table.hide" : "soloqHistory.table.show")}
              </Button>
            </li>
          </ul>

          <p className="max-w-[70ch] text-xs text-muted-foreground">{t("soloqHistory.tierNote")}</p>

          {tableOpen ? (
            <SoloqDayTableV2
              id={tableId}
              days={days}
              start={start}
              selected={sel}
              decayOn={decayOn}
              bankMax={bankMax}
              language={language}
              t={t}
            />
          ) : null}
        </div>

        <div className="min-w-0 max-w-md flex-[1_1_20rem]">
          <SoloqGracePanelV2
            days={days}
            selected={sel}
            decayOn={decayOn}
            bankMax={bankMax}
            modeLabel={modeLabel}
            preset={preset}
            language={language}
            t={t}
          />
        </div>
      </div>
    </>
  );
}

function ReadoutCell({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn("flex min-w-0 flex-[1_1_12rem] flex-col gap-1 rounded-xl border border-line bg-rail px-4 py-3", className)}>
      <span className="font-heading text-2xs uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
