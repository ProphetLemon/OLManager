export interface ShellBadges {
  unread: number;
  offers: number;
  players: number;
  teams: number;
  staff: number;
}

export interface ShellNavProps {
  activeTab: string;
  onNavClick: (tab: string) => void;
  badges: ShellBadges;
  isUnemployed: boolean;
}
