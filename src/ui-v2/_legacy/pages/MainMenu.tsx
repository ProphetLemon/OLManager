import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getApiClientSync } from "@/api/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useGameStore } from "@/store/gameStore";

import { Button, DatePicker, CountryFlag } from "@/ui-v2/_legacy/components/ui";
import SavesList from "@/ui-v2/_legacy/components/menu/SavesList";
import { useSaveTransfer } from "@/ui-v2/_legacy/components/menu/useSaveTransfer";
import MenuBackground from "@/ui-v2/_legacy/components/menu/MenuBackground";
import CommunityPanel from "@/ui-v2/_legacy/components/menu/CommunityPanel";
import PatchNotesPanel from "@/ui-v2/_legacy/components/menu/PatchNotesPanel";
import { useRovingFocus } from "@/hooks/useRovingFocus";
import {
  FolderOpen,
  Settings,
  X,
  PlusCircle,
  ChevronRight,
  AlertCircle,
  ChevronDown,
  Check,
  Power,
  Users,
  Newspaper,
} from "lucide-react";
import { countryName, allNationalities } from "@/lib/common/countries";

interface SaveEntry {
  id: string;
  name: string;
  manager_name: string;
  db_filename: string;
  checksum: string;
  created_at: string;
  last_played_at: string;
}

function normaliseSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function flooredAgeFromIsoDate(isoDob: string): number | null {
  if (!isoDob) return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDob);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const birthDate = new Date(year, month - 1, day);

  if (
    Number.isNaN(birthDate.getTime()) ||
    birthDate.getFullYear() !== year ||
    birthDate.getMonth() !== month - 1 ||
    birthDate.getDate() !== day
  ) {
    return null;
  }

  const today = new Date();
  let age = today.getFullYear() - year;
  const hasHadBirthdayThisYear =
    today.getMonth() > month - 1 ||
    (today.getMonth() === month - 1 && today.getDate() >= day);

  if (!hasHadBirthdayThisYear) {
    age -= 1;
  }
  return Number.isNaN(age) ? null : age;
}

const CREATE_MANAGER_FIELD_ORDER = [
  "nickname",
  "firstName",
  "lastName",
  "dob",
  "nationality",
] as const;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function focusFirstCreateManagerError(errors: Record<string, string>): void {
  const first = CREATE_MANAGER_FIELD_ORDER.find((k) => errors[k]);
  if (!first) return;
  const root = document.getElementById(`create-manager-field-${first}`);
  root?.scrollIntoView?.({
    behavior: prefersReducedMotion() ? "auto" : "smooth",
    block: "center",
  });
  const focusable = root?.querySelector<HTMLElement>(
    "input:not([type=hidden]), button:not([disabled]), select, textarea",
  );
  focusable?.focus({ preventScroll: true });
}

function logNationalityDebug(
  message: string,
  details?: Record<string, unknown>,
): void {
  console.debug("[MainMenu nationality]", {
    message,
    ...(details ?? {}),
  });
}

