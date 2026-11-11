import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { useSettingsStore, AppSettings } from "@/store/settingsStore";
import { Select } from "@/ui-v2/_legacy/components/ui";
import { SUPPORTED_LANGUAGES } from "@/i18n";
import {
  ArrowLeft,
  Monitor,
  Gamepad2,
  Save,
  Zap,
  Trash2,
  Download,
  Globe,
  Bug,
  Type,
  Maximize,
  Minimize,
  RefreshCw,
  CheckCircle2,
  Database,
} from "lucide-react";
import {
  autoImportDatabase,
  getCatalogSummary,
  getImportCacheInfo,
  importCachedExport,
  importExportZip,
  type ImportCacheInfo,
  type ImportProgress,
  type ImportSummary,
} from "@/lib/dataImport";
import { useUpdater } from "@/hooks/useUpdater";
import { APP_VERSION } from "@/lib/common/appInfo";
import { APP_NAME } from "@/lib/common/appInfo";
import { useGameStore } from "@/store/gameStore";
import type { GameStateData } from "@/store/gameStore";

const CURRENCY_OPTIONS = [
  { value: "EUR", label: "Euro (€)", symbol: "€" },
  { value: "GBP", label: "Pound (£)", symbol: "£" },
  { value: "USD", label: "Dollar ($)", symbol: "$" },
] as const;

const MATCH_MODE_KEYS = ["live", "spectator"] as const;
const MATCH_SPEED_KEYS = ["slow", "normal", "fast"] as const;

