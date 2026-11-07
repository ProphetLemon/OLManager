import { useState } from "react";
import { parseUtcDate } from "@/lib/formatting/dateFormatting";
import type { GameStateData, PlayerData } from "@/store/gameStore";
import {
  makeTransferBid,
  negotiatePlayerWage,
  previewTransferBidFinancialImpact,
  releasePlayerContract,
  type TransferBidProjectionData,
  type TransferDestinationData,
  type TransferNegotiationFeedbackData,
  type WageNegotiationResponseData,
} from "@/services/transfersService";

type TranslateFn = (key: string, options?: Record<string, string | number>) => string;

export interface TransferOfferFeedbackState {
  decision: "accepted" | "rejected" | "counter_offer";
  feedback: TransferNegotiationFeedbackData;
}

export interface WageNegotiationTarget {
  player: PlayerData;
  offerId: string;
  fromTeamId: string | null;
  fee: number;
  destinationTeamId: string;
}

interface UsePlayerTransferOptions {
  player: PlayerData;
  currentDate: string;
  isOwnClub: boolean;
  isTransferWindowOpen: boolean;
  onGameUpdate?: (state: GameStateData) => void;
  onClose: () => void;
  t: TranslateFn;
}

function errorMessage(error: unknown): string {
  return typeof error === "string" ? error : error instanceof Error ? error.message : String(error);
}

export function computeReleasePenalty(
  player: Pick<PlayerData, "contract_end" | "wage">,
  currentDateRaw: string,
): number {
  if (!player.contract_end) return 0;

  const currentDate = parseUtcDate(currentDateRaw);
  const contractEndDate = parseUtcDate(player.contract_end);
  if (!currentDate || !contractEndDate) return 0;

  const msPerDay = 24 * 60 * 60 * 1000;
  const daysRemaining = Math.max(
    0,
    Math.ceil((contractEndDate.getTime() - currentDate.getTime()) / msPerDay),
  );
  const remainingSalary = Math.round((player.wage * daysRemaining) / 365);
  return Math.round(remainingSalary * 0.4);
}

