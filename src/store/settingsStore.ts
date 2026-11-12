import { create } from "zustand";
import { getApiClientSync } from "../api/client";
import { setActiveCurrency } from "../lib/formatting/valueFormatting";

export interface AppSettings {
  theme: "dark" | "light" | "system";
  language: string;
  currency: "EUR" | "GBP" | "USD";
  default_match_mode: "live" | "spectator" | "delegate";
  scrim_review_mode: "manual" | "assistant";
  auto_save: boolean;
  match_speed: "slow" | "normal" | "fast";
  show_match_commentary: boolean;
  confirm_advance: boolean;
  ui_scale: "xsmall" | "small" | "normal" | "large" | "xlarge";
  high_contrast: boolean;
  debug_tools_enabled: boolean;
  lol_hybrid_open_trade_confidence_high: number;
  lol_hybrid_disengage_confidence_low: number;
  /** Linux only: how the webview renders, decided at the next start. */
  linux_render_mode: "ask" | "accelerated" | "compatibility";
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: "dark",
  language: "en",
  currency: "EUR",
  default_match_mode: "live",
  scrim_review_mode: "manual",
  auto_save: true,
  match_speed: "normal",
  show_match_commentary: true,
  confirm_advance: false,
  ui_scale: "normal",
  high_contrast: false,
  debug_tools_enabled: false,
  lol_hybrid_open_trade_confidence_high: 0.6,
  lol_hybrid_disengage_confidence_low: 0.32,
  linux_render_mode: "ask",
};

function isAndroidDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent);
}

function mergeWithDefaultSettings(settings: Partial<AppSettings> = {}): AppSettings {
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  if (isAndroidDevice()) {
    merged.ui_scale = "xsmall";
  }
  return merged;
}

async function persistSettings(settings: AppSettings) {
  await getApiClientSync().settings.save(settings as unknown as Partial<import("../api/types").AppSettings>);
}

interface SettingsStore {
  settings: AppSettings;
  loaded: boolean;
  loadSettings: () => Promise<void>;
  updateSettings: (partial: Partial<AppSettings>) => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: mergeWithDefaultSettings(),
  loaded: false,

  loadSettings: async () => {
    try {
      const s = await getApiClientSync().settings.load();
      set({ settings: mergeWithDefaultSettings(s), loaded: true });
    } catch {
      set({ settings: mergeWithDefaultSettings(), loaded: true });
    }
  },

  updateSettings: async (partial) => {
    const previousSettings = get().settings;
    const merged = mergeWithDefaultSettings({ ...previousSettings, ...partial });
    set({ settings: merged });
    try {
      await persistSettings(merged);
    } catch (err) {
      set({ settings: previousSettings });
      console.error("Failed to save settings:", err);
    }
  },
}));

setActiveCurrency(useSettingsStore.getState().settings.currency);
useSettingsStore.subscribe((state) => {
  setActiveCurrency(state.settings.currency);
});
