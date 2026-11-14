import { Star } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { championDisplayName } from "@/lib/champions/championNames";
import { initialsOf } from "@/lib/match/live/championMarker";
import { compactGold } from "@/lib/match/live/formatNumbers";
import type { PlayerRow, Scoreboard, Side, TeamTotals } from "@/lib/match/live/postGame";
import type { TeamIdentity } from "@/lib/match/live/teamIdentity";
import { STRUCTURE_ICON_PATH, NEUTRAL_OBJECTIVE_ICON_PATH } from "@/lib/match/lolMapLayout";
import { IconTip } from "@/ui-v2/components/ui/icon-tip";
import { itemDisplayName, summonerSpellName, type ItemNamesByKey } from "@/ui-v2/_legacy/components/match/itemNames";

import { SideCrest } from "../live/SideCrest";
import { Portrait } from "./Portrait";
import { itemIcon, spellIcon } from "./postGameIcons";
import "./postGame.css";
import { NAME_LANG } from "@/ui-v2/match/NameText";

/** The engine's role ids, mapped to the role names every screen already translates. */
const ROLE_KEYS: Readonly<Record<string, string>> = {
  TOP: "onAir.roles.TOP",
  JGL: "onAir.roles.JUNGLE",
  MID: "onAir.roles.MID",
  ADC: "onAir.roles.ADC",
  SUP: "onAir.roles.SUPPORT",
};

/** Which columns have anything to show: what the engine (or the simulation) did not send is left out. */
interface Columns {
  level: boolean;
  cs: boolean;
  damage: boolean;
  gear: boolean;
  spells: boolean;
}

export interface PostGameScoreboardProps {
  board: Scoreboard;
  blue: TeamIdentity;
  red: TeamIdentity;
  /** Key of the champion each player picked, by player id. */
  championByPlayerId: Record<string, string>;
  /** Names from the item catalogue, once loaded. Before that the humanised key stands in. */
  itemNames: ItemNamesByKey | null;
}

/** An icon from /public that falls back to the name's initials when it does not load. */
function IconSlot({ src, name, shape }: { src: string | null; name: string; shape: "item" | "trinket" | "spell" }) {
  const [failed, setFailed] = useState(false);
  return (
    <IconTip className="pg-icon" data-shape={shape} data-filled="true" label={name}>
      {src && !failed ? <img src={src} alt="" draggable={false} onError={() => setFailed(true)} /> : <span aria-hidden="true">{initialsOf(name)}</span>}
    </IconTip>
  );
}

