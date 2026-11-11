import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import * as d3 from "d3";
import { feature } from "topojson-client";
import { ArrowLeft, Check, Loader2, Shield } from "lucide-react";
import type { CompetitionSummary, GameStateData } from "@/store/gameStore";
import { useGameStore } from "@/store/gameStore";
import { loadLeagueSelectionData, selectTeam } from "@/ui-v2/_legacy/components/teamSelection/teamSelection.helpers";
import { buildActiveLineupIds } from "@/lib/squad/helpers";
import { cn } from "@/ui-v2/lib/utils";

const LEAGUE_KEYS = ["LEC", "LCS", "LCK", "LPL", "LCP", "CBLOL"] as const;

const LEAGUE_COLORS: Record<string, string> = {
  LEC: "#0da8b8",
  LCS: "#1e6fbf",
  LCK: "#6b3fd4",
  LPL: "#cc2222",
  LCP: "#d4820a",
  CBLOL: "#22a022",
};

export function getLeagueConfig(t: (key: string) => string): Record<string, { color: string; label: string }> {
  return {
    LEC:   { color: LEAGUE_COLORS.LEC, label: t("leaguePicker.europe") },
    LCS:   { color: LEAGUE_COLORS.LCS, label: t("leaguePicker.northAmerica") },
    LCK:   { color: LEAGUE_COLORS.LCK, label: t("leaguePicker.korea") },
    LPL:   { color: LEAGUE_COLORS.LPL, label: t("leaguePicker.china") },
    LCP:   { color: LEAGUE_COLORS.LCP, label: t("leaguePicker.asiaPacific") },
    CBLOL: { color: LEAGUE_COLORS.CBLOL, label: t("leaguePicker.southAmerica") },
  };
}

const CTR: Record<number, string> = {};
[28,44,52,84,124,188,192,212,214,222,308,320,332,340,388,484,558,591,659,662,670,780,840].forEach((i) => CTR[i]="LCS");
[32,68,76,152,170,218,254,328,600,604,740,858,862].forEach((i) => CTR[i]="CBLOL");
[4,8,20,31,40,51,56,70,100,112,191,196,203,208,233,234,246,250,268,276,292,300,348,352,372,380,398,400,417,428,438,440,442,470,498,499,528,578,616,620,642,688,703,705,724,752,756,762,792,795,804,826,860,12,24,48,72,108,120,132,140,148,174,178,180,204,226,231,232,262,266,270,288,324,364,368,376,384,404,414,422,426,430,434,450,454,466,478,480,504,508,512,516,562,566,624,634,646,678,682,686,690,694,706,710,716,728,729,732,736,748,760,768,784,788,800,818,834,854,887,894].forEach((i) => CTR[i]="LEC");
[156,158].forEach((i) => CTR[i]="LPL");
[408,410].forEach((i) => CTR[i]="LCK");
[36,50,64,90,96,104,116,144,184,242,296,356,360,392,418,458,462,524,540,548,554,583,584,585,586,598,608,626,702,704,764,776,798,882].forEach((i) => CTR[i]="LCP");

function detectLeague(name: string): string | null {
  const u = name.toUpperCase();
  return LEAGUE_KEYS.find((k) => u.includes(k)) ?? null;
}