export default function MainMenu() {
  const navigate = useNavigate();
  const setGameActive = useGameStore((state) => state.setGameActive);
  const { t, i18n } = useTranslation();
  const [menuState, setMenuState] = useState<
    "main" | "create" | "load" | "community" | "patchnotes"
  >("main");
  const [saves, setSaves] = useState<SaveEntry[]>([]);
  const [isLoadingSaves, setIsLoadingSaves] = useState(false);
  const [loadingSaveId, setLoadingSaveId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const [formData, setFormData] = useState({
    nickname: "",
    firstName: "",
    lastName: "",
    dob: "",
    nationality: "",
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [nationalityOpen, setNationalityOpen] = useState(false);
  const [nationalitySearch, setNationalitySearch] = useState("");
  const nationalityRef = useRef<HTMLDivElement>(null);

  const countriesList = allNationalities(i18n.language);
  const normalisedNationalitySearch = normaliseSearchText(nationalitySearch);

  /** Same messages as `validateForm` for DOB so feedback surfaces while typing. */
  const dobLiveRuleMessage = (() => {
    if (!formData.dob) return null;
    const age = flooredAgeFromIsoDate(formData.dob);
    if (age === null) return t("validation.invalidDate");
    if (age > 99) return t("validation.invalidDob");
    return null;
  })();
  const dobDisplayedError = formErrors.dob || dobLiveRuleMessage;

  const filteredNationalities = countriesList.filter((nationality) => {
    const normalisedName = normaliseSearchText(nationality.name);
    const normalisedCode = normaliseSearchText(nationality.code);

    return (
      normalisedName.includes(normalisedNationalitySearch) ||
      normalisedCode.includes(normalisedNationalitySearch)
    );
  });

  const toggleNationalityDropdown = () => {
    setNationalityOpen((open) => {
      const nextOpen = !open;
      logNationalityDebug("toggle button", { nextOpen });
      return nextOpen;
    });
    setNationalitySearch("");
  };

  const validateForm = (): {
    ok: boolean;
    errors: Record<string, string>;
  } => {
    const errors: Record<string, string> = {};
    if (formData.nickname.trim().length > 20) {
      errors.nickname = t("validation.maxLength", {
        field: t("createManager.nickname", "Nick"),
        max: 20,
      });
    }

    if (!formData.firstName.trim()) {
      errors.firstName = t("validation.required", {
        field: t("createManager.firstName"),
      });
    } else if (formData.firstName.length > 30) {
      errors.firstName = t("validation.maxLength", {
        field: t("createManager.firstName"),
        max: 30,
      });
    }

    if (!formData.lastName.trim()) {
      errors.lastName = t("validation.required", {
        field: t("createManager.lastName"),
      });
    } else if (formData.lastName.length > 30) {
      errors.lastName = t("validation.maxLength", {
        field: t("createManager.lastName"),
        max: 30,
      });
    }

    if (!formData.dob) {
      errors.dob = t("validation.required", { field: t("createManager.dob") });
    } else {
      const age = flooredAgeFromIsoDate(formData.dob);
      if (age === null) {
        errors.dob = t("validation.invalidDate");
      } else if (age > 99) {
        errors.dob = t("validation.invalidDob");
      }
    }
    if (!formData.nationality)
      errors.nationality = t("validation.required", {
        field: t("createManager.countryOfOrigin", "Country/Region of Origin"),
      });
    setFormErrors(errors);
    return {
      ok: Object.keys(errors).length === 0,
      errors,
    };
  };

  const handleStartCareer = (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validateForm();
    if (!validation.ok) {
      requestAnimationFrame(() =>
        focusFirstCreateManagerError(validation.errors),
      );
      return;
    }
    void handleStartGame();
  };

  // Close nationality dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!nationalityOpen || !nationalityRef.current) {
        return;
      }

      const targetNode = e.target instanceof Node ? e.target : null;
      const eventPath =
        typeof e.composedPath === "function" ? e.composedPath() : [];
      const clickedInside =
        eventPath.includes(nationalityRef.current) ||
        (targetNode ? nationalityRef.current.contains(targetNode) : false);
      const targetElement = e.target instanceof HTMLElement ? e.target : null;

      logNationalityDebug("document mousedown", {
        clickedInside,
        targetTag: targetElement?.tagName.toLowerCase(),
        targetClass: targetElement?.className ?? "",
        targetText: targetElement?.textContent?.trim().slice(0, 60) ?? "",
      });

      if (!clickedInside) {
        logNationalityDebug("closing from outside click");
        setNationalityOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [nationalityOpen]);

  const handleStartGame = async () => {
    setIsStarting(true);
    try {
      const client = getApiClientSync();

      await client.serverCommands.debugLog("start_new_game_lightweight");

      // Save creation uses the HTTP endpoint in web mode, invoke in desktop
      await client.saves.create(
        formData.nickname?.trim() || `${formData.firstName} ${formData.lastName}`.trim() || "Career",
        "",
        {
          nickname: formData.nickname || null,
          firstName: formData.firstName,
          lastName: formData.lastName,
          dob: formData.dob,
          nationality: formData.nationality,
        },
      );

      const displayName =
        formData.nickname?.trim() ||
        `${formData.firstName} ${formData.lastName}`;
      setGameActive(true, displayName.trim());
      console.debug(
        "[MainMenu] start_new_game_lightweight completed, navigating to /select-team",
      );
      navigate("/select-team");
    } catch (error) {
      console.error("Failed to start game:", error);
      alert(t("menu.failedStartGame", { error: String(error) }));
    } finally {
      setIsStarting(false);
    }
  };

  const handleOpenLoadMenu = async () => {
    setMenuState("load");
    setIsLoadingSaves(true);
    try {
      const client = getApiClientSync();
      const dbSaves = (await client.saves.list()) as unknown as SaveEntry[];
        console.debug("[DEBUG] saves loaded:", dbSaves.length, "entries", dbSaves.map((s: SaveEntry) => ({ id: s.id, name: s.name })));
        // Run serde diagnostic
        try {
          const serdeResult = await invoke("debug_serde_test");
          console.debug("[DEBUG] serde roundtrip test:", serdeResult);
        } catch (serdeErr) {
          console.error("[DEBUG] serde roundtrip FAILED:", serdeErr);
        }
        setSaves(dbSaves);
      } catch (error) {
        console.error("Failed to load saves:", error);
      } finally {
      setIsLoadingSaves(false);
    }
  };

  const transfer = useSaveTransfer(() => getApiClientSync().saves, async () => {
    const refreshed = (await getApiClientSync().saves.list()) as unknown as SaveEntry[];
    setSaves(refreshed);
  });

  const handleLoadGame = async (saveId: string) => {
    console.log("[MainMenu] handleLoadGame start, saveId:", saveId);
    setLoadingSaveId(saveId);
    try {
      const client = getApiClientSync();
      const result = await client.saves.load(saveId);
      setGameActive(true, (result as any)?.manager?.display_name
        || (result as any)?.manager?.nickname
        || `${(result as any)?.manager?.first_name ?? ""} ${(result as any)?.manager?.last_name ?? ""}`.trim()
        || "Manager");
        navigate("/dashboard");
      } catch (error) {
        console.error("Failed to load game:", error);
        console.error("[DEBUG] saveId:", saveId);
        console.error("[DEBUG] error string:", String(error));
        if (typeof error === "object" && error !== null) {
          console.error("[DEBUG] error keys:", Object.keys(error as object));
          try { console.error("[DEBUG] error JSON:", JSON.stringify(error)); } catch {}
        }
        setLoadingSaveId(null);
      }
  };

  const handleDeleteSave = async (saveId: string) => {
    try {
      const client = getApiClientSync();
      await client.saves.delete(saveId);
      setSaves((prev) => prev.filter((s) => s.id !== saveId));
      setConfirmDeleteId(null);
    } catch (error) {
      console.error("Failed to delete save:", error);
    }
  };

  const handleExitApp = async (): Promise<void> => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
      await getCurrentWindow().destroy();
    } catch (error) {
      console.error("Failed to exit app:", error);
    }
  };

  const mainMenuItems = useMemo(() => {
    const items: Array<{ label: string; onClick: () => void; icon: React.ReactNode; tone?: MenuItemTone; active?: boolean; title?: string }> = [
      { icon: <PlusCircle />, label: t("menu.newGame"), active: menuState === "create", onClick: () => setMenuState("create") },
      { icon: <FolderOpen />, label: t("menu.loadGame"), active: menuState === "load", onClick: handleOpenLoadMenu },
      { icon: <Settings />, tone: "muted" as const, label: t("menu.settings"), onClick: () => navigate("/settings", { state: { from: "/", menuStyle: true } }) },
      { icon: <Users />, label: t("menu.community", "Comunidad"), active: menuState === "community", onClick: () => setMenuState("community") },
      { icon: <Newspaper />, tone: "muted" as const, label: t("menu.patchNotes", "Novedades"), active: menuState === "patchnotes", onClick: () => setMenuState("patchnotes") },
    ];
    items.push({ icon: <Power />, tone: "danger" as const, label: t("menu.exitGame"), onClick: () => { void handleExitApp(); } });
    return items;
  }, [t, menuState, navigate, handleOpenLoadMenu, handleExitApp]);

  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const { activeIndex, handleKeyDown, getTabIndex } = useRovingFocus({
    itemCount: mainMenuItems.length,
    columns: 1,
    onSelect: (i) => mainMenuItems[i]?.onClick(),
    getItemLabel: (i) => mainMenuItems[i]?.label ?? "",
  });

  useEffect(() => {
    if (menuState === "main") {
      containerRef.current?.focus();
      itemRefs.current[activeIndex]?.focus();
    }
  }, [activeIndex, menuState]);

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  const isPanelOpen = menuState !== "main";

  const focusFirstPanelElement = useCallback(() => {
    requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const all = panel.querySelectorAll<HTMLElement>(
        "input:not([type=hidden]):not([disabled]), button:not([disabled]), select, textarea, [tabindex]:not([tabindex='-1'])",
      );
      for (const el of all) {
        const isCloseBtn = el.tagName === "BUTTON" && el.querySelector("svg.lucide-x");
        if (!isCloseBtn) {
          el.focus();
          return;
        }
      }
    });
  }, []);

  useEffect(() => {
    if (isPanelOpen) {
      focusFirstPanelElement();
    } else {
      itemRefs.current[activeIndex]?.focus();
    }
  }, [menuState]);

  const handleMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && isPanelOpen) {
      e.preventDefault();
      setMenuState("main");
      return;
    }
    if (e.key === "ArrowLeft" && isPanelOpen) {
      e.preventDefault();
      setMenuState("main");
      return;
    }
    if (isPanelOpen) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < mainMenuItems.length) {
        mainMenuItems[activeIndex]?.onClick();
      }
      return;
    }
    handleKeyDown(e);
  };

  return (
    <div
      ref={containerRef}
      className="h-full relative overflow-hidden font-sans text-white"
      onKeyDown={handleMenuKeyDown}
      tabIndex={-1}
    >
      <MenuBackground />

      {/* Theme Toggle */}


      {/* Two-column layout: persistent nav on the left, active panel on the right */}
      <div className="relative z-10 h-full flex">
        {/* Left column — logo + nav (always visible) */}
        <div className="flex flex-col justify-start pt-[15vh] pb-8 px-8 sm:px-14 lg:px-20 w-full max-w-md shrink-0">
          <div className="w-full animate-fade-in-up">
            <img
              src="/olmanager-logo.webp"
              alt="Open League Manager"
              className="h-24 mb-10 drop-shadow-[0_4px_24px_rgba(0,0,0,0.65)]"
            />

            <nav className="flex flex-col gap-1">
              {mainMenuItems.map((item, i) => (
                <MenuItem
                  key={item.label}
                  icon={item.icon}
                  label={item.label}
                  tone={item.tone}
                  active={item.active}
                  title={item.title}
                  tabIndex={getTabIndex(i)}
                  ref={(el) => { itemRefs.current[i] = el; }}
                  onClick={item.onClick}
                />
              ))}
            </nav>
          </div>
        </div>

        {/* Right column — active panel opens beside the nav */}
        {menuState !== "main" && (
          <div ref={panelRef} className="dark flex-1 min-w-0 flex flex-col justify-center overflow-y-auto p-6 lg:p-10">
            <div
              key={menuState}
              className="w-full max-w-2xl mx-auto animate-fade-in-up border-t border-white/10"
            >
              <div className="pt-6">
                {/* Step 1: Create Manager Form */}
                {menuState === "create" && (
                  <form onSubmit={handleStartCareer} className="flex flex-col"
                    onKeyDown={(e) => {
                      const nav: Record<string, Record<string, string | null>> = {
                        nickname: { right: null, left: null, down: "firstName", up: null },
                        firstName: { right: "lastName", left: null, down: "day", up: "nickname" },
                        lastName: { right: null, left: "firstName", down: "day", up: "nickname" },
                        day: { right: "month", left: null, down: "nationality", up: "firstName" },
                        month: { right: "year", left: "day", down: "nationality", up: "firstName" },
                        year: { right: null, left: "month", down: "nationality", up: "firstName" },
                        nationality: { right: null, left: null, down: "submit", up: "day" },
                        submit: { right: null, left: null, down: null, up: "nationality" },
                      };
                      const selectors: Record<string, string> = {
                        nickname: "#create-manager-field-nickname input",
                        firstName: "#create-manager-field-firstName input",
                        lastName: "#create-manager-field-lastName input",
                        day: "#dp-day-input",
                        month: "#dp-month-btn",
                        year: "#dp-year-input",
                        nationality: "#create-manager-field-nationality-btn",
                        submit: "#create-manager-submit",
                      };
                      if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key)) {
                        const current = document.activeElement;
                        const fieldId = Object.entries(selectors).find(
                          ([, sel]) => current === document.querySelector(sel)
                        )?.[0];
                        if (!fieldId) return;
                        const dir = e.key === "ArrowDown" ? "down" : e.key === "ArrowUp" ? "up" : e.key === "ArrowRight" ? "right" : "left";
                        const target = nav[fieldId]?.[dir];
                        if (!target) return;
                        e.preventDefault();
                        e.stopPropagation();
                        const el = document.querySelector<HTMLElement>(selectors[target]);
                        el?.focus();
                      }
                    }}
                  >
                    <div className="flex justify-between items-center pb-5">
                      <h2 className="text-2xl font-heading font-bold uppercase tracking-wider text-white drop-shadow">
                        {t("createManager.title")}
                      </h2>
                      <button
                        type="button"
                        onClick={() => {
                          setMenuState("main");
                          setFormErrors({});
                        }}
                        className="text-gray-400 hover:text-white transition-colors p-2 rounded-lg hover:bg-white/10"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    {/* Step indicator */}
                    <div className="flex items-center gap-3 py-4 border-y border-white/10">
                      <div className="flex items-center justify-center w-7 h-7 rounded-full bg-accent-400 text-navy-950 text-xs font-bold">
                        1
                      </div>
                      <span className="text-sm text-gray-300 font-heading font-bold uppercase tracking-wider">
                        {t("worldSelect.startCareer")}
                      </span>
                    </div>

                    {/* Nickname */}
                    <div
                      id="create-manager-field-nickname"
                      className="py-4 border-b border-white/10"
                    >
                      <label className="block text-sm font-heading font-bold uppercase tracking-wider text-white mb-1.5">
                        {t("createManager.nickname", "Nick")}
                      </label>
                      <input
                        maxLength={20}
                        className={`w-full bg-white/5 border text-white rounded-lg p-3 outline-none focus:ring-2 transition-all placeholder:text-gray-500 ${
                          formErrors.nickname
                            ? "border-red-400 dark:border-red-500 focus:border-red-500 focus:ring-red-500/20"
                            : "border-white/15 focus:border-accent-400 focus:ring-accent-400/20"
                        }`}
                        placeholder={t(
                          "createManager.placeholderNickname",
                          "ej. Faker",
                        )}
                        value={formData.nickname}
                        onChange={(e) => {
                          setFormData((prev) => ({
                            ...prev,
                            nickname: e.target.value,
                          }));
                          setFormErrors((prev) => ({ ...prev, nickname: "" }));
                        }}
                      />
                      {formErrors.nickname && (
                        <p className="flex items-center gap-1 text-xs text-red-500 mt-1">
                          <AlertCircle className="w-3 h-3" />
                          {formErrors.nickname}
                        </p>
                      )}
                    </div>

                    {/* Name fields with labels */}
                    <div className="flex flex-col sm:flex-row gap-3 py-4 border-b border-white/10">
                      <div
                        className="flex-1"
                        id="create-manager-field-firstName"
                      >
                        <label className="block text-sm font-heading font-bold uppercase tracking-wider text-white mb-1.5">
                          {t("createManager.firstName")}
                        </label>
                        <input
                          maxLength={30}
                          className={`w-full bg-white/5 border text-white rounded-lg p-3 outline-none focus:ring-2 transition-all placeholder:text-gray-500 ${
                            formErrors.firstName
                              ? "border-red-400 dark:border-red-500 focus:border-red-500 focus:ring-red-500/20"
                              : "border-white/15 focus:border-accent-400 focus:ring-accent-400/20"
                          }`}
                          placeholder={t("createManager.placeholderFirst")}
                          value={formData.firstName}
                          onChange={(e) => {
                            setFormData((prev) => ({
                              ...prev,
                              firstName: e.target.value,
                            }));
                            setFormErrors((prev) => ({
                              ...prev,
                              firstName: "",
                            }));
                          }}
                        />
                        {formErrors.firstName && (
                          <p className="flex items-center gap-1 text-xs text-red-500 mt-1">
                            <AlertCircle className="w-3 h-3" />
                            {formErrors.firstName}
                          </p>
                        )}
                      </div>
                      <div
                        className="flex-1"
                        id="create-manager-field-lastName"
                      >
                        <label className="block text-sm font-heading font-bold uppercase tracking-wider text-white mb-1.5">
                          {t("createManager.lastName")}
                        </label>
                        <input
                          maxLength={30}
                          className={`w-full bg-white/5 border text-white rounded-lg p-3 outline-none focus:ring-2 transition-all placeholder:text-gray-500 ${
                            formErrors.lastName
                              ? "border-red-400 dark:border-red-500 focus:border-red-500 focus:ring-red-500/20"
                              : "border-white/15 focus:border-accent-400 focus:ring-accent-400/20"
                          }`}
                          placeholder={t("createManager.placeholderLast")}
                          value={formData.lastName}
                          onChange={(e) => {
                            setFormData((prev) => ({
                              ...prev,
                              lastName: e.target.value,
                            }));
                            setFormErrors((prev) => ({
                              ...prev,
                              lastName: "",
                            }));
                          }}
                        />
                        {formErrors.lastName && (
                          <p className="flex items-center gap-1 text-xs text-red-500 mt-1">
                            <AlertCircle className="w-3 h-3" />
                            {formErrors.lastName}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Date of Birth with label */}
                    <div
                      id="create-manager-field-dob"
                      className="py-4 border-b border-white/10"
                    >
                      <label className="block text-sm font-heading font-bold uppercase tracking-wider text-white mb-1.5">
                        {t("createManager.dob")}
                      </label>
                      <DatePicker
                        value={formData.dob}
                        onChange={(date) => {
                          setFormData((prev) => ({
                            ...prev,
                            dob: date,
                          }));
                          setFormErrors((prev) => ({ ...prev, dob: "" }));
                        }}
                        error={!!dobDisplayedError}
                        nextFieldId="create-manager-field-nationality-btn"
                      />
                      {dobDisplayedError && (
                        <p className="flex items-center gap-1 text-xs text-red-500 mt-1">
                          <AlertCircle className="w-3 h-3 shrink-0" />
                          {dobDisplayedError}
                        </p>
                      )}
                    </div>

                    {/* Country/Region combobox — elevate stacking when open so the menu paints above the submit button */}
                    <div
                      id="create-manager-field-nationality"
                      ref={nationalityRef}
                      className={`py-4 border-b border-white/10 ${nationalityOpen ? "relative z-50" : ""}`}
                    >
                      <label className="block text-sm font-heading font-bold uppercase tracking-wider text-white mb-1.5">
                        {t(
                          "createManager.countryOfOrigin",
                          "Country/Region of Origin",
                        )}
                      </label>
                      <div className="relative">
                        <button
                          id="create-manager-field-nationality-btn"
                          type="button"
                          tabIndex={0}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            toggleNationalityDropdown();
                          }}
                          onClick={(event) => {
                            if (event.detail === 0) {
                              toggleNationalityDropdown();
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Tab" && !e.shiftKey) {
                              e.preventDefault();
                              if (nationalityOpen) setNationalityOpen(false);
                              document
                                .getElementById("create-manager-submit")
                                ?.focus();
                              return
                            }
                            if (e.key === "Tab" && e.shiftKey) {
                              e.preventDefault();
                              if (nationalityOpen) setNationalityOpen(false);
                              document
                                .getElementById("dp-year-input")
                                ?.focus();
                              return
                            }
                            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                              if (!nationalityOpen) return;
                              e.preventDefault();
                              const dir = e.key === "ArrowDown" ? 1 : -1;
                              const currentIdx = countriesList.findIndex(
                                c => c.code === formData.nationality
                              );
                              let nextIdx = currentIdx < 0 ? (dir > 0 ? -1 : countriesList.length) : currentIdx + dir;
                              if (nextIdx < 0) nextIdx = countriesList.length - 1;
                              if (nextIdx >= countriesList.length) nextIdx = 0;
                              const code = countriesList[nextIdx].code;
                              setFormData(prev => ({ ...prev, nationality: code }));
                              setFormErrors(prev => ({ ...prev, nationality: "" }));
                            }
                          }}
                          className={`w-full flex items-center justify-between bg-white/5 border text-left rounded-lg p-3 outline-none transition-all focus:border-accent-400 focus:ring-2 focus:ring-accent-400/20 ${
                            formErrors.nationality
                              ? "border-red-400 dark:border-red-500"
                              : nationalityOpen
                                ? "border-accent-400 ring-2 ring-accent-400/20"
                                : "border-white/15"
                          }`}
                        >
                          <span
                            className={
                              formData.nationality
                                ? "text-white"
                                : "text-gray-400"
                            }
                          >
                            {formData.nationality ? (
                              <span className="flex items-center gap-2">
                                <CountryFlag
                                  code={formData.nationality}
                                  locale={i18n.language}
                                  className="text-lg leading-none"
                                />
                                <span>
                                  {countryName(
                                    formData.nationality,
                                    i18n.language,
                                  ) || formData.nationality}
                                </span>
                              </span>
                            ) : (
                              t(
                                "createManager.selectCountry",
                                "Select Country/Region",
                              )
                            )}
                          </span>
                          <ChevronDown
                            className={`w-4 h-4 text-gray-400 transition-transform ${nationalityOpen ? "rotate-180" : ""}`}
                          />
                        </button>

                        {nationalityOpen && (
                          <div
                            className="absolute z-50 bottom-full mb-1 left-0 right-0 bg-navy-900/95 backdrop-blur-xl rounded-lg shadow-xl border border-white/10 overflow-hidden"
                            onMouseDown={(event) => {
                              event.stopPropagation();
                              logNationalityDebug("dropdown panel mousedown");
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Tab") {
                                e.preventDefault();
                                setNationalityOpen(false);
                                setNationalitySearch("");
                                document
                                  .getElementById("create-manager-submit")
                                  ?.focus();
                              }
                            }}
                          >
                            <div className="p-2 border-b border-white/10">
                              <input
                                type="text"
                                autoFocus
                                placeholder={t(
                                  "createManager.searchNationalities",
                                )}
                                value={nationalitySearch}
                                onChange={(e) =>
                                  setNationalitySearch(e.target.value)
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "ArrowDown") {
                                    e.preventDefault();
                                    const first = document.querySelector<HTMLButtonElement>("#nationality-dropdown-list button");
                                    first?.focus();
                                  }
                                  if (e.key === "Escape") {
                                    e.preventDefault();
                                    setNationalityOpen(false);
                                    setNationalitySearch("");
                                    document.getElementById("create-manager-field-nationality-btn")?.focus();
                                  }
                                }}
                                className="w-full bg-white/5 border border-white/10 text-white rounded-md px-3 py-2 text-sm outline-none focus:border-accent-400 transition-colors placeholder:text-gray-500"
                              />
                            </div>
                            <div id="nationality-dropdown-list" className="max-h-[min(20rem,calc(100vh-9rem))] overflow-y-auto overscroll-contain scrollbar-v2">
                              {filteredNationalities.length === 0 ? (
                                <p className="px-3 py-2 text-xs text-gray-400">
                                  {t("menu.noResults")}
                                </p>
                              ) : (
                                  <DropdownList
                                  items={filteredNationalities}
                                  selectedCode={formData.nationality}
                                  locale={i18n.language}
                                  onSelect={(code) => {
                                    setFormData((prev) => ({ ...prev, nationality: code }));
                                    setNationalityOpen(false);
                                    setNationalitySearch("");
                                    setFormErrors((prev) => ({ ...prev, nationality: "" }));
                                  }}
                                  onClose={() => {
                                    setNationalityOpen(false);
                                    setNationalitySearch("");
                                  }}
                                />
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                      {formErrors.nationality && (
                        <p className="flex items-center gap-1 text-xs text-red-500 mt-1">
                          <AlertCircle className="w-3 h-3" />
                          {formErrors.nationality}
                        </p>
                      )}
                    </div>

                    <Button
                      id="create-manager-submit"
                      type="submit"
                      variant="accent"
                      size="lg"
                      className="mt-6 w-full"
                      iconRight={<ChevronRight />}
                      disabled={isStarting}
                    >
                      {isStarting
                        ? t("worldSelect.creatingWorld")
                        : t("worldSelect.startCareer")}
                    </Button>
                  </form>
                )}

                {/* Load Game List */}
                {menuState === "load" && (
                  <SavesList
                    loadingSaveId={loadingSaveId}
                    saves={saves}
                    isLoading={isLoadingSaves}
                    confirmDeleteId={confirmDeleteId}
                    onLoad={handleLoadGame}
                    onDelete={handleDeleteSave}
                    onConfirmDelete={setConfirmDeleteId}
                    onClose={() => setMenuState("main")}
                    onExport={transfer.exportSave}
                    onImport={transfer.startImport}
                    onConfirmReplace={transfer.confirmReplace}
                    onCancelReplace={transfer.cancelReplace}
                    transferBusy={transfer.busy}
                    transferNotice={transfer.notice}
                    pendingReplace={transfer.pendingReplace}
                  />
                )}

                {/* Community */}
                {menuState === "community" && (
                  <CommunityPanel onClose={() => setMenuState("main")} />
                )}

                {/* Patch notes */}
                {menuState === "patchnotes" && (
                  <PatchNotesPanel onClose={() => setMenuState("main")} />
                )}

                {/* User profile — removed: no auth */}
              </div>
            </div>
          </div>
        )}

      </div>

      {/* Version */}
      <div className="absolute bottom-4 right-4 text-gray-300/70 text-xs font-heading uppercase tracking-widest drop-shadow z-20">
        {t("app.version")} {__APP_VERSION__}
      </div>
    </div>
  );
}

