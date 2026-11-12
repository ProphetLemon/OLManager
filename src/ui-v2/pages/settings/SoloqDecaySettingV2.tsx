import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SoloQDecayMode, SoloQDecayPreset, SoloQDecaySettings } from "@/api/types";
import {
  DECAY_PREVIEW_DAYS,
  DECAY_PREVIEW_START_LP,
  SOLOQ_DECAY_INTENSITIES,
  SOLOQ_DECAY_NEW_CAREER_MODE,
  findPreset,
  previewDecay,
  type SoloQDecayIntensity,
} from "@/lib/players/soloqDecay";
import { getSoloQDecaySettings, setSoloQDecayMode } from "@/services/playerService";
import { useGameStore } from "@/store/gameStore";
import { cn } from "@/ui-v2/lib/utils";

const CHART = { width: 340, height: 150, left: 40, right: 332, top: 12, bottom: 118 } as const;

function chartX(day: number): number {
  return CHART.left + (day * (CHART.right - CHART.left)) / DECAY_PREVIEW_DAYS;
}

function chartY(lp: number): number {
  return CHART.bottom - (lp / 1000) * (CHART.bottom - CHART.top);
}

/**
 * Settings > Gameplay: the per-save SoloQ inactivity decay. A switch turns it on or off and three
 * intensities set the numbers. It changes the loaded save; without one it only shows what a new
 * career starts with.
 */