export default function Settings() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, i18n } = useTranslation();
  const { settings, loaded, loadSettings, updateSettings } = useSettingsStore();
  const {
    updateAvailable,
    updateInfo,
    checking: checkingUpdate,
    noPlatformBuild,
    check: checkUpdate,
  } = useUpdater(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState("display");
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearSuccess, setClearSuccess] = useState(false);
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(
    !!document.fullscreenElement,
  );
  const [showUpToDate, setShowUpToDate] = useState(false);
  const prevChecking = useRef(checkingUpdate);
  const selectedLanguage = SUPPORTED_LANGUAGES.some(
    (lang) => lang.code === settings.language,
  )
    ? settings.language
    : "es";
  const isAndroid = /Android/i.test(navigator.userAgent);

  // Where to go back to
  const returnTo = (location.state as { from?: string })?.from || "/";

  useEffect(() => {
    if (!loaded) loadSettings();
  }, [loaded, loadSettings]);

  // Track fullscreen state
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
  };

  // Sync language with i18n when settings are loaded
  useEffect(() => {
    if (loaded && selectedLanguage && selectedLanguage !== i18n.language) {
      i18n.changeLanguage(selectedLanguage);
    }
  }, [loaded, selectedLanguage, i18n]);

  // Show "up to date" feedback when a manual check completes with no update
  useEffect(() => {
    if (prevChecking.current && !checkingUpdate && !updateAvailable && !noPlatformBuild) {
      setShowUpToDate(true);
      const timer = setTimeout(() => setShowUpToDate(false), 3000);
      return () => clearTimeout(timer);
    }
    prevChecking.current = checkingUpdate;
  }, [checkingUpdate, updateAvailable, noPlatformBuild]);

  const handleUpdate = (partial: Partial<AppSettings>) => {
    updateSettings(partial);

    // Sync language with i18n
    if (partial.language) {
      i18n.changeLanguage(partial.language);
    }
  };

  const handleClearSaves = async () => {
    try {
      await invoke("clear_all_saves");
      setClearSuccess(true);
      setConfirmClear(false);
      setTimeout(() => setClearSuccess(false), 3000);
    } catch (err) {
      console.error("Failed to clear saves:", err);
    }
  };

  const handleExportWorld = async () => {
    try {
      // Simple export to app data dir
      const path = await invoke<string>("export_world_database", {
        exportPath: "exported_world.json",
      });
      setExportPath(path);
      setTimeout(() => setExportPath(null), 5000);
    } catch (err) {
      console.error("Failed to export world:", err);
    }
  };

  if (!loaded) {
    return (
      <div className="h-full bg-background flex items-center justify-center transition-colors">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const gameSections: Array<{
    id: string;
    title: string;
    icon: React.ReactNode;
    content: React.ReactNode;
  }> = [
      {
        id: "display",
        title: t("settings.display"),
        icon: <Monitor className="w-5 h-5" />,
        content: (
          <>
            <GameRow
              label={t("settings.language")}
              description={t("settings.languageDesc")}
            >
              <Select
                value={selectedLanguage}
                variant="glass"
                onChange={(e) => handleUpdate({ language: e.target.value })}
                icon={<Globe className="w-4 h-4" />}
                className="min-w-48"
              >
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.label}
                  </option>
                ))}
              </Select>
            </GameRow>

            <GameRow
              label={t("settings.currency")}
              description={t("settings.currencyDesc")}
            >
              <Select
                value={settings.currency}
                variant="glass"
                onChange={(e) =>
                  handleUpdate({
                    currency: e.target.value as AppSettings["currency"],
                  })
                }
                className="min-w-48"
              >
                {CURRENCY_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.symbol} {c.label}
                  </option>
                ))}
              </Select>
            </GameRow>

            <GameRow
              label={t("settings.uiScale", "UI Scale")}
              description={t(
                "settings.uiScaleDesc",
                "Adjust font size and spacing for readability",
              )}
            >
              <div className="flex items-center gap-2">
                <Type className="w-4 h-4 text-muted-foreground/70" />
                <GameSegmented
                  options={[
                    { value: "xsmall", label: "XS" },
                    { value: "small", label: "S" },
                    { value: "normal", label: "M" },
                    { value: "large", label: "L" },
                    { value: "xlarge", label: "XL" },
                  ]}
                  value={settings.ui_scale}
                  onChange={(v) => {
                    if (isAndroid) return;
                    handleUpdate({ ui_scale: v as AppSettings["ui_scale"] });
                  }}
                />
                {isAndroid ? (
                  <span className="text-2xs font-heading uppercase tracking-wide text-muted-foreground/70">
                    {t(
                      "settings.uiScaleAndroidLocked",
                      "Bloqueado en XS en Android",
                    )}
                  </span>
                ) : null}
              </div>
            </GameRow>

            <GameRow
              label={t("settings.highContrast", "High Contrast")}
              description={t(
                "settings.highContrastDesc",
                "Strengthen text, borders and the focus outline for improved readability",
              )}
            >
              <GameToggle
                checked={settings.high_contrast}
                onChange={(v) => handleUpdate({ high_contrast: v })}
              />
            </GameRow>

            <GameRow
              label={t("settings.fullscreen", "Fullscreen")}
              description={t(
                "settings.fullscreenDesc",
                "Toggle fullscreen mode for an immersive experience",
              )}
            >
              <GameButton onClick={toggleFullscreen}>
                {isFullscreen ? (
                  <Minimize className="w-4 h-4" />
                ) : (
                  <Maximize className="w-4 h-4" />
                )}
                {isFullscreen
                  ? t("settings.exitFullscreen", "Exit")
                  : t("settings.enterFullscreen", "Enter")}
              </GameButton>
            </GameRow>
          </>
        ),
      },
      {
        id: "gameplay",
        title: t("settings.gameplay"),
        icon: <Gamepad2 className="w-5 h-5" />,
        content: (
          <>
            <GameRow
              label={t("settings.defaultMatchMode")}
              description={t("settings.defaultMatchModeDesc")}
            >
              <Select
                value={settings.default_match_mode}
                variant="glass"
                onChange={(e) =>
                  handleUpdate({
                    default_match_mode: e.target
                      .value as AppSettings["default_match_mode"],
                  })
                }
                className="min-w-48"
              >
                {MATCH_MODE_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {t(`settings.matchModes.${k}`)}
                  </option>
                ))}
              </Select>
            </GameRow>

            <GameRow
              label={t("settings.matchSpeed")}
              description={t("settings.matchSpeedDesc")}
            >
              <GameSegmented
                options={MATCH_SPEED_KEYS.map((k) => ({
                  value: k,
                  label: t(`settings.speeds.${k}`),
                }))}
                value={settings.match_speed}
                onChange={(v) =>
                  handleUpdate({ match_speed: v as AppSettings["match_speed"] })
                }
              />
            </GameRow>

            <GameRow
              label={t("settings.matchCommentary")}
              description={t("settings.matchCommentaryDesc")}
            >
              <GameToggle
                checked={settings.show_match_commentary}
                onChange={(v) => handleUpdate({ show_match_commentary: v })}
              />
            </GameRow>

            <GameRow
              label={t("settings.confirmAdvance")}
              description={t("settings.confirmAdvanceDesc")}
            >
              <GameToggle
                checked={settings.confirm_advance}
                onChange={(v) => handleUpdate({ confirm_advance: v })}
              />
            </GameRow>

            <GameRow
              label={t("settings.debugTools", "Debug tools")}
              description={t(
                "settings.debugToolsDesc",
                "Enable internal tools like draft skip and World Editor",
              )}
            >
              <div className="flex items-center gap-2">
                <Bug className="w-4 h-4 text-muted-foreground/70" />
                <GameToggle
                  checked={settings.debug_tools_enabled}
                  onChange={(v) => handleUpdate({ debug_tools_enabled: v })}
                />
              </div>
            </GameRow>
          </>
        ),
      },
      {
        id: "saves",
        title: t("settings.savesData"),
        icon: <Save className="w-5 h-5" />,
        content: (
          <>
            <GameRow
              label={t("settings.autoSave")}
              description={t("settings.autoSaveDesc")}
            >
              <GameToggle
                checked={settings.auto_save}
                onChange={(v) => handleUpdate({ auto_save: v })}
              />
            </GameRow>

            <GameRow
              label={t("settings.exportWorld")}
              description={t("settings.exportWorldDesc")}
            >
              <GameButton tone="primary" onClick={handleExportWorld}>
                <Download className="w-4 h-4" />
                {t("settings.export")}
              </GameButton>
            </GameRow>
            {exportPath && (
              <p className="text-xs text-accent-400 py-2 ml-1">
                {t("settings.exportedTo", { path: exportPath })}
              </p>
            )}

            <div className="border-t border-border/40 pt-4 mt-2">
              <GameRow
                label={t("settings.clearSaves")}
                description={t("settings.clearSavesDesc")}
                danger
              >
                {confirmClear ? (
                  <div className="flex items-center gap-2">
                    <GameButton tone="danger" onClick={handleClearSaves}>
                      {t("common.confirm")}
                    </GameButton>
                    <GameButton onClick={() => setConfirmClear(false)}>
                      {t("common.cancel")}
                    </GameButton>
                  </div>
                ) : clearSuccess ? (
                  <span className="text-sm text-accent-400 font-heading font-bold uppercase tracking-wider">
                    {t("settings.savesCleared")}
                  </span>
                ) : (
                  <GameButton tone="danger" onClick={() => setConfirmClear(true)}>
                    <Trash2 className="w-4 h-4" />
                    {t("settings.clear")}
                  </GameButton>
                )}
              </GameRow>
            </div>
          </>
        ),
      },
      {
        id: "updates",
        title: t("settings.updates"),
        icon: <RefreshCw className="w-5 h-5" />,
        content: (
          <>
            <GameRow
              label={t("settings.currentVersion")}
              description={t("settings.currentVersionDesc")}
            >
              <span className="text-xs font-heading font-bold uppercase tracking-wider text-foreground/80">
                {updateInfo?.version ?? APP_VERSION}
              </span>
            </GameRow>

            <GameRow
              label={t("settings.checkForUpdates")}
              description={t("settings.checkForUpdatesDesc")}
            >
              <GameButton
                tone="primary"
                disabled={checkingUpdate}
                onClick={checkUpdate}
              >
                {checkingUpdate ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : updateAvailable ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                {checkingUpdate
                  ? t("settings.checking")
                  : updateAvailable
                    ? t("settings.updateAvailable")
                    : t("settings.checkNow")}
              </GameButton>
            </GameRow>

            {updateAvailable && updateInfo && (
              <div className="rounded-lg bg-accent-400/10 border border-accent-400/30 p-3">
                <p className="text-xs text-accent-400 font-medium">
                  {t("settings.updateAvailableDetail", {
                    version: updateInfo.version,
                  })}
                </p>
              </div>
            )}

            {noPlatformBuild && !checkingUpdate && (
              <div className="rounded-lg bg-accent-400/10 border border-accent-400/30 p-3">
                <p className="text-xs text-accent-400 font-medium">
                  {t("settings.noPlatformBuild")}
                </p>
              </div>
            )}

            {showUpToDate && (
              <div className="rounded-lg bg-green-500/10 border border-green-500/30 p-3">
                <p className="text-xs text-green-400 font-medium">
                  {t("settings.upToDate")}
                </p>
              </div>
            )}
          </>
        ),
      },
      {
        id: "data",
        title: t("settings.data", { defaultValue: "Datos" }),
        icon: <Database className="w-5 h-5" />,
        content: <ImportDataSection />,
      },
      {
        id: "about",
        title: t("settings.about"),
        icon: <Zap className="w-5 h-5" />,
        content: (
          <div className="py-4">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm font-medium text-foreground">{APP_NAME}</p>
                <p className="text-xs text-muted-foreground/70 mt-0.5">{APP_VERSION}</p>
              </div>
              <span className="text-2xs font-heading uppercase tracking-widest text-muted-foreground">
                Open League Manager Community
              </span>
            </div>
            <p className="text-xs text-muted-foreground/70 mt-4">{t("settings.statsCredit")}</p>
          </div>
        ),
      },
    ];

    const active =
      gameSections.find((s) => s.id === activeSettingsTab) ?? gameSections[0];

    return (
      <div className="dark h-full bg-background text-foreground">
        <div className="h-full flex flex-col px-6 sm:px-10 lg:px-16 py-8 overflow-y-auto scrollbar-v2">
          {/* Header */}
          <div className="flex items-center gap-3 mb-8">
            <button
              onClick={() => navigate(returnTo)}
              className="p-2 rounded-lg text-foreground/80 hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-2xl font-heading font-bold uppercase tracking-wider text-foreground drop-shadow">
              {t("settings.title")}
            </h1>
          </div>

          {/* Section tabs */}
          <nav className="flex flex-wrap gap-1 border-b border-border/40 mb-6"
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                e.preventDefault();
                const dir = e.key === "ArrowRight" ? 1 : -1;
                const idx = gameSections.findIndex((s) => s.id === active.id);
                const next = (idx + dir + gameSections.length) % gameSections.length;
                setActiveSettingsTab(gameSections[next].id);
              }
            }}
          >
            {gameSections.map((s) => (
              <GameTab
                key={s.id}
                icon={s.icon}
                label={s.title}
                active={s.id === active.id}
                onClick={() => setActiveSettingsTab(s.id)}
              />
            ))}
          </nav>

          {/* Active section — no container box; rows separated by hairlines */}
          <div className="flex-1 overflow-y-auto">
            <div
              key={active.id}
              className="animate-fade-in-up max-w-3xl border-t border-border/40"
            >
              {active.content}
            </div>
          </div>
        </div>
      </div>
    );
}