type MenuItemTone = "accent" | "muted" | "primary" | "danger";

const MenuItem = React.forwardRef<HTMLButtonElement, {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  tone?: MenuItemTone;
  title?: string;
  tabIndex?: 0 | -1;
}>(function MenuItem({
  icon,
  label,
  onClick,
  active = false,
  tone = "accent",
  title,
  tabIndex,
}, ref) {
  const bar =
    tone === "danger"
      ? "bg-red-500"
      : tone === "primary"
        ? "bg-primary-500"
        : "bg-accent-400";
  const iconColor =
    tone === "danger"
      ? "text-red-400"
      : tone === "primary"
        ? "text-primary-400"
        : tone === "muted"
          ? "text-gray-300"
          : "text-accent-400";
  const hoverBg =
    tone === "danger" ? "hover:bg-red-500/10" : "hover:bg-white/5";

  return (
    <button
      ref={ref}
      tabIndex={tabIndex ?? 0}
      onClick={onClick}
      title={title}
      className={`group relative flex items-center gap-4 w-full py-3 pl-5 pr-6 text-left rounded-lg transition-colors duration-200 ${
        active ? "bg-white/10" : hoverBg
      }`}
    >
      <span
        className={`absolute left-0 top-1/2 -translate-y-1/2 w-1 rounded-full transition-all duration-200 ${bar} ${
          active ? "h-3/5" : "h-0 group-hover:h-3/5"
        }`}
      />
      <span
        className={`${iconColor} transition-transform group-hover:scale-110 [&>svg]:w-6 [&>svg]:h-6`}
      >
        {icon}
      </span>
      <span
        className={`font-heading font-bold text-2xl uppercase tracking-wider transition-all ${
          active
            ? "text-white translate-x-1"
            : "text-gray-100 group-hover:text-white group-hover:translate-x-1"
        }`}
      >
        {label}
      </span>
    </button>
  );
});

