import type { TFunction } from "i18next";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { formatCountdown } from "@/lib/match/live/clock";
import type { DragonKind } from "@/lib/match/live/liveEvents";
import { MAP_UNITS, anchorTransform, type TeamSide } from "@/lib/match/live/mapGeometry";
import { pitViews, type PitEntity, type PitView, type SoulView } from "@/lib/match/live/objectivesView";
import { NEUTRAL_OBJECTIVE_ICON_PATH } from "@/lib/match/lolMapLayout";
import type { LolSimV1RuntimeState } from "@/ui-v2/_legacy/components/match/lol-prototype/backend/contract-v1";

import { useMapSize } from "./arenaMapContext";

/** Names that already exist for the match screens are reused; the rest live under onAir.match.pit. */
const ENTITY_NAME_KEYS: Readonly<Record<Exclude<PitEntity, "dragon">, string>> = {
  elder: "match.draftResult.timelineEvents.elder",
  voidgrubs: "onAir.match.pit.voidgrubs",
  herald: "match.draftResult.timelineEvents.herald",
  baron: "match.draftResult.timelineEvents.baron",
};

const DRAGON_NAME_KEYS: Readonly<Record<DragonKind, string>> = {
  infernal: "onAir.match.pit.dragonInfernal",
  ocean: "onAir.match.pit.dragonOcean",
  mountain: "onAir.match.pit.dragonMountain",
  cloud: "onAir.match.pit.dragonCloud",
  hextech: "onAir.match.pit.dragonHextech",
  chemtech: "onAir.match.pit.dragonChemtech",
};
const DRAGON_PLAIN_KEY = "match.draftResult.timelineEvents.dragon";

const TEAM_KEYS: Readonly<Record<TeamSide, string>> = {
  blue: "onAir.match.team.blue",
  red: "onAir.match.team.red",
};

const ICON: Readonly<Record<Exclude<PitEntity, "dragon">, string>> = {
  elder: NEUTRAL_OBJECTIVE_ICON_PATH.dragon_elder,
  voidgrubs: NEUTRAL_OBJECTIVE_ICON_PATH.grub,
  herald: NEUTRAL_OBJECTIVE_ICON_PATH.riftherald,
  baron: NEUTRAL_OBJECTIVE_ICON_PATH.baron,
};

function iconOf(view: PitView): string {
  if (view.entity !== "dragon") return ICON[view.entity];
  return view.dragonKind ? NEUTRAL_OBJECTIVE_ICON_PATH[`dragon_${view.dragonKind}`] : NEUTRAL_OBJECTIVE_ICON_PATH.dragon;
}

function nameOf(view: PitView, t: TFunction): string {
  if (view.entity !== "dragon") return t(ENTITY_NAME_KEYS[view.entity]);
  return t(view.dragonKind ? DRAGON_NAME_KEYS[view.dragonKind] : DRAGON_PLAIN_KEY);
}

function valueOf(view: PitView, t: TFunction): string {
  switch (view.status.state) {
    case "alive":
      return view.status.hpPct === null
        ? t("onAir.match.pit.upNoPercent")
        : t("onAir.match.pit.up", { percent: view.status.hpPct });
    case "countdown":
      return formatCountdown(view.status.seconds);
    case "none":
      return "";
  }
}

function soulLine(soul: SoulView | null, t: TFunction): string {
  if (!soul) return "";
  return soul.state === "claimed"
    ? t("onAir.match.pit.soulClaimed", { team: t(TEAM_KEYS[soul.side]) })
    : t("onAir.match.pit.soulOpen");
}

function Pit({ view, carrier, sizePx }: { view: PitView; carrier: string; sizePx: number }) {
  const { t } = useTranslation();
  const status = view.status;
  const value = valueOf(view, t);
  const soul = soulLine(view.soul, t);
  return (
    <div
      className="arena-pit"
      style={{ transform: anchorTransform({ x: view.pos.x / MAP_UNITS, y: view.pos.y / MAP_UNITS }, sizePx) }}
      data-testid={`pit-${view.id}`}
      data-entity={view.entity}
      data-status={status.state}
    >
      <span className="arena-pit-glyph">
        <span className="arena-pit-glyph-in">
          <img src={iconOf(view)} alt="" draggable={false} />
        </span>
      </span>
      <div className="arena-pit-label">
        <b className="arena-pit-name">{nameOf(view, t)}</b>
        {value ? <span className="arena-pit-value">{value}</span> : null}
        {status.state === "alive" && status.hpPct !== null ? (
          <span className="arena-pit-hp" data-testid="pit-hp">
            <i style={{ width: `${status.hpPct}%` }} />
          </span>
        ) : null}
        {soul ? (
          <span className="arena-pit-note" data-testid="pit-soul">
            {soul}
          </span>
        ) : null}
        {carrier ? (
          <span className="arena-pit-note" data-testid="pit-carrier">
            {carrier}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export interface PitMarkersProps {
  /** The state of the last engine answer. The countdowns tick with its commits. */
  state: LolSimV1RuntimeState;
}

/**
 * The dragon pit and the top pit. While something is up the pit shows its health percent and a
 * bar; otherwise the time until the next spawn. Elder replaces the dragon once it is unlocked,
 * and the dragon pit says who holds or is about to claim the soul. The top pit also says who
 * carries the Herald. State is carried by text and by a solid or dashed outline, not by colour.
 * Hidden from assistive technology like the rest of the map: the Fight board says it in words.
 */
export function PitMarkers({ state }: PitMarkersProps) {
  const { t } = useTranslation();
  const sizePx = useMapSize();
  const views = useMemo(() => pitViews(state), [state]);

  const carrierLine = (view: PitView): string => {
    const carrier = view.heraldCarrier;
    if (!carrier) return "";
    const named = carrier.championId ? state.champions.find((champion) => champion.id === carrier.championId) : undefined;
    return t("onAir.match.pit.heraldCarrier", { who: named?.name ?? t(TEAM_KEYS[carrier.side]) });
  };

  return (
    <div className="arena-pits" aria-hidden="true" data-testid="pit-markers">
      {views.map((view) => (
        <Pit key={view.id} view={view} carrier={carrierLine(view)} sizePx={sizePx} />
      ))}
    </div>
  );
}