export default function LeaguePickerMapV2() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { setGameState, setGameActive } = useGameStore();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const clickHandlerRef = useRef<((league: string) => void) | null>(null);

  const [phase, setPhase] = useState<"loading" | "map" | "zoom">("loading");
  const [leagueData, setLeagueData] = useState<CompetitionSummary[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [selectedCompId, setSelectedCompId] = useState<string | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);

  const leagueToComp = useMemo(() => {
    const map = new Map<string, string>();
    leagueData.forEach((c) => {
      const l = detectLeague(c.name);
      if (l) map.set(l, c.id);
    });
    return map;
  }, [leagueData]);

  const selectedComp = selectedCompId
    ? leagueData.find((c) => c.id === selectedCompId)
    : null;

  const selectedTeam = selectedComp?.teams.find((t) => t.id === selectedTeamId);

  useEffect(() => {
    loadLeagueSelectionData()
      .then((data) => {
        setLeagueData(data.competitions);
        setPhase(data.competitions.length > 0 ? "map" : "loading");
      })
      .catch(() => setPhase("loading"));
  }, []);

  const handleCountryClick = useCallback((league: string) => {
    const compId = leagueToComp.get(league);
    if (!compId) return;
    setSelectedCompId(compId);
    setSelectedTeamId(null);
    setShowOverlay(false);
    setPhase("zoom");

    const svg = svgRef.current;
    if (!svg) return;
    const width = svg.clientWidth || 960;
    const height = 500;
    const proj = d3.geoNaturalEarth1().fitSize([width, height], { type: "Sphere" } as any);
    const pathFn = d3.geoPath().projection(proj);
    const sel = d3.select(svg);

    const centers: [number, number][] = [];
    sel.selectAll<SVGPathElement, any>("path.country").each(function (d: any) {
      if (CTR[d.id as number] === league) {
        const c = pathFn.centroid(d);
        if (c.every((v: number) => Number.isFinite(v))) centers.push(c);
      }
    });
    if (centers.length === 0) return;

    const xs = centers.map((c) => c[0]), ys = centers.map((c) => c[1]);
    const pad = 40;
    const dx = Math.max(...xs) - Math.min(...xs) + pad * 2;
    const dy = Math.max(...ys) - Math.min(...ys) + pad * 2;
    const scale = Math.min(width / dx, height / dy) * 0.85;
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const tx = width / 2 - cx * scale;
    const ty = height / 2 - cy * scale;

    sel.select(".map-group")
      .transition().duration(600)
      .attr("transform", `translate(${tx},${ty}) scale(${scale})`)
      .on("end", () => setShowOverlay(true));
  }, [leagueToComp]);

  clickHandlerRef.current = handleCountryClick;

  // Init D3 map
  useEffect(() => {
    const container = containerRef.current;
    if (!container || phase !== "map") return;

    const width = container.clientWidth || 960;
    const height = 500;

    const svg = d3.select(container)
      .append("svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("preserveAspectRatio", "xMidYMid meet")
      .style("display", "block")
      .style("width", "100%")
      .style("height", "100%");

    svgRef.current = svg.node();

    const defs = svg.append("defs");
    defs.append("filter").attr("id", "nb0").append("feGaussianBlur").attr("stdDeviation", "40");
    defs.append("filter").attr("id", "rim").append("feGaussianBlur").attr("stdDeviation", "3");

    // Map wrapper group — this gets transformed on programmatic zoom
    const mapGroup = svg.append("g").attr("class", "map-group");

    const nebula = svg.append("g").style("pointer-events", "none").style("opacity", "0.15");
    nebula.append("circle").attr("cx", 240).attr("cy", 150).attr("r", 160).attr("fill", "#1e6fbf").attr("filter", "url(#nb0)");
    nebula.append("circle").attr("cx", 720).attr("cy", 180).attr("r", 120).attr("fill", "#6b3fd4").attr("filter", "url(#nb0)");
    nebula.append("circle").attr("cx", 480).attr("cy", 350).attr("r", 100).attr("fill", "#0da8b8").attr("filter", "url(#nb0)");

    fetch("/data/countries-50m.json")
      .then((r) => r.json())
      .then((world: any) => {
        const all = feature(world, world.objects.countries) as any;
        const projection = d3.geoNaturalEarth1().fitSize([width, height], all);
        const path = d3.geoPath().projection(projection);

        mapGroup.append("path").attr("class", "ocean")
          .attr("d", path({ type: "Sphere" } as any))
          .attr("fill", "rgba(10,18,35,.85)")
          .style("pointer-events", "none");

        mapGroup.selectAll("path.country")
          .data(all.features)
          .join("path")
          .attr("class", (d: any) => CTR[d.id as number] ? `country league-${CTR[d.id as number]}` : "country land")
          .attr("d", path as any)
          .attr("fill", (d: any) => {
            const l = CTR[d.id as number];
            return l ? (LEAGUE_COLORS[l] ?? "#888") + "88" : "rgba(255,255,255,0.04)";
          })
          .attr("stroke", "rgba(13,19,32,.6)")
          .attr("stroke-width", "0.3")
          .style("cursor", (d: any) => CTR[d.id as number] ? "pointer" : "default")
          .style("transition", "filter .25s")
          .on("mouseenter", function (_ev: any, d: any) {
            const l = CTR[d.id as number];
            if (l) d3.select(this).style("filter", `brightness(1.3) drop-shadow(0 0 6px ${LEAGUE_COLORS[l] ?? "#fff"})`);
          })
          .on("mouseleave", function () { d3.select(this).style("filter", null); })
          .on("click", (_ev: any, d: any) => {
            const league = CTR[d.id as number];
            if (league && clickHandlerRef.current) clickHandlerRef.current(league);
          });

        mapGroup.insert("path", ":first-child")
          .attr("class", "rim")
          .attr("d", path({ type: "Sphere" } as any))
          .attr("fill", "none")
          .attr("stroke", "rgba(160,210,255,.12)")
          .attr("stroke-width", "4")
          .attr("filter", "url(#rim)");

        setMapReady(true);
      })
      .catch(() => {
        svg.append("text")
          .attr("x", width / 2).attr("y", height / 2)
          .attr("text-anchor", "middle").attr("fill", "rgba(255,80,80,.6)")
          .style("font-size", "14px")
          .text(t("leaguePicker.mapError"));
        setMapReady(true);
      });

    return () => { d3.select(container).selectAll("*").remove(); };
  }, []);

  const handleBack = useCallback(() => {
    setShowOverlay(false);
    setSelectedCompId(null);
    setSelectedTeamId(null);
    setPhase("map");
    if (svgRef.current) {
      d3.select(svgRef.current).select(".map-group")
        .transition().duration(500)
        .attr("transform", null as any);
    }
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!selectedTeamId || isConfirming) return;
    setIsConfirming(true);
    try {
      const updated = await selectTeam(selectedTeamId, i18n.language);
      const myTeam = updated.teams.find((t: any) => t.id === selectedTeamId);
      if (myTeam) {
        const roster = updated.players.filter((p: any) => p.team_id === myTeam.id);
        const lineup = buildActiveLineupIds(roster, myTeam.active_lineup_ids ?? myTeam.starting_xi_ids ?? []);
        if (lineup.some(Boolean)) myTeam.active_lineup_ids = lineup;
      }
      setGameState(updated as GameStateData);
      const mgr = updated.manager;
      const name = mgr.nickname?.trim() || `${mgr.first_name} ${mgr.last_name}`;
      setGameActive(true, name);
      navigate("/dashboard");
    } catch (err) {
      console.error("Failed to select team:", err);
    } finally {
      setIsConfirming(false);
    }
  }, [selectedTeamId, isConfirming, i18n.language, setGameState, setGameActive, navigate]);

  if (phase === "loading") {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="mx-auto mb-3 size-8 animate-spin text-club-text" />
          <p className="text-sm text-muted-foreground">{t("worldSelect.creatingWorld")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col bg-background">
      <header className="relative z-20 flex h-14 shrink-0 items-center border-b border-border bg-gradient-to-r from-primary/5 to-transparent px-6">
        <button type="button" onClick={handleBack} className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          <ArrowLeft className="size-4" />
        </button>
        <div className="ml-3">
          <p className="font-heading text-lg font-black uppercase tracking-widest text-foreground">
            {t("teamSelect.selectLeague", "Seleccionar región")}
          </p>
          <p className="text-xs text-muted-foreground/70">{t("leaguePicker.clickRegion")}</p>
        </div>
      </header>

      <div className="relative flex-1 overflow-hidden">
        {!mapReady && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80">
            <Loader2 className="size-8 animate-spin text-club-text" />
          </div>
        )}
        <div ref={containerRef} className="h-full min-h-[400px]" style={{ background: "radial-gradient(ellipse at 50% 55%,#0d1b2a,#070d16 70%,#020408)" }} />

        {showOverlay && selectedComp && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-fade-in-up">
            <div className="flex w-full max-w-xl flex-col gap-5 rounded-2xl border border-border/60 bg-card p-6 shadow-2xl animate-fade-in-up">
              <div className="flex items-center gap-4">
                <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-border bg-muted">
                  {selectedComp.logo ? (
                    <img src={selectedComp.logo} alt={selectedComp.name} className="size-10 object-contain" />
                  ) : (
                    <Shield className="size-6 text-muted-foreground" />
                  )}
                </div>
                <div>
                  <h2 className="font-heading text-xl font-bold uppercase tracking-wide text-foreground">{selectedComp.name}</h2>
                  <p className="text-sm text-muted-foreground">{selectedComp.region} · {t("teamSelect.teamCount", { count: selectedComp.team_count })}</p>
                </div>
              </div>

              <div className="grid max-h-[280px] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3 scrollbar-v2">
                {selectedComp.teams.map((team) => {
                  const sel = selectedTeamId === team.id;
                  return (
                    <button
                      key={team.id}
                      type="button"
                      onClick={() => setSelectedTeamId(sel ? null : team.id)}
                      className={cn(
                        "group relative flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition-all duration-200",
                        sel
                          ? "border-primary/60 bg-primary/10 shadow-lg shadow-primary/10"
                          : "border-border/60 bg-muted/20 hover:border-primary/40 hover:bg-muted/40 hover:-translate-y-0.5",
                      )}
                    >
                      {sel && (
                        <div className="absolute -right-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full bg-primary ring-2 ring-card">
                          <Check className="size-3.5 text-primary-foreground" />
                        </div>
                      )}
                      <div className="flex size-14 items-center justify-center overflow-hidden rounded-lg border border-border/40 bg-muted/60 p-1">
                        {team.logo_url ? (
                          <img src={team.logo_url} alt={team.name} className="size-10 object-contain" />
                        ) : (
                          <Shield className="size-6 text-muted-foreground/50" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-heading text-sm font-bold text-foreground">{team.short_name || team.name}</p>
                        <p className="text-2xs text-muted-foreground/60">{team.country}</p>
                      </div>
                      {team.ovr && (
                        <div className="rounded-md bg-primary/15 px-2 py-0.5 font-heading text-xs font-bold tabular-nums text-club-text">{team.ovr} OVR</div>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-border/40 pt-4">
                <button type="button" onClick={handleBack}
                  className="rounded-lg border border-border px-4 py-2 text-xs font-heading font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:bg-muted"
                >
                  {t("common.back", "Volver")}
                </button>
                <button type="button" disabled={!selectedTeamId || isConfirming} onClick={handleConfirm}
                  className="flex items-center gap-2 rounded-lg bg-primary px-6 py-2 text-xs font-heading font-bold uppercase tracking-wider text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:bg-primary/90 hover:shadow-xl disabled:pointer-events-none disabled:opacity-50"
                >
                  {isConfirming && <Loader2 className="size-4 animate-spin" />}
                  {selectedTeam
                    ? `${t("teamSelect.confirm", "Confirmar")} — ${selectedTeam.short_name || selectedTeam.name}`
                    : t("teamSelect.selectTeam", "Elige un equipo")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
