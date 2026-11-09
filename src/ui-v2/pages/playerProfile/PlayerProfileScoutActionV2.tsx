import { ScanSearch } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PlayerProfileScoutStatus, ScoutAvailability } from "@/lib/playerProfile/scouting";
import { Button } from "@/ui-v2/components/ui/button";

interface PlayerProfileScoutActionV2Props {
  availability: ScoutAvailability;
  scoutStatus: PlayerProfileScoutStatus;
  scoutError: string | null;
  onScout: () => void;
}

export default function PlayerProfileScoutActionV2({
  availability,
  scoutStatus,
  scoutError,
  onScout,
}: PlayerProfileScoutActionV2Props) {
  const { t } = useTranslation();

  if (availability.scouts.length === 0) {
    return <p className="text-xs text-muted-foreground">{t("scouting.noScoutsHint")}</p>;
  }

  if (availability.alreadyScouting || scoutStatus === "sent") {
    return (
      <span className="flex items-center gap-1.5 font-heading text-xs font-bold uppercase tracking-wider text-primary">
        <ScanSearch className="size-3.5" /> {t("scouting.scoutingInProgress")}
      </span>
    );
  }

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        disabled={!availability.canScout || scoutStatus === "sending"}
        onClick={onScout}
        className="font-heading text-xs font-bold uppercase tracking-wider"
      >
        <ScanSearch />
        {scoutStatus === "sending" ? t("playerProfile.scoutSending") : t("scouting.scoutBtn")}
      </Button>
      {scoutError ? <p className="mt-1 text-xs text-destructive">{scoutError}</p> : null}
    </>
  );
}
