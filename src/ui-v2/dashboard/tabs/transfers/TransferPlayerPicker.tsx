import { useTranslation } from "react-i18next";

import type { PlayerData } from "@/store/gameStore";
import { calcAge, formatVal } from "@/lib/common/helpers";
import { getLolRoleForPlayer } from "@/lib/squad/helpers";
import { Badge } from "@/ui-v2/components/ui/badge";
import { cn } from "@/ui-v2/lib/utils";
import { FIELD_LABEL_CLASS } from "@/ui-v2/pages/playerProfile/modalFieldStyles";

const MAX_INCLUDED_PLAYERS = 2;

export function roleLabel(player: PlayerData): string {
  const role = getLolRoleForPlayer(player);
  return role === "JUNGLE" ? "JG" : role;
}

interface TransferPlayerPickerProps {
  userPlayers: PlayerData[];
  selectedPlayerIds: string[];
  onSelectedPlayersChange: (ids: string[]) => void;
  currentDate: string;
}

/** Lets the manager include up to two of their own players in a transfer deal. */
export default function TransferPlayerPicker({
  userPlayers,
  selectedPlayerIds,
  onSelectedPlayersChange,
  currentDate,
}: TransferPlayerPickerProps) {
  const { t } = useTranslation();

  const togglePlayer = (playerId: string) => {
    if (selectedPlayerIds.includes(playerId)) {
      onSelectedPlayersChange(selectedPlayerIds.filter((id) => id !== playerId));
    } else if (selectedPlayerIds.length < MAX_INCLUDED_PLAYERS) {
      onSelectedPlayersChange([...selectedPlayerIds, playerId]);
    }
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className={cn(FIELD_LABEL_CLASS, "mb-0")}>{t("transfers.includePlayers")}</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {selectedPlayerIds.length}/{MAX_INCLUDED_PLAYERS} {t("transfers.playersSelected")}
        </span>
      </div>
      <div className="scrollbar-v2 max-h-48 space-y-1 overflow-y-auto">
        {userPlayers.map((player) => {
          const isSelected = selectedPlayerIds.includes(player.id);
          return (
            <button
              key={player.id}
              type="button"
              aria-pressed={isSelected}
              disabled={!isSelected && selectedPlayerIds.length >= MAX_INCLUDED_PLAYERS}
              onClick={() => togglePlayer(player.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-xs transition-colors disabled:opacity-40",
                isSelected
                  ? "border-primary/50 bg-primary/15"
                  : "border-transparent bg-muted hover:border-border",
              )}
            >
              <Badge variant="secondary" className="text-2xs">
                {roleLabel(player)}
              </Badge>
              <span className="flex-1 truncate text-left text-foreground">
                {player.match_name || player.full_name}
              </span>
              <span className="text-muted-foreground">{calcAge(player.date_of_birth, currentDate)}yo</span>
              <span className="font-semibold tabular-nums text-foreground/80">
                {formatVal(player.market_value)}
              </span>
            </button>
          );
        })}
        {userPlayers.length === 0 ? (
          <p className="py-2 text-center text-xs text-muted-foreground">
            {t("transfers.noPlayersAvailable")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
