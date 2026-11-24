import { Bug, LogOut, MessageCircle, Newspaper, Settings, UserRound } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import FloatingBugButton from "@/ui-v2/_legacy/components/dashboard/FloatingBugButton";

import { RailMore } from "./RailMore";

interface Props {
  activeTab: string;
  onNavClick: (tab: string) => void;
  onNavigateSettings: () => void;
  onExitClick: () => void;
}

/**
 * The phone's More: the rail has no stop for it, so its trigger sits in the bar. It lists what
 * the rail has no room for (News, Social, Manager, Settings, Report bug, Exit) and owns the
 * bug report modal those items open.
 */
export function PhoneMoreMenu({ activeTab, onNavClick, onNavigateSettings, onExitClick }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [bugOpen, setBugOpen] = useState(false);
  const items = [
    { id: "news", label: t("dashboard.news", { defaultValue: "News" }), icon: Newspaper, onSelect: () => onNavClick("News") },
    { id: "social", label: t("dashboard.social", { defaultValue: "Social" }), icon: MessageCircle, onSelect: () => onNavClick("Social") },
    { id: "settings", label: t("dashboard.settings", { defaultValue: "Settings" }), icon: Settings, onSelect: onNavigateSettings },
    { id: "bug", label: t("onAir.nav.bug", { defaultValue: "Report bug" }), icon: Bug, onSelect: () => setBugOpen(true) },
    { id: "exit", label: t("dashboard.exitToMenu", { defaultValue: "Exit" }), icon: LogOut, tone: "danger" as const, onSelect: onExitClick },
    { id: "manager", label: t("onAir.nav.manager", { defaultValue: "Manager profile" }), icon: UserRound, onSelect: () => onNavClick("Manager") },
  ];
  return (
    <>
      <RailMore
        label={t("onAir.nav.more", { defaultValue: "More" })}
        items={items}
        open={open}
        onOpenChange={setOpen}
        android
        placement="bar"
        active={activeTab === "Manager" || activeTab === "News" || activeTab === "Social"}
      />
      <FloatingBugButton variant="hidden" open={bugOpen} onOpenChange={setBugOpen} />
    </>
  );
}
