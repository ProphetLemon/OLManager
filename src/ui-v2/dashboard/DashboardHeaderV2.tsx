import { AlertCircle, ArrowLeft, Calendar as CalendarIcon, ChevronDown, ChevronRight, Loader2, Play, Save, SkipForward, Swords } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/ui-v2/components/ui/button";
import { Separator } from "@/ui-v2/components/ui/separator";
import type { DashboardAlert } from "@/ui-v2/_legacy/components/dashboard/dashboardHelpers";

interface Props {
  activeTabLabel: string;
  currentDate: string;
  hasProfileHistory: boolean;
  isAdvancing: boolean;
  isSaving: boolean;
  saveFlash: boolean;
  hasMatchToday: boolean;
  dayPhase: string;
  alerts: DashboardAlert[];
  onBack: () => void;
  onSave: () => void;
  onContinue: () => void;
  onSkipToMatchDay: () => void;
  onSkipToNextDay: () => void;
  onNavigate: (tab: string) => void;
}

const PHASE_COLORS: Record<string, string> = {
  Morning: "text-amber-400",
  ScrimBlock: "text-blue-400",
  ReviewBlock: "text-emerald-400",
  TrainingBlock: "text-purple-400",
  Evening: "text-indigo-400",
};

export function DashboardHeaderV2({
  activeTabLabel,
  currentDate,
  hasProfileHistory,
  isAdvancing,
  isSaving,
  saveFlash,
  hasMatchToday,
  dayPhase,
  alerts,
  onBack,
  onSave,
  onContinue,
  onSkipToMatchDay,
  onSkipToNextDay,
  onNavigate,
}: Props) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const phaseLabels: Record<string, string> = {
    Morning: t("dashboard.phaseLabels.morning"),
    ScrimBlock: t("dashboard.phaseLabels.scrimBlock"),
    ReviewBlock: t("dashboard.phaseLabels.reviewBlock"),
    TrainingBlock: t("dashboard.phaseLabels.trainingBlock"),
    Evening: t("dashboard.phaseLabels.evening"),
  };
  const phaseLabel = phaseLabels[dayPhase] ?? dayPhase;
  const phaseColor = PHASE_COLORS[dayPhase] ?? "text-muted-foreground";

  function handleSelect(action: () => void) {
    setMenuOpen(false);
    action();
  }

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-4">
      {hasProfileHistory && (
        <>
          <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label={t("common.back")}>
            <ArrowLeft className="size-4" />
          </Button>
          <Separator orientation="vertical" className="h-5" />
        </>
      )}

      <h1 className="min-w-0 flex-1 truncate font-heading text-sm font-bold uppercase tracking-widest text-foreground">
        {activeTabLabel}
      </h1>

      {alerts.length > 0 && (() => {
        const alert = alerts[0];
        return (
          <button onClick={() => onNavigate(alert.tab)}
            className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-2xs font-heading font-bold uppercase tracking-wider transition-all border-warning/20 bg-warning/10 text-warning hover:bg-warning/20 dark:text-warning"
          >
            <AlertCircle className="h-3 w-3 shrink-0" />
            <span className="truncate max-w-32">{alert.text}</span>
            <ChevronRight className="h-2.5 w-2.5 shrink-0" />
          </button>
        );
      })()}

      {/* Day phase indicator */}
      <div className={`flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-1 ${phaseColor}`}>
        <span className="text-2xs font-heading font-bold uppercase tracking-wider">{phaseLabel}</span>
      </div>

      <div className="flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-1">
        <CalendarIcon className="size-3.5 text-club-text" />
        <span className="text-caption font-medium tabular-nums text-muted-foreground">
          {currentDate}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <Button variant="outline" size="sm" onClick={onSave} disabled={isSaving} className="h-7 gap-1.5 text-xs">
          {isSaving ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Save className="size-3.5" />
          )}
          <span>
            {saveFlash
              ? t("dashboard.saved", { defaultValue: "Saved" })
              : t("dashboard.save", { defaultValue: "Save" })}
          </span>
        </Button>

        <div className="relative flex" ref={menuRef}>
          <Button onClick={() => onContinue()} disabled={isAdvancing} size="sm" className="h-7 gap-1.5 rounded-r-none text-xs">
            {isAdvancing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : hasMatchToday ? (
              <Swords className="size-3.5" />
            ) : (
              <Play className="size-3.5" />
            )}
            <span>
              {hasMatchToday
                ? t("continueMenu.goToField", { defaultValue: "Match" })
                : t("dashboard.continue", { defaultValue: "Continue" })}
            </span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMenuOpen(!menuOpen)}
            disabled={isAdvancing}
            className="h-7 rounded-l-none border-l-0 px-1.5"
          >
            <ChevronDown className="size-3" />
          </Button>

          {menuOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-lg border border-border bg-card py-1 shadow-xl">
              {hasMatchToday && (
                <button
                  onClick={() => handleSelect(onContinue)}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors hover:bg-muted"
                >
                  <Swords className="size-3.5 text-club-text" />
                  <span className="font-medium text-foreground">{t("continueMenu.goToField", { defaultValue: "Jugar partido" })}</span>
                </button>
              )}
              <button
                onClick={() => handleSelect(onSkipToMatchDay)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors hover:bg-muted"
              >
                <SkipForward className="size-3.5 text-amber-400" />
                <span className="font-medium text-foreground">{t("continueMenu.skipToMatchDay", { defaultValue: "Ir al día de partido" })}</span>
              </button>
              <button
                onClick={() => handleSelect(onSkipToNextDay)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors hover:bg-muted"
              >
                <ChevronRight className="size-3.5 text-blue-400" />
                <span className="font-medium text-foreground">{t("continueMenu.skipToNextDay", { defaultValue: "Siguiente día" })}</span>
              </button>
              <div className="border-t border-border" />
              <button
                onClick={() => handleSelect(onContinue)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors hover:bg-muted"
              >
                <Play className="size-3.5" />
                <span className="font-medium text-foreground">{t("dashboard.continue", { defaultValue: "Continuar" })}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