function PlayerLine({ row, columns, maxDamage, championByPlayerId, itemNames }: {
  row: PlayerRow;
  columns: Columns;
  maxDamage: number;
  championByPlayerId: Record<string, string>;
  itemNames: ItemNamesByKey | null;
}) {
  const { t, i18n } = useTranslation();
  const key = championByPlayerId[row.id];
  const champion = key ? championDisplayName(key) : null;
  const role = ROLE_KEYS[row.role] ? t(ROLE_KEYS[row.role]) : row.role;
  const itemNamesList = (row.items ?? []).map((item) => itemDisplayName(item, itemNames));
  const trinketName = row.trinket ? itemDisplayName(row.trinket, itemNames) : null;
  const itemsLabel = [itemNamesList.length > 0 ? t("onAir.match.card.descItems", { items: itemNamesList.join(", ") }) : t("onAir.match.card.descNoItems"), trinketName]
    .filter(Boolean)
    .join(". ");
  return (
    <tr className="pg-row" data-team={row.side} data-mvp={row.mvp || undefined}>
      <th scope="row" className="pg-player">
        <span className="pg-player-cell">
          <Portrait side={row.side} championKey={key} name={row.name} />
          <span className="pg-player-text">
            <b lang={NAME_LANG}>{row.name}</b>
            <small>{champion ? `${champion}, ${role}` : role}</small>
          </span>
          {row.mvp ? (
            <span className="pg-mvp">
              <Star aria-hidden="true" focusable="false" />
              {t("match.draftResult.mvp")}
            </span>
          ) : null}
        </span>
      </th>
      {columns.level ? <td className="pg-num">{row.level ?? "-"}</td> : null}
      <td className="pg-num">{`${row.kills}/${row.deaths}/${row.assists}`}</td>
      {columns.cs ? <td className="pg-num">{row.cs ?? "-"}</td> : null}
      <td className="pg-num">{compactGold(row.gold, i18n.language)}</td>
      {columns.damage ? (
        <td className="pg-dmg">
          <b>{compactGold(row.damage ?? 0, i18n.language)}</b>
          <span className="pg-bar" aria-hidden="true">
            <i style={{ width: `${Math.round(((row.damage ?? 0) / maxDamage) * 100)}%` }} />
          </span>
        </td>
      ) : null}
      {columns.gear ? (
      <td>
        <span className="pg-items" role="group" aria-label={itemsLabel}>
          {Array.from({ length: 6 }, (_, slot) =>
            row.items?.[slot] ? (
              <IconSlot key={`${slot}-${row.items[slot]}`} src={itemIcon(row.items[slot])} name={itemNamesList[slot]} shape="item" />
            ) : (
              <span key={`empty-${slot}`} className="pg-icon" data-shape="item" aria-hidden="true" />
            ),
          )}
          {row.trinket && trinketName ? <IconSlot src={itemIcon(row.trinket)} name={trinketName} shape="trinket" /> : null}
        </span>
      </td>
      ) : null}
      {columns.spells ? (
      <td>
        <span className="pg-spells" role="group" aria-label={row.spells.map(summonerSpellName).join(", ")}>
          {row.spells.map((spell) => (
            <IconSlot key={spell} src={spellIcon(spell)} name={summonerSpellName(spell)} shape="spell" />
          ))}
        </span>
      </td>
      ) : null}
    </tr>
  );
}

function Objectives({ totals }: { totals: TeamTotals }) {
  const { t } = useTranslation();
  const chips: Array<{ id: string; icon: string; label: string; count: number }> = [
    { id: "towers", icon: STRUCTURE_ICON_PATH[`tower_${totals.side}`], label: t("match.statTowers"), count: totals.towers },
    { id: "dragons", icon: NEUTRAL_OBJECTIVE_ICON_PATH.dragon, label: t("match.statDragons"), count: totals.dragons },
    { id: "grubs", icon: NEUTRAL_OBJECTIVE_ICON_PATH.grub, label: t("onAir.match.pit.voidgrubs"), count: totals.grubs },
  ];
  // The herald count is only known for a match watched whole; for a skipped one it is left out, not shown as 0.
  if (totals.heralds !== null) chips.push({ id: "heralds", icon: NEUTRAL_OBJECTIVE_ICON_PATH.riftherald, label: t("match.draftResult.timelineEvents.herald"), count: totals.heralds });
  chips.push({ id: "barons", icon: NEUTRAL_OBJECTIVE_ICON_PATH.baron, label: t("match.statBarons"), count: totals.barons });
  return (
    <span className="pg-objs">
      {chips.map((chip) => (
        <span key={chip.id} className="pg-obj" role="img" aria-label={`${chip.label}: ${chip.count}`} data-testid={`objective-${chip.id}`}>
          <img src={chip.icon} alt="" draggable={false} />
          {chip.count}
        </span>
      ))}
    </span>
  );
}

