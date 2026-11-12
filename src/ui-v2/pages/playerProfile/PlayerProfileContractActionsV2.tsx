import { Button } from "@/ui-v2/components/ui/button";

type TranslateFn = (key: string, options?: Record<string, string | number>) => string;

interface PlayerProfileContractActionsV2Props {
  isOwnClub: boolean;
  isTransferWindowOpen: boolean;
  transferActionSubmitting: boolean;
  onOpenRenewal: () => void;
  onReleaseContract: () => void;
  onOpenTransferBid: () => void;
  t: TranslateFn;
}

/** Renew and release for your own players, a transfer offer for anyone else's; shown in the hero. */
export default function PlayerProfileContractActionsV2({
  isOwnClub,
  isTransferWindowOpen,
  transferActionSubmitting,
  onOpenRenewal,
  onReleaseContract,
  onOpenTransferBid,
  t,
}: PlayerProfileContractActionsV2Props) {
  if (isOwnClub) {
    return (
      <>
        <Button size="sm" variant="club" onClick={onOpenRenewal}>
          {t("common.renewContract")}
        </Button>
        {isTransferWindowOpen ? (
          <Button size="sm" variant="outline" onClick={onReleaseContract} disabled={transferActionSubmitting}>
            {t("playerProfile.releaseContract")}
          </Button>
        ) : null}
      </>
    );
  }
  if (!isTransferWindowOpen) return null;
  return (
    <Button size="sm" variant="club" onClick={onOpenTransferBid} disabled={transferActionSubmitting}>
      {t("playerProfile.makeTransferOffer")}
    </Button>
  );
}