export default function SoloqDecaySettingV2() {
  const { t, i18n } = useTranslation();
  const hasActiveGame = useGameStore((state) => state.hasActiveGame);
  const [settings, setSettings] = useState<SoloQDecaySettings | null>(null);
  const [remembered, setRemembered] = useState<SoloQDecayIntensity>("Real");
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const noteId = useId();
  const groupName = useId();

  useEffect(() => {
    if (!hasActiveGame) {
      setSettings(null);
      setLoadFailed(false);
      return undefined;
    }
    let cancelled = false;
    getSoloQDecaySettings()
      .then((loaded) => {
        if (cancelled) return;
        setSettings(loaded);
        setLoadFailed(false);
        if (loaded.mode !== "Off") setRemembered(loaded.mode);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [hasActiveGame]);

  const language = i18n?.language || "en";
  const number = (value: number) => new Intl.NumberFormat(language).format(value);
  const lp = (value: number) => number(value);

  const loaded = hasActiveGame && settings !== null;
  const mode: SoloQDecayMode = loaded ? settings.mode : SOLOQ_DECAY_NEW_CAREER_MODE;
  const enabled = mode !== "Off";
  const selected: SoloQDecayIntensity = mode === "Off" ? remembered : mode;
  const switchLocked = !loaded || saving;
  const groupLocked = !loaded || saving || !enabled;
  const presets = settings?.presets;
  const selectedPreset = findPreset(presets, selected);
  const activePreset = enabled ? selectedPreset : null;

  async function apply(next: SoloQDecayMode): Promise<void> {
    if (!loaded || saving) return;
    setSaving(true);
    setSaveFailed(false);
    try {
      const updated = await setSoloQDecayMode(next);
      setSettings(updated);
      if (updated.mode !== "Off") setRemembered(updated.mode);
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  }

  const preview = previewDecay(activePreset);
  const polyline = preview.points
    .map((value, day) => `${chartX(day).toFixed(1)},${chartY(value).toFixed(1)}`)
    .join(" ");
  const bank = activePreset?.bank_days ?? 0;
  const rate = activePreset?.decay_per_idle_day ?? 0;
  const winBack = activePreset?.recovery_per_played_day ?? 0;

  let headline: string;
  let detail: string;
  let chartLabel: string;
  if (!activePreset) {
    headline = t("soloqDecay.previewOffHeadline");
    detail = t("soloqDecay.previewOffDetail");
    chartLabel = t("soloqDecay.previewChartOff", { start: lp(DECAY_PREVIEW_START_LP), days: DECAY_PREVIEW_DAYS });
  } else {
    headline = t("soloqDecay.previewHeadline", { count: bank, rate: lp(rate) });
    if (preview.floorDay !== null) {
      detail = t("soloqDecay.previewFloorDetail", {
        start: lp(DECAY_PREVIEW_START_LP),
        day: preview.floorDay,
        rec: lp(winBack),
      });
      chartLabel = t("soloqDecay.previewChartFloor", {
        start: lp(DECAY_PREVIEW_START_LP),
        count: bank,
        rate: lp(rate),
        day: preview.floorDay,
      });
    } else {
      detail = t("soloqDecay.previewLossDetail", {
        days: DECAY_PREVIEW_DAYS,
        start: lp(DECAY_PREVIEW_START_LP),
        lost: lp(preview.lost),
        lp: lp(preview.endLp),
        rec: lp(winBack),
      });
      chartLabel = t("soloqDecay.previewChartLoss", {
        start: lp(DECAY_PREVIEW_START_LP),
        count: bank,
        rate: lp(rate),
        lp: lp(preview.endLp),
        days: DECAY_PREVIEW_DAYS,
      });
    }
  }

  const note = !hasActiveGame
    ? t("soloqDecay.noSave")
    : loadFailed
      ? t("soloqDecay.loadFailed")
      : saveFailed
        ? t("soloqDecay.saveFailed")
        : null;

  return (
    <section
      aria-labelledby={titleId}
      data-testid="soloq-decay-setting"
      className="flex flex-col gap-4 border-b border-border/40 py-4"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="font-heading text-sm font-bold uppercase tracking-wide text-foreground">
            {t("soloqDecay.title")}
          </h3>
          <p id={descriptionId} className="mt-1 max-w-prose text-xs text-muted-foreground/70">
            {t("soloqDecay.description")}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          disabled={switchLocked}
          onClick={() => void apply(enabled ? "Off" : remembered)}
          className="flex min-h-[var(--target-min)] min-w-[var(--target-min)] shrink-0 items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="min-w-[2.2rem] text-right font-heading text-sm font-bold uppercase tracking-wide text-foreground">
            {enabled ? t("soloqDecay.stateOn") : t("soloqDecay.stateOff")}
          </span>
          <span
            aria-hidden="true"
            className={cn(
              "relative block h-6 w-11 rounded-full border-2",
              enabled ? "border-club bg-club" : "border-dim bg-transparent",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 block size-4 rounded-full transition-[left] duration-150",
                enabled ? "left-[22px] bg-club-foreground" : "left-0.5 bg-foreground",
              )}
            />
          </span>
        </button>
      </div>

      <fieldset disabled={groupLocked} className="m-0 min-w-0 border-0 p-0">
        <legend className="mb-2 p-0 text-xs text-muted-foreground">{t("soloqDecay.intensity")}</legend>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          {SOLOQ_DECAY_INTENSITIES.map((intensity) => (
            <PresetOption
              key={intensity}
              name={groupName}
              intensity={intensity}
              preset={findPreset(presets, intensity)}
              checked={selected === intensity}
              active={enabled && selected === intensity}
              disabled={groupLocked}
              onPick={() => void apply(intensity)}
              number={number}
            />
          ))}
        </div>
      </fieldset>

      {note ? (
        <p
          id={noteId}
          role={saveFailed || loadFailed ? "alert" : "status"}
          className="text-xs text-muted-foreground"
        >
          {note}
        </p>
      ) : null}

      <div className="grid gap-4 rounded-lg border border-border bg-muted/20 p-3 md:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h4 className="font-heading text-sm font-bold uppercase tracking-wide text-foreground">
            {t("soloqDecay.previewTitle")}
          </h4>
          <div className="overflow-x-auto">
            <svg
              viewBox={`0 0 ${CHART.width} ${CHART.height}`}
              role="img"
              aria-label={chartLabel}
              className="block h-auto w-full min-w-[20rem]"
            >
              <line x1={CHART.left} x2={CHART.right} y1={CHART.top} y2={CHART.top} className="stroke-line" />
              <line
                x1={CHART.left}
                x2={CHART.right}
                y1={chartY(800)}
                y2={chartY(800)}
                className="stroke-dim"
                strokeDasharray="4 4"
              />
              <line x1={CHART.left} x2={CHART.right} y1={CHART.bottom} y2={CHART.bottom} className="stroke-dim" />
              <g className="fill-muted-foreground" fontSize="14">
                <text x={CHART.left - 4} y={CHART.top + 5} textAnchor="end">
                  {number(1000)}
                </text>
                <text x={CHART.left - 4} y={chartY(800) + 5} textAnchor="end">
                  {number(800)}
                </text>
                <text x={CHART.left - 4} y={CHART.bottom + 5} textAnchor="end">
                  0
                </text>
                <text x={CHART.left} y={CHART.height - 6}>
                  {t("soloqDecay.previewAxisDay", { day: 0 })}
                </text>
                <text x={CHART.right} y={CHART.height - 6} textAnchor="end">
                  {t("soloqDecay.previewAxisDay", { day: DECAY_PREVIEW_DAYS })}
                </text>
              </g>
              <polyline
                points={polyline}
                fill="none"
                className="stroke-club"
                strokeWidth="3"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <circle cx={chartX(DECAY_PREVIEW_DAYS)} cy={chartY(preview.endLp)} r="4.5" className="fill-club" />
            </svg>
          </div>
          <p className="text-xs text-muted-foreground">{t("soloqDecay.previewLegend")}</p>
        </div>
        <div className="flex min-w-0 flex-col justify-center gap-2">
          <p aria-live="polite" className="font-heading text-section text-foreground">
            {headline}
          </p>
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {detail}
          </p>
        </div>
      </div>

      <p className="max-w-prose text-xs text-muted-foreground">{t("soloqDecay.footnote")}</p>
    </section>
  );
}

interface PresetOptionProps {
  name: string;
  intensity: SoloQDecayIntensity;
  preset: SoloQDecayPreset | null;
  checked: boolean;
  active: boolean;
  disabled: boolean;
  onPick: () => void;
  number: (value: number) => string;
}

function PresetOption({ name, intensity, preset, checked, active, disabled, onPick, number }: PresetOptionProps) {
  const { t } = useTranslation();
  const rows: Array<[string, string]> = preset
    ? [
        [t("soloqDecay.lossPerIdleDay"), t("soloqDecay.lossValue", { value: number(preset.decay_per_idle_day) })],
        [t("soloqDecay.gracePeriod"), t("soloqDecay.daysValue", { count: preset.bank_days })],
        [t("soloqDecay.winBackPerDay"), t("soloqDecay.winBackValue", { value: number(preset.recovery_per_played_day) })],
      ]
    : [];

  return (
    <label
      className={cn(
        "relative block min-h-[var(--target-min)]",
        disabled ? "cursor-not-allowed" : "cursor-pointer",
      )}
    >
      <input
        type="radio"
        name={name}
        value={intensity}
        checked={checked}
        disabled={disabled}
        onChange={onPick}
        className="peer sr-only"
      />
      <span
        className={cn(
          "flex h-full flex-col gap-1.5 rounded-lg border-2 px-3 py-2.5 transition-colors",
          "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring",
          disabled && !active && "opacity-70",
          active
            ? "border-club bg-club text-club-foreground"
            : checked
              ? "border-club bg-secondary text-foreground"
              : "border-border bg-secondary text-foreground",
        )}
      >
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={cn(
              "flex size-[18px] shrink-0 items-center justify-center rounded-full border-2",
              active ? "border-club-foreground" : checked ? "border-club" : "border-dim",
            )}
          >
            <span
              className={cn(
                "size-2 rounded-full",
                checked ? (active ? "bg-club-foreground" : "bg-club") : "bg-transparent",
              )}
            />
          </span>
          <span className="font-heading text-section uppercase">{t(`soloqDecay.modes.${intensity.toLowerCase()}`)}</span>
        </span>
        <span className="flex flex-col gap-0.5 text-xs tabular-nums">
          {rows.map(([label, value]) => (
            <span key={label} className="flex justify-between gap-2">
              <span className={active ? "text-club-foreground" : "text-muted-foreground"}>{label}</span>
              <strong>{value}</strong>
            </span>
          ))}
        </span>
      </span>
    </label>
  );
}