function DropdownList({
  items,
  selectedCode,
  locale,
  onSelect,
  onClose,
}: {
  items: Array<{ code: string; name: string }>;
  selectedCode: string;
  locale: string;
  onSelect: (code: string) => void;
  onClose?: () => void;
}) {
  const [focusIdx, setFocusIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setFocusIdx(0);
  }, [items.length]);

  return (
    <div ref={listRef} onKeyDown={(e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = Math.min(focusIdx + 1, items.length - 1);
        setFocusIdx(next);
        const btns = listRef.current?.querySelectorAll<HTMLButtonElement>("button");
        btns?.[next]?.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const next = Math.max(focusIdx - 1, 0);
        setFocusIdx(next);
        const btns = listRef.current?.querySelectorAll<HTMLButtonElement>("button");
        btns?.[next]?.focus();
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (items[focusIdx]) onSelect(items[focusIdx].code);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose?.();
        document.getElementById("create-manager-field-nationality-btn")?.focus();
      }
    }}>
      {items.map((nat, i) => (
        <button
          key={nat.code}
          type="button"
          tabIndex={i === focusIdx ? 0 : -1}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(nat.code);
          }}
          className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between transition-colors ${
            selectedCode === nat.code
              ? "bg-accent-400/10 text-accent-400"
              : "text-gray-200 hover:bg-white/10"
          }`}
        >
          <div className="flex items-center gap-2">
            <CountryFlag
              code={nat.code}
              locale={locale}
              className="text-lg leading-none"
            />
            <span>{nat.name}</span>
          </div>
          {selectedCode === nat.code && (
            <Check className="w-4 h-4 text-accent-400" />
          )}
        </button>
      ))}
    </div>
  );
}
 
