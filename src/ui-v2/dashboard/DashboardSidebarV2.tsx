import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useRef } from "react";
import { useRovingFocus } from "@/hooks/useRovingFocus";
import {
  Briefcase,
  Mail,
  Newspaper,
  MessageCircle,
  Calendar as CalendarIcon,
  Users,
  Crosshair,
  Dumbbell,
  Swords,
  Trophy,
  Gamepad2,
  UserCog,
  Eye,
  GraduationCap,
  DollarSign,
  TrendingUp,
  UsersRound,
  Building2,
  Globe,
  Store,
  Settings,
  LogOut,
} from "lucide-react";
import { cn } from "@/ui-v2/lib/utils";
import { Separator } from "@/ui-v2/components/ui/separator";
import { Badge } from "@/ui-v2/components/ui/badge";

type Item = { tab: string; label: string; icon: React.ComponentType<{ className?: string }>; badge?: number };

interface Props {
  activeTab: string;
  onNavClick: (tab: string) => void;
  unreadMessagesCount: number;
  pendingOffersCount?: number;
  managerName: string | null;
  managerFullName?: string | null;
  managerAvatar?: string | null;
  teamName: string | null;
  teamLogo: string | null;
  isUnemployed: boolean;
  onNavigateSettings: () => void;
  onExitClick: () => void;
  playerCount?: number;
  teamCount?: number;
  staffCount?: number;
}