export function usePlayerTransfer({
  player,
  currentDate,
  isOwnClub,
  isTransferWindowOpen,
  onGameUpdate,
  onClose,
  t,
}: UsePlayerTransferOptions) {
  const [transferActionSubmitting, setTransferActionSubmitting] = useState(false);

  const [showReleaseContractModal, setShowReleaseContractModal] = useState(false);
  const [releaseContractError, setReleaseContractError] = useState<string | null>(null);

  const [showTransferOfferModal, setShowTransferOfferModal] = useState(false);
  const [transferOfferAmount, setTransferOfferAmount] = useState("");
  const [transferOfferDestination, setTransferOfferDestination] =
    useState<TransferDestinationData>("main");
  const [transferOfferError, setTransferOfferError] = useState<string | null>(null);
  const [transferOfferFeedback, setTransferOfferFeedback] =
    useState<TransferOfferFeedbackState | null>(null);
  const [transferOfferIncludedPlayerIds, setTransferOfferIncludedPlayerIds] = useState<string[]>([]);
  const [transferOfferProjection, setTransferOfferProjection] =
    useState<TransferBidProjectionData["projection"] | null>(null);
  const [transferOfferFee, setTransferOfferFee] = useState<number | null>(null);

  const [showWageModal, setShowWageModal] = useState(false);
  const [wageNegotiationTarget, setWageNegotiationTarget] = useState<WageNegotiationTarget | null>(null);
  const [wageNegotiationAmount, setWageNegotiationAmount] = useState("");
  const [wageNegotiationYears, setWageNegotiationYears] = useState(3);
  const [wageNegotiationLoading, setWageNegotiationLoading] = useState(false);
  const [wageNegotiationResult, setWageNegotiationResult] =
    useState<WageNegotiationResponseData["decision"] | "error" | null>(null);
  const [wageNegotiationFeedback, setWageNegotiationFeedback] =
    useState<TransferNegotiationFeedbackData | null>(null);
  const [wageNegotiationError, setWageNegotiationError] = useState<string | null>(null);

  const releasePenaltyPreview = computeReleasePenalty(player, currentDate);

  function handleRequestReleaseContract(): void {
    if (!isTransferWindowOpen || !isOwnClub || transferActionSubmitting) return;
    setShowReleaseContractModal(true);
  }

  function cancelReleaseContract(): void {
    setShowReleaseContractModal(false);
    setReleaseContractError(null);
  }

  async function handleConfirmReleaseContract(): Promise<void> {
    if (!onGameUpdate || !isOwnClub || transferActionSubmitting) return;

    setTransferActionSubmitting(true);
    setReleaseContractError(null);
    try {
      const updated = await releasePlayerContract(player.id);
      onGameUpdate(updated);
      setShowReleaseContractModal(false);
      onClose();
    } catch (error) {
      setReleaseContractError(errorMessage(error));
    } finally {
      setTransferActionSubmitting(false);
    }
  }

  function loadBidProjection(fee: number, destination: TransferDestinationData): void {
    void previewTransferBidFinancialImpact(player.id, fee, destination)
      .then((res) => {
        setTransferOfferProjection(res.projection);
        setTransferOfferFee(fee);
      })
      .catch(() => {});
  }

  function handleOpenTransferOfferModal(): void {
    if (!onGameUpdate || isOwnClub || transferActionSubmitting || !isTransferWindowOpen) return;

    const initialFee = Math.max(1, Math.round(player.market_value));
    setTransferOfferAmount(String(initialFee));
    setTransferOfferDestination("main");
    setTransferOfferError(null);
    setTransferOfferFeedback(null);
    setTransferOfferIncludedPlayerIds([]);
    setTransferOfferProjection(null);
    setTransferOfferFee(null);
    setShowTransferOfferModal(true);
    loadBidProjection(initialFee, "main");
  }

  function handleTransferOfferAmountChange(value: string): void {
    setTransferOfferAmount(value);
    const fee = Math.round(Number.parseFloat(value));
    if (Number.isFinite(fee) && fee > 0) loadBidProjection(fee, transferOfferDestination);
  }

  function closeTransferOfferModal(): void {
    setShowTransferOfferModal(false);
  }

  async function handleSubmitTransferOffer(): Promise<void> {
    if (!onGameUpdate || isOwnClub || transferActionSubmitting) return;

    const fee = Math.round(Number.parseFloat(transferOfferAmount));
    if (!Number.isFinite(fee) || fee <= 0) {
      setTransferOfferError(
        t("playerProfile.transferOfferInvalid", {
          defaultValue: "Ingresá un monto de oferta valido.",
        }),
      );
      return;
    }

    setTransferOfferError(null);
    setTransferOfferFeedback(null);
    setTransferActionSubmitting(true);
    try {
      const result = await makeTransferBid(
        player.id,
        fee,
        transferOfferDestination,
        transferOfferIncludedPlayerIds,
      );
      onGameUpdate(result.game);
      setTransferOfferFeedback({ decision: result.decision, feedback: result.feedback });

      if (result.suggested_fee !== null) {
        setTransferOfferAmount(String(Math.round(result.suggested_fee)));
      }

      if (result.decision === "accepted" && !result.is_terminal) {
        const updatedPlayer = result.game.players.find((p: PlayerData) => p.id === player.id);
        const acceptedOffer = updatedPlayer?.transfer_offers.find(
          (o) => o.status === "Accepted" && o.destination_team_id,
        );
        if (updatedPlayer && acceptedOffer && acceptedOffer.destination_team_id) {
          setWageNegotiationTarget({
            player: updatedPlayer,
            offerId: acceptedOffer.id,
            fromTeamId: updatedPlayer.team_id ?? null,
            fee,
            destinationTeamId: acceptedOffer.destination_team_id,
          });
          setWageNegotiationAmount(String(Math.round(updatedPlayer.wage * 1.5)));
          setWageNegotiationYears(acceptedOffer.suggested_counter_years ?? 3);
          setWageNegotiationResult(null);
          setWageNegotiationFeedback(null);
          setWageNegotiationError(null);
          setShowWageModal(true);
        }
        setShowTransferOfferModal(false);
        setTransferOfferIncludedPlayerIds([]);
      } else if (result.decision === "accepted") {
        setShowTransferOfferModal(false);
        setTransferOfferIncludedPlayerIds([]);
      }
    } catch (error) {
      console.error("Failed to make transfer offer:", error);
      const rawError = errorMessage(error);

      if (rawError.includes("Transfer budget too low")) {
        setTransferOfferError(
          t("playerProfile.transferOfferBudgetError", {
            defaultValue: "Tu presupuesto de fichajes no alcanza para este monto.",
          }),
        );
      } else if (rawError.includes("Insufficient funds")) {
        setTransferOfferError(
          t("playerProfile.transferOfferFundsError", {
            defaultValue: "No tenes fondos suficientes para esta oferta.",
          }),
        );
      } else if (rawError.includes("Transfer window is closed")) {
        setTransferOfferError(
          t("playerProfile.transferOfferWindowClosed", {
            defaultValue: "El mercado esta cerrado.",
          }),
        );
      } else {
        setTransferOfferError(
          t("playerProfile.transferOfferFailed", {
            defaultValue: "No se pudo enviar la oferta. Probá de nuevo.",
          }),
        );
      }
    } finally {
      setTransferActionSubmitting(false);
    }
  }

  function resetWageNegotiation(): void {
    setShowWageModal(false);
    setWageNegotiationTarget(null);
    setWageNegotiationAmount("");
    setWageNegotiationResult(null);
    setWageNegotiationFeedback(null);
    setWageNegotiationError(null);
  }

  async function handleWageNegotiation(): Promise<void> {
    if (!wageNegotiationTarget || !wageNegotiationAmount) return;

    setWageNegotiationLoading(true);
    setWageNegotiationError(null);
    setWageNegotiationResult(null);
    setWageNegotiationFeedback(null);

    try {
      const annualWage = Math.round(parseFloat(wageNegotiationAmount));
      const result = await negotiatePlayerWage(
        wageNegotiationTarget.player.id,
        wageNegotiationTarget.offerId,
        annualWage,
        wageNegotiationYears,
      );
      onGameUpdate?.(result.game);
      setWageNegotiationResult(result.decision);
      setWageNegotiationFeedback(result.feedback);
      if (result.suggested_wage !== null) {
        setWageNegotiationAmount(String(Math.round(result.suggested_wage)));
      }
      if (result.is_terminal && result.decision === "accepted") {
        setTimeout(resetWageNegotiation, 2000);
      }
    } catch (error) {
      console.error("Failed to negotiate wage:", error);
      setWageNegotiationError(errorMessage(error));
    } finally {
      setWageNegotiationLoading(false);
    }
  }

  return {
    transferActionSubmitting,
    releasePenaltyPreview,
    showReleaseContractModal,
    releaseContractError,
    handleRequestReleaseContract,
    cancelReleaseContract,
    handleConfirmReleaseContract,
    showTransferOfferModal,
    transferOfferAmount,
    transferOfferDestination,
    transferOfferError,
    transferOfferFeedback,
    transferOfferProjection,
    transferOfferFee,
    setTransferOfferDestination,
    handleOpenTransferOfferModal,
    handleTransferOfferAmountChange,
    closeTransferOfferModal,
    handleSubmitTransferOffer,
    showWageModal,
    wageNegotiationTarget,
    wageNegotiationAmount,
    wageNegotiationYears,
    wageNegotiationLoading,
    wageNegotiationResult,
    wageNegotiationFeedback,
    wageNegotiationError,
    setWageNegotiationAmount,
    setWageNegotiationYears,
    handleWageNegotiation,
    resetWageNegotiation,
  };
}
