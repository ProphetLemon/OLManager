import { memo, useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { hpShare, initialsOf } from "@/lib/match/live/championMarker";
import { compactGold } from "@/lib/match/live/formatNumbers";
import {
  cardDescriptionParts,
  ITEM_SLOTS,
  totalGold,
  type CardChampion,
  type CooldownChip,
  type GoldGap,
} from "@/lib/match/live/playerCardView";
import { itemDisplayName, summonerSpellName, type ItemNamesByKey } from "@/ui-v2/_legacy/components/match/itemNames";

import { useMarkerTexts } from "./useMarkerTexts";
import "./liveMatch.css";

/** The engine's role ids, mapped to the role names every screen already translates. */
const ROLE_KEYS: Readonly<Record<string, string>> = {
  TOP: "onAir.roles.TOP",
  JGL: "onAir.roles.JUNGLE",
  MID: "onAir.roles.MID",
  ADC: "onAir.roles.ADC",
  SUP: "onAir.roles.SUPPORT",
};

export interface LivePlayerCardProps {
  champion: CardChampion;
  /** The champion of the other team in the same role, for the gold gap. */
  opponent?: CardChampion;
  /** Key of the champion this player picked, for the portrait. */
  championKey?: string;
  /** Display name of that champion, for the accessible name. */
  championName?: string;
  /** Game time of the last engine answer: the cooldowns and the dead seconds read it. */
  nowSec: number;
  fighting: boolean;
  selected: boolean;
  /** Names from the item catalogue, once loaded. Before that the humanised key stands in. */
  itemNames: ItemNamesByKey | null;
  onSelect: (id: string) => void;
}

function ItemSlot({ itemKey, name }: { itemKey: string; name: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="arena-item" title={name} data-testid="card-item">
      {failed ? (
        <span aria-hidden="true">{initialsOf(name)}</span>
      ) : (
        <img src={`/lol-item-icons/${itemKey}.png`} alt="" draggable={false} onError={() => setFailed(true)} />
      )}
    </span>
  );
}

/**
 * One player. A native button, so Enter and Space work and a screen reader hears a toggle:
 * pressing it follows this player on the map. The cards are the keyboard and screen-reader way
 * into the map, so the accessible name is short and everything else sits in a description
 * the button points at. No mana bar: the engine has no mana.
 *
 * Its height never depends on what the player owns: the six item slots and the cooldown strip
 * are always there (empty ones are dashed boxes), each row has a fixed height and nothing wraps,
 * so a purchase or a cooldown that starts cannot make the five cards outgrow their column.
 */
export const LivePlayerCard = memo(function LivePlayerCard({
  champion,
  opponent,
  championKey,
  championName,
  nowSec,
  fighting,
  selected,
  itemNames,
  onSelect,
}: LivePlayerCardProps) {
  const { t, i18n } = useTranslation();
  const markerTexts = useMarkerTexts();
  const descId = useId();
  const [failedTile, setFailedTile] = useState<string | null>(null);

  const parts = cardDescriptionParts(champion, opponent, fighting, nowSec);
  const gap = parts.gap;
  const gold = (amount: number) => compactGold(amount, i18n.language);
  const roleName = (role: string) => (ROLE_KEYS[role] ? t(ROLE_KEYS[role]) : role);
  const dead = !parts.alive;
  const hpPct = Math.round(hpShare(champion.hp, champion.maxHp, champion.alive) * 100);

  const stateText = parts.state.kind === "lane" ? t("onAir.match.card.stateLane") : markerTexts(parts.state).sub;
  const itemName = (key: string) => itemDisplayName(key, itemNames);
  const cooldownName = (chip: CooldownChip) => {
    if (chip.kind === "ultimate") return t("onAir.match.card.cdUltimate");
    if (chip.kind === "summoner") return summonerSpellName(chip.key ?? "");
    return itemName(chip.key ?? "");
  };
  const cooldownSentence = (chip: CooldownChip) =>
    chip.seconds > 0
      ? t("onAir.match.card.cdWait", { name: cooldownName(chip), count: chip.seconds })
      : t("onAir.match.card.cdReady", { name: cooldownName(chip) });

  const gapSentence = (g: GoldGap | null): string => {
    if (!g || !parts.opponentRole) return "";
    const role = roleName(parts.opponentRole);
    if (g.direction === "even") return t("onAir.match.card.descGapEven", { role });
    return g.direction === "ahead"
      ? t("onAir.match.card.descGapAhead", { amount: gold(g.amount), role })
      : t("onAir.match.card.descGapBehind", { amount: gold(g.amount), role });
  };

  const itemParts = parts.itemKeys.map(itemName);
  if (parts.itemKeys.length > 0 && parts.emptySlots > 0) {
    itemParts.push(t("onAir.match.card.descEmptySlots", { count: parts.emptySlots }));
  }
  const goldSentence = [t("onAir.match.card.descGold", { gold: gold(parts.totalGold) }), gapSentence(gap)]
    .filter(Boolean)
    .join(", ");
  const sentences = [
    t("onAir.match.card.descLevel", { level: parts.level }),
    dead
      ? t("onAir.match.card.descDead", { count: parts.respawnSec })
      : `${t("onAir.match.card.descHealth", { hp: parts.hp, max: parts.maxHp })}. ${stateText}`,
    t("onAir.match.card.descKda", { kills: parts.kills, deaths: parts.deaths, assists: parts.assists }),
    t("onAir.match.card.descCs", { count: parts.cs }),
    goldSentence,
    parts.itemKeys.length > 0
      ? t("onAir.match.card.descItems", { items: itemParts.join(", ") })
      : t("onAir.match.card.descNoItems"),
    parts.cooldowns.length > 0
      ? t("onAir.match.card.descCooldowns", { list: parts.cooldowns.map(cooldownSentence).join(", ") })
      : "",
  ];
  const description = `${sentences.filter(Boolean).join(". ")}.`;

  const role = roleName(champion.role);
  const label = championName
    ? t("onAir.match.card.label", { name: champion.name, champion: championName, role })
    : t("onAir.match.card.labelNoChampion", { name: champion.name, role });

  const showTile = Boolean(championKey) && failedTile !== championKey && !dead;
  const gapText =
    !gap || gap.direction === "even"
      ? gap
        ? t("onAir.match.card.gapEven")
        : ""
      : t(gap.direction === "ahead" ? "onAir.match.card.gapAhead" : "onAir.match.card.gapBehind", {
          amount: gold(gap.amount),
        });

  return (
    <button
      type="button"
      className="arena-card"
      data-team={champion.team}
      data-dead={dead || undefined}
      data-fighting={fighting || undefined}
      data-state={parts.state.kind}
      aria-pressed={selected}
      aria-label={label}
      aria-describedby={descId}
      onClick={() => onSelect(champion.id)}
    >
      <span id={descId} className="sr-only">
        {description}
      </span>
      <span className="arena-card-head">
        <span className="arena-card-face">
          {showTile ? (
            <img
              src={`/champion-tiles/${championKey}.webp`}
              alt=""
              draggable={false}
              onError={() => setFailedTile(championKey ?? null)}
            />
          ) : (
            <span data-testid={dead ? "card-respawn" : undefined}>{dead ? parts.respawnSec : initialsOf(champion.name)}</span>
          )}
        </span>
        <span className="arena-card-who">
          <span className="arena-card-name">{champion.name}</span>
          <span className="arena-card-meta">
            <span className="arena-chip-text">{role}</span>
            <span className="arena-chip-text">{t("onAir.match.card.level", { level: parts.level })}</span>
          </span>
        </span>
        <span className="arena-card-score">
          <span className="arena-card-kda">{`${parts.kills}/${parts.deaths}/${parts.assists}`}</span>
          <span className="arena-card-farm">
            {parts.cs} {t("championPage.cs")} {gold(totalGold(champion))}
          </span>
        </span>
      </span>
      <span className="arena-card-vitals">
        <span className="arena-card-hp">
          <i style={{ width: `${dead ? 0 : hpPct}%` }} />
        </span>
        <span className="arena-card-hptext">{dead ? "0" : `${parts.hp}/${parts.maxHp}`}</span>
        {gapText ? (
          <span className="arena-card-gap" data-direction={gap?.direction} data-testid="card-gap">
            {gapText}
          </span>
        ) : null}
        <span className="arena-card-state" data-testid="card-state">
          {stateText}
        </span>
      </span>
      <span className="arena-card-gear">
        <span className="arena-card-items">
          {Array.from({ length: ITEM_SLOTS }, (_, slot) => {
            const key = parts.itemKeys[slot];
            return key ? (
              <ItemSlot key={`${slot}-${key}`} itemKey={key} name={itemName(key)} />
            ) : (
              <span key={`empty-${slot}`} className="arena-item" data-empty title={t("onAir.match.card.itemEmpty")} />
            );
          })}
        </span>
        <span className="arena-card-cds">
          {parts.cooldowns.map((chip) => (
            <span
              key={`${chip.kind}-${chip.letter}`}
              className="arena-cd"
              data-ready={chip.seconds === 0 || undefined}
              title={cooldownSentence(chip)}
              data-testid="card-cd"
            >
              {chip.seconds > 0 ? `${chip.letter} ${chip.seconds}` : chip.letter}
            </span>
          ))}
        </span>
      </span>
    </button>
  );
});