export function DashboardSidebarV2({
  activeTab,
  onNavClick,
  unreadMessagesCount,
  pendingOffersCount = 0,
  managerName,
  managerFullName,
  managerAvatar,
  teamName,
  teamLogo,
  isUnemployed,
  onNavigateSettings,
  onExitClick,
  playerCount = 0,
  teamCount = 0,
  staffCount = 0,
}: Props) {
  const { t } = useTranslation();

  const top: Item[] = useMemo(() => [
    { tab: "Home", label: t("dashboard.home"), icon: Briefcase },
    { tab: "Inbox", label: t("dashboard.inbox"), icon: Mail, badge: unreadMessagesCount },
    { tab: "News", label: t("dashboard.news"), icon: Newspaper },
    { tab: "Social", label: t("dashboard.social", { defaultValue: "Social" }), icon: MessageCircle },
    { tab: "Schedule", label: t("dashboard.schedule"), icon: CalendarIcon },
  ], [t, unreadMessagesCount]);

  const club: Item[] = useMemo(() => [
    { tab: "Squad", label: t("dashboard.squad"), icon: Users },
    { tab: "Tactics", label: t("dashboard.tactics"), icon: Crosshair },
    { tab: "Training", label: t("dashboard.training"), icon: Dumbbell },
    { tab: "Scrims", label: t("dashboard.scrims"), icon: Swords },
    { tab: "Soloq", label: t("dashboard.soloq"), icon: Trophy },
    { tab: "Meta", label: t("dashboard.meta"), icon: Gamepad2 },
    { tab: "Staff", label: t("dashboard.staff"), icon: UserCog },
    { tab: "Scouting", label: t("dashboard.scouting"), icon: Eye },
    { tab: "Youth", label: t("dashboard.youthAcademy"), icon: GraduationCap },
    { tab: "Finances", label: t("dashboard.finances"), icon: DollarSign },
  ], [t]);

  const world: Item[] = useMemo(() => [
    { tab: "Competitions", label: t("dashboard.competitions", { defaultValue: "Competiciones" }), icon: Globe },
    { tab: "Players", label: t("dashboard.players"), icon: UsersRound, badge: playerCount },
    { tab: "Teams", label: t("dashboard.teams"), icon: Building2, badge: teamCount },
    { tab: "WorldStaff", label: t("dashboard.worldStaff", { defaultValue: "Staffs" }), icon: UserCog, badge: staffCount },
    { tab: "ChampionsWorld", label: t("dashboard.champions_world"), icon: Gamepad2 },
  ], [t, playerCount, teamCount, staffCount]);

  const market: Item[] = useMemo(() => [
    { tab: "Market", label: t("dashboard.market"), icon: Store },
    { tab: "Transfers", label: t("dashboard.transfers"), icon: TrendingUp, badge: pendingOffersCount },
  ], [t, pendingOffersCount]);

  const allNavItems = useMemo(() => {
    const items = [...top];
    if (!isUnemployed) items.push(...club);
    items.push(...market);
    items.push(...world);
    return items;
  }, [top, club, market, world, isUnemployed]);

  const initialNavIndex = useMemo(() => Math.max(0, allNavItems.findIndex((item) => item.tab === activeTab)), [allNavItems, activeTab]);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const { activeIndex, handleKeyDown, getTabIndex } = useRovingFocus({
    itemCount: allNavItems.length,
    columns: 1,
    initialIndex: initialNavIndex,
    onSelect: (i) => onNavClick(allNavItems[i]?.tab),
    getItemLabel: (i) => allNavItems[i]?.label ?? "",
  });

  useEffect(() => {
    itemRefs.current[activeIndex]?.focus();
  }, [activeIndex]);

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-3 p-4">
        {teamLogo ? (
          <img src={teamLogo} alt={teamName ?? ""} className="size-9 rounded-md object-contain" />
        ) : (
          <div className="size-9 rounded-md bg-muted" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs uppercase tracking-widest text-muted-foreground">
            {t("dashboard.brandTitle")}
          </div>
          <div className="truncate font-heading text-base font-bold text-primary">{t("dashboard.brandSubtitle")}</div>
        </div>
      </div>

      <Separator />

      <button
        onClick={() => onNavClick("Manager")}
        className={cn(
          "flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-sidebar-accent",
          activeTab === "Manager" && "bg-sidebar-accent",
        )}
      >
        {managerAvatar ? (
          <img src={managerAvatar} alt={managerName ?? ""} className="size-9 rounded-full object-cover ring-2 ring-primary/60" />
        ) : (
          <div className="size-9 rounded-full bg-muted ring-2 ring-primary/60" />
        )}
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{managerName ?? "—"}</div>
          {managerFullName && <div className="truncate text-xs text-muted-foreground">{managerFullName}</div>}
        </div>
      </button>

      <Separator />

      <nav
        className="min-h-0 flex-1 overflow-y-auto px-2 py-3 text-sm scrollbar-v2"
        onKeyDown={handleKeyDown}
        tabIndex={-1}
      >
        <Group items={top} flatIndex={0} activeTab={activeTab} onNavClick={onNavClick} itemRefs={itemRefs} getTabIndex={getTabIndex} />

        {!isUnemployed && (
          <>
            <SectionLabel>{t("dashboard.sectionClub")}</SectionLabel>
            <Group items={club} flatIndex={top.length} activeTab={activeTab} onNavClick={onNavClick} itemRefs={itemRefs} getTabIndex={getTabIndex} />
          </>
        )}

        <SectionLabel>{t("dashboard.sectionMarket", { defaultValue: "Market" })}</SectionLabel>
        <Group items={market} flatIndex={top.length + (isUnemployed ? 0 : club.length)} activeTab={activeTab} onNavClick={onNavClick} itemRefs={itemRefs} getTabIndex={getTabIndex} />

        <SectionLabel>{t("dashboard.sectionWorld")}</SectionLabel>
        <Group items={world} flatIndex={top.length + (isUnemployed ? 0 : club.length) + market.length} activeTab={activeTab} onNavClick={onNavClick} itemRefs={itemRefs} getTabIndex={getTabIndex} />
      </nav>

      <Separator />

      <div className="shrink-0 p-2 text-sm">
        <FooterButton icon={Settings} label={t("dashboard.settings")} onClick={onNavigateSettings} />
        <FooterButton
          icon={LogOut}
          label={t("dashboard.exitToMenu")}
          onClick={onExitClick}
          danger
        />
      </div>
    </aside>
  );
}

function Group({
  items,
  flatIndex,
  activeTab,
  onNavClick,
  itemRefs,
  getTabIndex,
}: {
  items: Item[];
  flatIndex: number;
  activeTab: string;
  onNavClick: (tab: string) => void;
  itemRefs: React.MutableRefObject<(HTMLButtonElement | null)[]>;
  getTabIndex: (index: number) => 0 | -1;
}) {
  return (
    <div className="space-y-0.5">
      {items.map((it, localIdx) => {
        const globalIdx = flatIndex + localIdx;
        const Icon = it.icon;
        const active = activeTab === it.tab;
        return (
          <button
            key={it.tab}
            ref={(el) => { itemRefs.current[globalIdx] = el; }}
            tabIndex={getTabIndex(globalIdx)}
            onClick={() => onNavClick(it.tab)}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors",
              active
                ? "bg-sidebar-accent text-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" />
            <span className="flex-1 truncate font-heading text-xs font-semibold uppercase tracking-wider">
              {it.label}
            </span>
            {it.badge !== undefined && it.badge > 0 && (
              <Badge className="h-5 px-1.5 text-2xs">{it.badge}</Badge>
            )}
          </button>
        );
      })}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-4 pb-1 font-heading text-2xs uppercase tracking-widest text-muted-foreground/70">
      {children}
    </div>
  );
}

function FooterButton({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors",
        danger
          ? "text-destructive hover:bg-destructive/10"
          : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
      )}
    >
      <Icon className="size-4" />
      <span className="font-heading text-xs font-semibold uppercase tracking-wider">{label}</span>
    </button>
  );
}