// ── Game-style components ──

function GameTab({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`group relative flex items-center gap-2 px-4 py-3 font-heading font-bold text-sm uppercase tracking-wider transition-colors ${
        active ? "text-foreground" : "text-muted-foreground/70 hover:text-foreground/90"
      }`}
    >
      <span
        className={
          active
            ? "text-accent-400"
            : "text-muted-foreground group-hover:text-foreground/80"
        }
      >
        {icon}
      </span>
      {label}
      <span
        className={`absolute left-0 -bottom-px h-0.5 w-full rounded-full bg-accent-400 transition-opacity ${
          active ? "opacity-100" : "opacity-0"
        }`}
      />
    </button>
  );
}

function GameRow({
  label,
  description,
  danger,
  children,
}: {
  label: string;
  description: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-4 border-b border-border/40 last:border-b-0">
      <div className="flex-1 min-w-0">
        <p
          className={`text-sm font-heading font-bold uppercase tracking-wider ${
            danger ? "text-red-400" : "text-foreground"
          }`}
        >
          {label}
        </p>
        <p className="text-xs text-muted-foreground/70 mt-1 normal-case">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function GameSegmented({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: string; label?: string; icon?: React.ReactNode }>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-1.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`flex min-h-[var(--target-min)] min-w-[var(--target-min)] items-center justify-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-heading font-bold uppercase tracking-wider transition-all ${
            value === opt.value
              ? "border-accent-400 text-accent-400 bg-accent-400/10"
              : "border-border text-foreground/80 hover:border-white/35 hover:text-foreground"
          }`}
        >
          {opt.icon}
          {opt.label || opt.value}
        </button>
      ))}
    </div>
  );
}

function GameToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full border transition-colors duration-200 ${
        checked
          ? "bg-accent-400/20 border-accent-400"
          : "bg-muted/30 border-border"
      }`}
    >
      <div
        className={`absolute top-0.5 w-5 h-5 rounded-full shadow-sm transition-transform duration-200 ${
          checked
            ? "translate-x-[22px] bg-accent-400"
            : "translate-x-0.5 bg-muted"
        }`}
      />
    </button>
  );
}

function GameButton({
  onClick,
  children,
  tone = "neutral",
  disabled,
}: {
  onClick: () => void;
  children: React.ReactNode;
  tone?: "neutral" | "primary" | "danger";
  disabled?: boolean;
}) {
  const tones = {
    neutral:
      "border-border text-foreground hover:border-white/40 hover:bg-muted/30",
    primary:
      "border-accent-400/50 text-accent-400 hover:border-accent-400 hover:bg-accent-400/10",
    danger:
      "border-red-500/50 text-red-400 hover:border-red-500 hover:bg-red-500/10",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg border bg-transparent text-sm font-heading font-bold uppercase tracking-wider transition-colors disabled:opacity-50 ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

// ── Datos: OLMDBManager auto-import (Tauri-native) ──

function ImportDataSection() {
  const { t } = useTranslation();
  const hasActiveGame = useGameStore((s) => s.hasActiveGame);
  const setGameState = useGameStore((s) => s.setGameState);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [cacheInfo, setCacheInfo] = useState<ImportCacheInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [zipPath, setZipPath] = useState("");
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [status, setStatus] = useState<"idle" | "running" | "success" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getCatalogSummary(), getImportCacheInfo()])
      .then(([s, cache]) => {
        if (!cancelled) {
          setSummary(s);
          setCacheInfo(cache);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSummary(null);
          setCacheInfo(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<ImportProgress>("olm-import-progress", (event) => {
      setProgress(event.payload);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {
        unlisten = undefined;
      });
    return () => {
      unlisten?.();
    };
  }, []);

  async function runImport(action: () => Promise<ImportSummary>) {
    setBusy(true);
    setError(null);
    setResult(null);
    setProgress(null);
    setStatus("running");
    try {
      const imported = await action();
      setResult(imported);
      setSummary(imported);
      getImportCacheInfo()
        .then(setCacheInfo)
        .catch(() => setCacheInfo(null));
      setStatus("success");
      // The backend rehydrates the active game's staff from the freshly
      // imported catalog, but the dashboard reads from the Zustand store, which
      // was populated once when the game loaded. Re-fetch so the new staff
      // (and players/teams) show up without restarting the app.
      if (hasActiveGame) {
        try {
          const refreshed = await invoke<GameStateData>("get_active_game");
          setGameState(refreshed);
        } catch (refreshErr) {
          console.error("[import] failed to refresh active game:", refreshErr);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    } finally {
      setBusy(false);
    }
  }

  async function handleAutoImport() {
    await runImport(autoImportDatabase);
  }

  async function handleZipImport() {
    const path = zipPath.trim();
    if (!path) {
      setError(t("settings.importZipPathRequired", { defaultValue: "Introduce la ruta del ZIP." }));
      setStatus("error");
      return;
    }
    await runImport(() => importExportZip(path));
  }

  async function handleCachedImport() {
    if (!cacheInfo?.exists) {
      setError(t("settings.importCacheMissing", { defaultValue: "Aún no hay un ZIP guardado." }));
      setStatus("error");
      return;
    }
    await runImport(importCachedExport);
  }

  const isError = status === "error";
  const isSuccess = status === "success";
  const progressTotal = progress?.total ?? null;
  const progressPercent =
    progressTotal && progressTotal > 0
      ? Math.max(0, Math.min(100, Math.round(((progress?.processed ?? 0) / progressTotal) * 100)))
      : null;
  const currentProgressText =
    progress?.message ??
    t("settings.importRunning", {
      defaultValue:
        "Descargando y descomprimiendo datos desde OLMDBManager...",
    });
  const cacheSizeText = cacheInfo?.exists
    ? `${(cacheInfo.size_bytes / 1_048_576).toFixed(1)} MB`
    : null;

  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            {t("settings.autoImport", { defaultValue: "Autoimportar BD" })}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("settings.autoImportDesc", {
              defaultValue:
                "Descarga la base de datos pública de OLMDBManager (equipos, jugadores, staff e imágenes) y actualiza los datos del juego.",
            })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={busy || !cacheInfo?.exists}
            onClick={handleCachedImport}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-foreground hover:bg-muted text-sm font-heading font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
            title={cacheInfo?.path}
          >
            <Save className="w-4 h-4" />
            {t("settings.importCached", { defaultValue: "Usar último ZIP" })}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleAutoImport}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/10 text-club-text hover:bg-primary/20 text-sm font-heading font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
          >
            {busy ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Database className="w-4 h-4" />
            )}
            {busy
              ? t("settings.importing", { defaultValue: "Importando..." })
              : t("settings.importOnline", { defaultValue: "Importar online" })}
          </button>
        </div>
      </div>

      {status !== "idle" && (
        <div
          className={`rounded-lg border p-3 text-xs ${
            isError
              ? "border-red-500/30 bg-red-500/10 text-red-500"
              : isSuccess
                ? "border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400"
                : "border-primary/20 bg-primary/5 text-club-text"
          }`}
        >
          {busy && (
            <div className="space-y-2">
              <p className="flex items-center gap-2">
                <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
                {currentProgressText}
              </p>
              {progressPercent !== null && (
                <div className="h-2 overflow-hidden rounded-full bg-background/70">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              )}
            </div>
          )}
          {error && <p>{error}</p>}
          {result && isSuccess && (
            <p>
              {t("settings.importDone", {
                defaultValue:
                  "{{players}} jugadores, {{teams}} equipos y {{staff}} staff importados. Imágenes: {{photos}}.",
                players: result.player_count,
                teams: result.team_count,
                staff: result.staff_count,
                photos: result.photo_files,
              })}
            </p>
          )}
        </div>
      )}

      <div className="grid gap-2 rounded-lg border border-border bg-muted/20 p-3 md:grid-cols-[1fr_auto]">
        <input
          value={zipPath}
          disabled={busy}
          onChange={(e) => setZipPath(e.target.value)}
          placeholder={t("settings.importZipPath", {
            defaultValue: "/ruta/a/olmanager_export.zip",
          })}
          className="min-w-0 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary disabled:opacity-50"
        />
        <button
          type="button"
          disabled={busy || !zipPath.trim()}
          onClick={handleZipImport}
          className="flex items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-heading font-bold uppercase tracking-wider text-foreground transition-colors hover:bg-muted disabled:opacity-50"
        >
          <Download className="w-4 h-4" />
          {t("settings.importZip", { defaultValue: "Importar ZIP" })}
        </button>
      </div>

      <p className="text-2xs uppercase tracking-wider text-muted-foreground">
        {cacheInfo?.exists
          ? t("settings.importCacheReady", {
              defaultValue: "ZIP guardado: {{size}}",
              size: cacheSizeText,
            })
          : t("settings.importCacheEmpty", {
              defaultValue: "Sin ZIP guardado todavía. El primer import online lo creará.",
            })}
      </p>

      {summary && (summary.player_count > 0 || summary.team_count > 0) && (
        <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-muted/30 p-3">
          <ImportStat label={t("settings.players", { defaultValue: "Jugadores" })} value={summary.player_count} />
          <ImportStat label={t("settings.teams", { defaultValue: "Equipos" })} value={summary.team_count} />
          <ImportStat label={t("settings.staff", { defaultValue: "Staff" })} value={summary.staff_count} />
        </div>
      )}
    </div>
  );
}

function ImportStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <p className="text-lg font-heading font-bold text-foreground">{value}</p>
      <p className="text-2xs uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  );
}
