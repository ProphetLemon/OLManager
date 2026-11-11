import type { ChampionState, SimEvent, TeamId } from "@/ui-v2/_legacy/components/match/lol-prototype/engine/types";

function ts(sec: number) {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

interface ScoreboardProps {
  timeSec: number;
  status: string;
  blue: { kills: number; towers: number; dragons: number; barons: number; gold: number; avgLevel: number };
  red: { kills: number; towers: number; dragons: number; barons: number; gold: number; avgLevel: number };
}

function compactGold(gold: number) {
  if (gold < 1000) return `${Math.round(gold)}g`;
  return `${(gold / 1000).toFixed(1)}k`;
}

export function ScoreboardPanel({ timeSec, status, blue, red }: ScoreboardProps) {
  return (
    <div className="rounded-xl border border-cyan-500/25 bg-[#0a142b] p-3 text-slate-100">
      <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-widest text-cyan-300">
        <span>{status}</span>
        <span>{ts(timeSec)}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded border border-cyan-500/20 p-2">
          <p className="font-semibold text-cyan-300">Blue</p>
          <p>K {blue.kills} · T {blue.towers}</p>
          <p>D {blue.dragons} · B {blue.barons}</p>
          <p>G {compactGold(blue.gold)} · L {blue.avgLevel.toFixed(1)}</p>
        </div>
        <div className="rounded border border-rose-500/20 p-2">
          <p className="font-semibold text-rose-300">Red</p>
          <p>K {red.kills} · T {red.towers}</p>
          <p>D {red.dragons} · B {red.barons}</p>
          <p>G {compactGold(red.gold)} · L {red.avgLevel.toFixed(1)}</p>
        </div>
      </div>
    </div>
  );
}

interface EventsProps {
  events: SimEvent[];
}

export function EventFeedPanel({ events }: EventsProps) {
  return (
    <div className="rounded-xl border border-cyan-500/25 bg-[#0a142b] p-3 text-slate-100">
      <p className="mb-2 text-xs uppercase tracking-widest text-cyan-300">Events</p>
      <div className="max-h-64 overflow-auto space-y-1 text-xs">
        {events.map((e, idx) => (
          <div key={`${e.t}-${idx}-${e.type}`} className="flex gap-2">
            <span className="w-11 text-cyan-300">{ts(e.t)}</span>
            <span className="text-slate-200">{e.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const ROLE_ORDER: ChampionState["role"][] = ["TOP", "JGL", "MID", "ADC", "SUP"];

function championIconUrl(championId: string | undefined) {
  if (!championId) return null;
  return `/champion-tiles/${championId}.webp`;
}

function itemIconUrl(itemKey: string | undefined) {
  if (!itemKey) return null;
  return `/lol-item-icons/${itemKey}.png`;
}

function trinketIconUrl(trinketKey: string | undefined) {
  if (!trinketKey) return null;
  const key = trinketKey.trim().toLowerCase();
  if (key === "wardingtotem") {
    return "/lol-item-icons/stealth_ward.png";
  }
  if (key === "oraclelens") {
    return "/lol-item-icons/oracle_lens.png";
  }
  return null;
}

function summonerSpellIconUrl(spellKey: string | undefined) {
  if (!spellKey) return null;
  const normalized = spellKey.trim().toLowerCase();
  const byKey: Record<string, string> = {
    flash: "SummonerFlash",
    ignite: "SummonerDot",
    heal: "SummonerHeal",
    smite: "SummonerSmite",
    teleport: "SummonerTeleport",
  };
  const icon = byKey[normalized];
  if (!icon) return null;
  return `/lol-summoner-icons/${icon}.png`;
}

function sortByRole(champions: ChampionState[]) {
  return [...champions].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
}

interface LecLowerThirdProps {
  champions: ChampionState[];
  championByPlayerId?: Record<string, string>;
  timeSec?: number;
}
function Slot({ className = "h-4 w-4", trinket = false, goldBorder = false, itemKey, spellKey, iconUrl, cooldownText }: {
  className?: string;
  trinket?: boolean;
  goldBorder?: boolean;
  itemKey?: string;
  spellKey?: string;
  iconUrl?: string;
  cooldownText?: string;
}) {
  const icon = itemKey ? itemIconUrl(itemKey) : (spellKey ? summonerSpellIconUrl(spellKey) : undefined);
  const effectiveIcon = iconUrl ?? icon ?? undefined;
  const shouldShowCd = Boolean(cooldownText && cooldownText !== "0");
  const borderClass = trinket || goldBorder ? "border-amber-400/90" : "border-white/15";
  return (
    <div className={`${className} relative overflow-hidden border ${borderClass} bg-black`}>
      {effectiveIcon ? <img src={effectiveIcon} alt={itemKey ?? spellKey ?? "slot"} className="h-full w-full object-cover" loading="lazy" /> : null}
      {shouldShowCd ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-2xs font-black text-amber-300">
          {cooldownText}
        </div>
      ) : null}
    </div>
  );
}

function manaRatio(champion: ChampionState | undefined) {
  if (!champion) return 0.45;
  const laneBias: Record<ChampionState["role"], number> = {
    TOP: 0.45,
    JGL: 0.62,
    MID: 0.76,
    ADC: 0.58,
    SUP: 0.66,
  };
  const xpProgress = (champion.xp % 100) / 100;
  return Math.max(0.18, Math.min(1, (laneBias[champion.role] + xpProgress) / 2));
}

function purchasedItemCount(champion: ChampionState | undefined) {
  return champion ? Math.min(6, champion.items.length) : 0;
}

function championTotalGold(champion: ChampionState | undefined) {
  if (!champion) return 0;
  return champion.gold + champion.spentGold;
}

function SidePane({ champion, team, championByPlayerId, timeSec }: {
  champion: ChampionState | undefined;
  team: TeamId;
  championByPlayerId?: Record<string, string>;
  timeSec: number;
}) {
  const red = team === "red";
  const icon = championIconUrl(champion && championByPlayerId ? championByPlayerId[champion.id] : undefined);
  const hpBase = champion && champion.maxHp > 0 ? Math.max(0, Math.min(1, champion.hp / champion.maxHp)) : 0;
  const hp = champion && !champion.alive ? 0 : hpBase;
  const mp = manaRatio(champion);
  const cs = champion?.cs ?? 0;
  const respawnText = champion && !champion.alive && champion.respawnAt > timeSec
    ? `${Math.ceil(champion.respawnAt - timeSec)}`
    : "";
  const level = champion?.level ?? 1;
  const name = champion?.name ?? "-";
  const banished = champion ? (champion.realmBanishedUntil ?? 0) > timeSec : false;
  const kda = champion ? `${champion.kills}/${champion.deaths}/${champion.assists}` : "0/0/0";
  const boughtItems = purchasedItemCount(champion);
  const itemKeys = champion?.items ?? [];
  const trinketIcon = trinketIconUrl(champion?.trinketKey);
  const trinketCd = (() => {
    if (!champion) return undefined;
    const trinket = champion.trinketKey?.toLowerCase();
    if (trinket === "oraclelens") {
      if ((champion.sweeperActiveUntil ?? 0) > timeSec) {
        return `${Math.ceil((champion.sweeperActiveUntil ?? 0) - timeSec)}`;
      }
      if ((champion.sweeperCdUntil ?? 0) > timeSec) {
        return `${Math.ceil((champion.sweeperCdUntil ?? 0) - timeSec)}`;
      }
      return undefined;
    }
    if ((champion.wardCdUntil ?? 0) > timeSec) {
      return `${Math.ceil((champion.wardCdUntil ?? 0) - timeSec)}`;
    }
    return undefined;
  })();
  const summoners = champion?.summonerSpells?.slice(0, 2) ?? [];
  const firstSummoner = summoners[0];
  const secondSummoner = summoners[1];
  const firstSummonerCd = firstSummoner && firstSummoner.cdUntil > timeSec ? `${Math.ceil(firstSummoner.cdUntil - timeSec)}` : undefined;
  const secondSummonerCd = secondSummoner && secondSummoner.cdUntil > timeSec ? `${Math.ceil(secondSummoner.cdUntil - timeSec)}` : undefined;
  const ultimateIcon = champion?.ultimate?.icon;
  const ultimateCd = champion?.ultimate && champion.ultimate.cdUntil > timeSec
    ? `${Math.ceil(champion.ultimate.cdUntil - timeSec)}`
    : undefined;

  return (
    <div className={`side ${red ? "red" : "blue"} flex flex-1 items-center gap-[6px] px-[10px] ${red ? "border-r-[3px] border-r-orange-400" : "border-l-[3px] border-l-cyan-400"}`}>
      {red && (
        <div className={`stats flex min-w-0 flex-1 flex-col gap-[1px] px-[5px] text-right`}>
          <div className="top-info flex flex-row-reverse justify-between text-2xs font-black uppercase">
            <span className="truncate">{name}{banished ? " (Realm)" : ""}</span>
            <span className="farm text-amber-300">{cs}</span>
          </div>
          <div className="bars flex flex-col gap-[1px]">
            <div className="hp h-[7px] rounded-[1px] bg-rose-400 shadow-[0_0_6px_rgba(248,113,113,0.3)]" style={{ width: `${hp <= 0 ? 0 : Math.max(8, hp * 100)}%` }} />
            <div className="mp ml-auto h-[2px] bg-blue-500" style={{ width: `${Math.max(8, mp * 55)}%` }} />
          </div>
          <div className="kda text-2xs font-bold text-white/45">{kda}</div>
        </div>
      )}

      {!red && (
        <>
          <div className="items-group flex gap-[2px]">
            <Slot className="trinket h-[18px] w-[18px]" trinket iconUrl={trinketIcon ?? undefined} cooldownText={trinketCd} />
            {Array.from({ length: 6 }).map((_, idx) => (
              <Slot
                // eslint-disable-next-line react/no-array-index-key
                key={`blue-item-${idx}`}
                itemKey={idx < boughtItems ? itemKeys[idx] : undefined}
                className={`item h-[18px] w-[18px] ${idx < boughtItems ? "border-emerald-300/90 bg-emerald-400/35" : ""}`}
              />
            ))}
          </div>
          <Slot className="respawn h-[22px] w-[22px]" iconUrl={ultimateIcon} cooldownText={ultimateCd} goldBorder />
          <div className="spells flex flex-col gap-[1px]">
            <Slot className="spell h-[12px] w-[12px]" spellKey={firstSummoner?.key} cooldownText={firstSummonerCd} />
            <Slot className="spell h-[12px] w-[12px]" spellKey={secondSummoner?.key} cooldownText={secondSummonerCd} />
          </div>
          <div className="portrait-container relative h-[34px] w-[34px] border border-white/15 bg-black">
            {icon ? <img src={icon} alt={name} className={`h-full w-full object-cover ${champion && (!champion.alive || banished) ? "grayscale opacity-55" : ""}`} /> : null}
            {champion && !champion.alive && respawnText && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/45 text-xs font-black text-amber-300">
                {respawnText}
              </div>
            )}
            {banished && (
              <div className="absolute inset-0 flex items-center justify-center bg-violet-900/55 text-2xs font-black text-violet-200">
                REALM
              </div>
            )}
            <div className="lvl absolute -bottom-[2px] -right-[2px] flex h-[12px] w-[12px] items-center justify-center border border-cyan-400 bg-black text-2xs font-black">
              {level}
            </div>
          </div>
        </>
      )}

      {!red && (
        <div className="stats flex min-w-0 flex-1 flex-col gap-[1px] px-[5px] text-left">
          <div className="top-info flex justify-between text-2xs font-black uppercase">
            <span className="truncate">{name}{banished ? " (Realm)" : ""}</span>
            <span className="farm text-amber-300">{cs}</span>
          </div>
          <div className="bars flex flex-col gap-[1px]">
            <div className="hp h-[7px] rounded-[1px] bg-emerald-400 shadow-[0_0_6px_rgba(74,222,128,0.3)]" style={{ width: `${hp <= 0 ? 0 : Math.max(8, hp * 100)}%` }} />
            <div className="mp h-[2px] bg-blue-500" style={{ width: `${Math.max(8, mp * 55)}%` }} />
          </div>
          <div className="kda text-2xs font-bold text-white/45">{kda}</div>
        </div>
      )}

      {red && (
        <>
          <div className="portrait-container relative h-[34px] w-[34px] border border-white/15 bg-black">
            {icon ? <img src={icon} alt={name} className={`h-full w-full object-cover ${champion && (!champion.alive || banished) ? "grayscale opacity-55" : ""}`} /> : null}
            {champion && !champion.alive && respawnText && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/45 text-xs font-black text-amber-300">
                {respawnText}
              </div>
            )}
            {banished && (
              <div className="absolute inset-0 flex items-center justify-center bg-violet-900/55 text-2xs font-black text-violet-200">
                REALM
              </div>
            )}
            <div className="lvl absolute -bottom-[2px] -left-[2px] flex h-[12px] w-[12px] items-center justify-center border border-orange-400 bg-black text-2xs font-black">
              {level}
            </div>
          </div>
          <div className="spells flex flex-col gap-[1px]">
            <Slot className="spell h-[12px] w-[12px]" spellKey={firstSummoner?.key} cooldownText={firstSummonerCd} />
            <Slot className="spell h-[12px] w-[12px]" spellKey={secondSummoner?.key} cooldownText={secondSummonerCd} />
          </div>
          <Slot className="respawn h-[22px] w-[22px]" iconUrl={ultimateIcon} cooldownText={ultimateCd} goldBorder />
          <div className="items-group flex gap-[2px]">
            {Array.from({ length: 6 }).map((_, idx) => (
              <Slot
                // eslint-disable-next-line react/no-array-index-key
                key={`red-item-${idx}`}
                itemKey={idx < boughtItems ? itemKeys[idx] : undefined}
                className={`item h-[18px] w-[18px] ${idx < boughtItems ? "border-emerald-300/90 bg-emerald-400/35" : ""}`}
              />
            ))}
            <Slot className="trinket h-[18px] w-[18px]" trinket iconUrl={trinketIcon ?? undefined} cooldownText={trinketCd} />
          </div>
        </>
      )}
    </div>
  );
}

export function LecLowerThirdPanel({ champions, championByPlayerId, timeSec = 0 }: LecLowerThirdProps) {
  const blueByRole = sortByRole(champions.filter((c) => c.team === "blue"));
  const redByRole = sortByRole(champions.filter((c) => c.team === "red"));

  const matchups = ROLE_ORDER.map((role) => {
    const blue = blueByRole.find((c) => c.role === role);
    const red = redByRole.find((c) => c.role === role);
    return { role, blue, red };
  });

  return (
    <div className="hud-board mx-auto w-full max-w-[1400px] px-[20px] py-[10px] h-full flex flex-col justify-center">
      {matchups.map(({ role, blue, red }) => {
        const blueGold = championTotalGold(blue);
        const redGold = championTotalGold(red);
        const diff = Math.abs(blueGold - redGold);
        const diffLabel = diff >= 1000 ? `${(diff / 1000).toFixed(1)}K` : `${diff}`;
        const toBlue = blueGold >= redGold;

        return (
          <div key={role} className="player-row flex h-[42px] bg-navy-950 border border-white/[0.05]">
            <SidePane champion={blue} team="blue" championByPlayerId={championByPlayerId} timeSec={timeSec} />

            <div className="gold-indicator flex w-[80px] items-center justify-center border-x border-white/[0.05] bg-[#080808]">
              <span className={`arrow to-blue mr-[6px] text-xs ${toBlue ? "text-cyan-300 drop-shadow-[0_0_3px_rgba(34,211,238,1)]" : "text-transparent"}`}>◀</span>
              <span className="gold-value text-xs font-black text-white">{diffLabel}</span>
              <span className={`arrow to-red ml-[6px] text-xs ${!toBlue ? "text-orange-400 drop-shadow-[0_0_3px_rgba(249,115,22,1)]" : "text-transparent"}`}>▶</span>
            </div>

            <SidePane champion={red} team="red" championByPlayerId={championByPlayerId} timeSec={timeSec} />
          </div>
        );
      })}
    </div>
  );
}