function TeamTable({ side, identity, board, columns, maxDamage, championByPlayerId, itemNames }: {
  side: Side;
  identity: TeamIdentity;
  board: Scoreboard;
  columns: Columns;
  maxDamage: number;
  championByPlayerId: Record<string, string>;
  itemNames: ItemNamesByKey | null;
}) {
  const { t, i18n } = useTranslation();
  const totals = board.totals[side];
  const rows = board.rows[side];
  const trailing = Number(columns.gear) + Number(columns.spells);
  const columnCount = 3 + Number(columns.level) + Number(columns.cs) + Number(columns.damage) + trailing;
  return (
    <table className="pg-table" data-team={side} aria-label={t("onAir.match.team.players", { team: identity.name })}>
      <colgroup>
        {/* The same widths for both teams, so the two tables read as one grid. */}
        <col data-col="player" />
        {columns.level ? <col data-col="level" /> : null}
        <col data-col="kda" />
        {columns.cs ? <col data-col="cs" /> : null}
        <col data-col="gold" />
        {columns.damage ? <col data-col="damage" /> : null}
        {columns.gear ? <col data-col="gear" /> : null}
        {columns.spells ? <col data-col="spells" /> : null}
      </colgroup>
      <thead>
        <tr className="pg-head">
          <th scope="col" className="pg-team">
            <SideCrest side={side} identity={identity} size="1.75rem" />
            <b lang={NAME_LANG}>{identity.tag}</b>
            <span lang={NAME_LANG}>{identity.name}</span>
            {board.winner ? (
              <span className="pg-result" data-result={totals.won ? "win" : "loss"}>
                {totals.won ? t("match.victory") : t("match.defeat")}
              </span>
            ) : null}
          </th>
          {columns.level ? <th scope="col">{t("onAir.match.post.columnLevel")}</th> : null}
          <th scope="col">{t("championPage.kda")}</th>
          {columns.cs ? <th scope="col">{t("championPage.cs")}</th> : null}
          <th scope="col">{t("match.statGold")}</th>
          {columns.damage ? <th scope="col">{t("match.draftResult.columns.damage")}</th> : null}
          {columns.gear ? <th scope="col">{t("onAir.match.post.columnItems")}</th> : null}
          {columns.spells ? <th scope="col">{t("onAir.match.post.columnSpells")}</th> : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <PlayerLine key={row.id} row={row} columns={columns} maxDamage={maxDamage} championByPlayerId={championByPlayerId} itemNames={itemNames} />
        ))}
      </tbody>
      <tfoot>
        <tr className="pg-total">
          <th scope="row">{t("onAir.match.post.teamTotal")}</th>
          {columns.level ? <td /> : null}
          <td className="pg-num">{`${totals.kills}/${totals.deaths}/${totals.assists}`}</td>
          {columns.cs ? <td className="pg-num">{totals.cs ?? "-"}</td> : null}
          <td className="pg-num">{compactGold(totals.gold, i18n.language)}</td>
          {columns.damage ? <td className="pg-num">{compactGold(totals.damage ?? 0, i18n.language)}</td> : null}
          {trailing > 0 ? (
            <td colSpan={trailing}>
              <Objectives totals={totals} />
            </td>
          ) : null}
        </tr>
        {/* With no items or spells column there is no cell beside the totals to hold them: they get a row. */}
        {trailing === 0 ? (
          <tr className="pg-total pg-total-objs">
            <td colSpan={columnCount}>
              <Objectives totals={totals} />
            </td>
          </tr>
        ) : null}
      </tfoot>
    </table>
  );
}

/**
 * Both teams' players, one table each: portrait, name and role, level, K/D/A, CS, gold earned,
 * damage to champions, the six items and the trinket, and the two summoner spells; the team's
 * totals and objectives under them. The damage column is left out when the engine did not send
 * damage for every player, and the herald count when the match's events are not all known.
 */
export function PostGameScoreboard({ board, blue, red, championByPlayerId, itemNames }: PostGameScoreboardProps) {
  const everyone = [...board.rows.blue, ...board.rows.red];
  const columns: Columns = {
    level: everyone.some((row) => row.level !== null),
    cs: everyone.some((row) => row.cs !== null),
    damage: everyone.length > 0 && everyone.every((row) => row.damage !== null),
    gear: everyone.some((row) => row.items !== null),
    spells: everyone.some((row) => row.spells.length > 0),
  };
  const maxDamage = Math.max(1, ...everyone.map((row) => row.damage ?? 0));
  return (
    <div className="pg-scoreboard" data-testid="post-game-scoreboard">
      <TeamTable side="blue" identity={blue} board={board} columns={columns} maxDamage={maxDamage} championByPlayerId={championByPlayerId} itemNames={itemNames} />
      <TeamTable side="red" identity={red} board={board} columns={columns} maxDamage={maxDamage} championByPlayerId={championByPlayerId} itemNames={itemNames} />
    </div>
  );
}
