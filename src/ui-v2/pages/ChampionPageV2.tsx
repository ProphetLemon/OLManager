import { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { Swords, Shield, Crosshair, Zap, TrendingUp, Crown, BarChart3, Activity, ArrowLeft } from "lucide-react";
import { resolveChampionTile, resolveChampionSplash } from "@/lib/champions/championImages";
import { championDisplayName } from "@/lib/champions/championNames";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui-v2/components/ui/card";
import { Badge } from "@/ui-v2/components/ui/badge";
import { cn } from "@/ui-v2/lib/utils";
import { formatNumber } from "@/lib/formatting/valueFormatting";

interface Props { championKey: string; onClose: () => void; }

interface Stats {
  champion_key: string; champion_name: string;
  total_games: number; total_wins: number;
  win_rate: number; pick_rate: number; ban_rate: number;
  avg_kills: number; avg_deaths: number; avg_assists: number; avg_kda: number;
  avg_gold: number; avg_damage: number; avg_cs: number; avg_vision: number; avg_duration: number;
  role_distribution: { role: string; games: number; percentage: number }[];
  best_against: { vs_champion_key: string; vs_champion_name: string; games: number; wins: number; win_rate: number }[];
  worst_against: { vs_champion_key: string; vs_champion_name: string; games: number; wins: number; win_rate: number }[];
  top_players: { player_id: string; player_name: string; team_name: string; games: number; win_rate: number; avg_kda: number }[];
  weekly_history: { week_label: string; games: number; win_rate: number; avg_kda: number }[];
}

const ROLE_META: Record<string, { icon: typeof Shield; color: string; labelKey: string }> = {
  TOP: { icon: Shield, color: "text-red-400", labelKey: "onAir.roles.TOP" },
  JUNGLE: { icon: Crosshair, color: "text-green-400", labelKey: "onAir.roles.JUNGLE" },
  MID: { icon: Zap, color: "text-amber-400", labelKey: "onAir.roles.MID" },
  ADC: { icon: Crosshair, color: "text-blue-400", labelKey: "onAir.roles.ADC" },
  SUPPORT: { icon: Shield, color: "text-purple-400", labelKey: "onAir.roles.SUPPORT" },
};

export default function ChampionPageV2({ championKey, onClose }: Props) {
  const { t } = useTranslation();
  const [s, setS] = useState<Stats | null>(null);
  const splash = resolveChampionSplash(championKey);
  const tile = resolveChampionTile(championKey);
  const heroRef = useRef<HTMLDivElement>(null);
  const displayName = championDisplayName(championKey, s?.champion_name);

  useEffect(() => {
    invoke<Stats>("get_champion_stats", { championKey })
      .then(setS)
      .catch(() => {});
  }, [championKey]);

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background scrollbar-v2">
      {/* ─── HERO ─── */}
      <div ref={heroRef} className="relative flex min-h-[40vh] items-end overflow-hidden">
        {splash && (
          <img src={splash} alt={displayName}
            className="absolute inset-0 size-full object-cover object-top transition-all duration-[1.5s] hover:scale-105" />
        )}
        {/* Gradient layers */}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-background/60 via-transparent to-transparent" />

        {/* Back button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute left-4 top-4 z-20 flex size-9 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white/80 backdrop-blur transition-all hover:bg-black/70 hover:text-white"
        >
          <ArrowLeft className="size-4" />
        </button>

        {/* Watermark name */}
        <div className="pointer-events-none absolute -right-8 -top-8 select-none text-[18vw] font-heading font-black uppercase leading-none text-white/5 md:-right-12 md:-top-12 md:text-[16vw]">
          {displayName}
        </div>

        {/* Hero content */}
        <div className="relative z-10 flex w-full flex-col gap-6 p-6 pb-8 md:flex-row md:items-end md:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border-2 border-white/20 bg-black/40 shadow-2xl backdrop-blur">
              {tile && <img src={tile} alt={displayName} className="size-full object-cover" />}
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="font-heading text-3xl font-black uppercase tracking-wide text-white drop-shadow-lg md:text-4xl">
                  {displayName}
                </h1>
                {s && <Badge className="bg-white/20 text-white backdrop-blur">{t("championPage.gamesShort", { count: s.total_games })}</Badge>}
              </div>
              <p className="mt-1 flex items-center gap-2 text-sm text-white/70">
                <span className="font-heading text-xs uppercase tracking-widest">{t("championPage.champion")}</span>
              </p>
            </div>
          </div>

          {/* Hero stats — glass cards */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: t("championPage.wr"), val: s ? `${s.win_rate}%` : "—", acc: s && s.win_rate >= 50 ? "text-positive" : "text-negative" },
              { label: t("championPage.pr"), val: s ? `${s.pick_rate}%` : "—", acc: "text-club-text" },
              { label: t("championPage.br"), val: s ? `${s.ban_rate}%` : "—", acc: "text-amber-400" },
              { label: t("championPage.kda"), val: s ? s.avg_kda.toFixed(1) : "—", acc: s ? "text-white" : "text-white/40" },
            ].map((st) => (
              <div key={st.label}
                className="rounded-xl border border-white/15 bg-black/50 px-3 py-2.5 text-center backdrop-blur-md transition-all hover:border-primary/40 hover:bg-black/60">
                <p className="font-heading text-2xs font-bold uppercase tracking-widest text-white/50">{st.label}</p>
                <p className={cn("font-heading text-xl font-black tabular-nums drop-shadow", st.acc)}>{st.val}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ─── CONTENT ─── */}
      <div className="grid grid-cols-1 gap-5 p-6 pt-5 lg:grid-cols-[1fr_360px]">
        {/* LEFT COLUMN */}
        <div className="flex min-w-0 flex-col gap-5">
          {/* Performance grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              { label: t("championPage.kills"), val: s ? s.avg_kills.toFixed(1) : "—", icon: Swords, c: "text-red-400" },
              { label: t("championPage.deaths"), val: s ? s.avg_deaths.toFixed(1) : "—", icon: Activity, c: "text-amber-400" },
              { label: t("championPage.assists"), val: s ? s.avg_assists.toFixed(1) : "—", icon: TrendingUp, c: "text-emerald-400" },
              { label: t("championPage.gold"), val: s ? formatNumber(s.avg_gold) : "—", icon: Crown, c: "text-yellow-400" },
              { label: t("championPage.damage"), val: s ? formatNumber(s.avg_damage) : "—", icon: Swords, c: "text-orange-400" },
              { label: t("championPage.cs"), val: s ? s.avg_cs.toFixed(0) : "—", icon: TrendingUp, c: "text-blue-400" },
            ].map((st) => (
              <div key={st.label}
                className="group relative overflow-hidden rounded-xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5">
                {/* Accent line */}
                <div className={cn("absolute left-0 top-0 h-full w-0.5 opacity-60 transition-opacity group-hover:opacity-100", st.c.replace("text-", "bg-"))} />
                <div className="flex items-center gap-3">
                  <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted", st.c)}>
                    <st.icon className="size-4" />
                  </div>
                  <div>
                    <p className="font-heading text-2xs uppercase tracking-widest text-muted-foreground">{st.label}</p>
                    <p className="font-heading text-lg font-black tabular-nums text-foreground">
                      {st.val}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Role distribution */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="font-heading text-xs uppercase tracking-widest text-muted-foreground">{t("championPage.roles")}</CardTitle></CardHeader>
            <CardContent>
              {s?.role_distribution && s.role_distribution.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {s.role_distribution.map((r) => {
                    const meta = ROLE_META[r.role.toUpperCase()] ?? ROLE_META.TOP;
                    const Icon = meta.icon;
                    return (
                      <div key={r.role} className="flex items-center gap-3 rounded-lg border border-border bg-card/50 px-3 py-2.5 transition-colors hover:bg-muted/30">
                        <Icon className={cn("size-4 shrink-0", meta.color)} />
                        <span className="min-w-14 font-heading text-xs font-bold uppercase tracking-wider text-foreground">{t(meta.labelKey)}</span>
                        <span className="text-xs tabular-nums text-muted-foreground/60">{t("championPage.gamesShort", { count: r.games })}</span>
                        <div className="flex-1">
                          <div className="h-2 overflow-hidden rounded-full bg-muted">
                            <div className={cn("h-full rounded-full transition-all duration-700", meta.color.replace("text-", "bg-"))}
                              style={{ width: `${r.percentage}%` }} />
                          </div>
                        </div>
                        <span className="min-w-10 text-right font-heading text-xs font-bold tabular-nums text-foreground">{r.percentage}%</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <Empty icon={BarChart3} msg={t("championPage.noRoles")} />
              )}
            </CardContent>
          </Card>

          {/* Matchups */}
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <MatchupBlock title={t("championPage.bestAgainst")} items={s?.best_against} type="best" />
            <MatchupBlock title={t("championPage.worstAgainst")} items={s?.worst_against} type="worst" />
          </div>
        </div>

        {/* RIGHT COLUMN — SIDEBAR */}
        <aside className="flex flex-col gap-5">
          {/* Top Players */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="font-heading text-xs uppercase tracking-widest text-muted-foreground">{t("championPage.topPlayers")}</CardTitle></CardHeader>
            <CardContent className="p-0">
              {s?.top_players && s.top_players.length > 0 ? (
                <div className="divide-y divide-border/30">
                  {s.top_players.slice(0, 6).map((p, i) => (
                    <div key={p.player_id}
                      className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/20">
                      <span className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-md font-heading text-xs font-bold",
                        i === 0 ? "bg-amber-500/20 text-amber-400" :
                        i === 1 ? "bg-zinc-500/20 text-zinc-300" :
                        i === 2 ? "bg-orange-600/20 text-orange-400" :
                        "bg-muted text-muted-foreground"
                      )}>{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{p.player_name}</p>
                        <p className="truncate text-xs text-muted-foreground">{p.team_name}</p>
                      </div>
                      <span className="font-heading text-sm font-bold tabular-nums" style={{ color: p.win_rate >= 50 ? "#34d399" : "#f87171" }}>
                        {p.win_rate}%
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="px-4 py-4 text-sm text-muted-foreground">{t("championPage.noData")}</p>
              )}
            </CardContent>
          </Card>

          {/* Vision */}
          {s && (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-border bg-card p-4 text-center">
                <p className="font-heading text-2xs uppercase tracking-widest text-muted-foreground">{t("championPage.vision")}</p>
                <p className="font-heading text-2xl font-black tabular-nums text-purple-400">{s.avg_vision.toFixed(0)}</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-4 text-center">
                <p className="font-heading text-2xs uppercase tracking-widest text-muted-foreground">{t("championPage.duration")}</p>
                <p className="font-heading text-2xl font-black tabular-nums text-foreground">{t("championPage.minutesShort", { count: Math.round(s.avg_duration / 60) })}</p>
              </div>
            </div>
          )}

          {/* Weekly History */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="font-heading text-xs uppercase tracking-widest text-muted-foreground">{t("championPage.weekly")}</CardTitle></CardHeader>
            <CardContent className="p-0">
              {s?.weekly_history && s.weekly_history.length > 0 ? (
                <div className="divide-y divide-border/30">
                  {s.weekly_history.slice(0, 5).map((w) => (
                    <div key={w.week_label} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/20">
                      <span className="w-20 font-heading text-xs font-bold text-foreground">{w.week_label}</span>
                      <div className="flex flex-1 items-center gap-2">
                        <span className="text-xs tabular-nums text-muted-foreground">{t("championPage.gamesShort", { count: w.games })}</span>
                        <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${w.win_rate}%` }} />
                        </div>
                      </div>
                      <span className="font-heading text-xs font-bold tabular-nums" style={{ color: w.win_rate >= 50 ? "#34d399" : "#f87171" }}>
                        {w.win_rate}%
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="px-4 py-4 text-sm text-muted-foreground">{t("championPage.noHistory")}</p>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function MatchupBlock({ title, items, type }: {
  title: string; items?: { vs_champion_key: string; vs_champion_name: string; games: number; wins: number; win_rate: number }[]; type: "best" | "worst";
}) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className={cn("font-heading text-xs uppercase tracking-widest", type === "best" ? "text-positive" : "text-negative")}>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {items && items.length > 0 ? (
          <div className="divide-y divide-border/30">
            {items.slice(0, 5).map((item) => {
              const tile = resolveChampionTile(item.vs_champion_key);
              const wrColor = item.win_rate >= 50 ? "#34d399" : "#f87171";
              return (
                <div key={item.vs_champion_key}
                  className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/20">
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    {tile && <img src={tile} alt={championDisplayName(item.vs_champion_key, item.vs_champion_name)} className="size-8 shrink-0 rounded object-cover" />}
                    <span className="truncate text-sm font-medium text-foreground">{championDisplayName(item.vs_champion_key, item.vs_champion_name)}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs tabular-nums text-muted-foreground/60">{t("championPage.gamesShort", { count: item.games })}</span>
                    <div className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full transition-all" style={{ width: `${item.win_rate}%`, backgroundColor: wrColor }} />
                    </div>
                    <span className="w-10 text-right font-heading text-sm font-bold tabular-nums" style={{ color: wrColor }}>{item.win_rate}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="px-4 py-4 text-sm text-muted-foreground">{t("championPage.noData")}</p>
        )}
      </CardContent>
    </Card>
  );
}

function Empty({ icon: Icon, msg }: { icon: typeof BarChart3; msg: string }) {
  return <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Icon className="size-4" />{msg}</p>;
}
