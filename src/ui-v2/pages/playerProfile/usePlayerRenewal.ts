import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { GameStateData, PlayerData } from "@/store/gameStore";
import { resolveBackendText } from "@/lib/i18n/backendI18n";
import { formatDelegatedNoteParams } from "@/lib/i18n/delegatedRenewalNotes";
import {
  type DelegatedRenewalCaseData,
  type DelegatedRenewalResponseData,
  type NegotiationFeedbackData,
  getRenewalStatusClassName,
  getRenewalStatusMessage,
  type RenewalProjectionData,
  type RenewalResponseData,
  type RenewalStatus,
  shouldDisableRenewalSubmit,
} from "@/lib/playerProfile/renewal";

type TranslateFn = (key: string, options?: Record<string, string | number>) => string;

interface UsePlayerRenewalOptions {
  player: PlayerData;
  canRenew: boolean;
  startWithRenewalModal: boolean;
  onGameUpdate?: (state: GameStateData) => void;
  t: TranslateFn;
}

export function usePlayerRenewal({
  player,
  canRenew,
  startWithRenewalModal,
  onGameUpdate,
  t,
}: UsePlayerRenewalOptions) {
  const [showRenewalModal, setShowRenewalModal] = useState(false);
  const [renewalWage, setRenewalWage] = useState("");
  const [renewalLength, setRenewalLength] = useState("2");
  const [renewalSubmitting, setRenewalSubmitting] = useState(false);
  const [renewalStatus, setRenewalStatus] = useState<RenewalStatus>("idle");
  const [renewalError, setRenewalError] = useState<string | null>(null);
  const [renewalSuggestedWage, setRenewalSuggestedWage] = useState<number | null>(null);
  const [renewalSuggestedYears, setRenewalSuggestedYears] = useState<number | null>(null);
  const [renewalSessionStatus, setRenewalSessionStatus] =
    useState<RenewalResponseData["session_status"]>("idle");
  const [renewalIsTerminal, setRenewalIsTerminal] = useState(false);
  const [renewalCooledOff, setRenewalCooledOff] = useState(false);
  const [renewalFeedback, setRenewalFeedback] = useState<NegotiationFeedbackData | null>(null);
  const [renewalProjection, setRenewalProjection] =
    useState<RenewalProjectionData["projection"] | null>(null);
  const [hasConsumedInitialRenewalIntent, setHasConsumedInitialRenewalIntent] = useState(false);

  const renewalOfferedWage = Number(renewalWage);
  const renewalOfferedYears = Number(renewalLength);
  const isRenewalWageValid = Number.isFinite(renewalOfferedWage) && renewalOfferedWage > 0;
  const isRenewalLengthValid = Number.isInteger(renewalOfferedYears) && renewalOfferedYears > 0;
  const renewalViolatesSoftCap =
    isRenewalWageValid && renewalProjection !== null && !renewalProjection.policy_allows;
  const renewalSubmitDisabled = shouldDisableRenewalSubmit({
    renewalSubmitting,
    renewalIsTerminal,
    isRenewalWageValid,
    isRenewalLengthValid,
    renewalViolatesSoftCap,
  });
  const renewalStatusMessage = getRenewalStatusMessage(
    {
      renewalSessionStatus,
      renewalStatus,
      renewalSuggestedWage,
      renewalSuggestedYears,
      renewalError,
    },
    t,
  );
  const renewalStatusClassName = getRenewalStatusClassName(renewalStatus);

  function openRenewalModal(): void {
    setRenewalWage(String(player.wage));
    setRenewalLength("2");
    setRenewalSubmitting(false);
    setRenewalStatus("idle");
    setRenewalError(null);
    setRenewalSuggestedWage(null);
    setRenewalSuggestedYears(null);
    setRenewalSessionStatus("idle");
    setRenewalIsTerminal(false);
    setRenewalCooledOff(false);
    setRenewalFeedback(null);
    setRenewalProjection(null);
    setShowRenewalModal(true);
  }

  function closeRenewalModal(): void {
    if (renewalSubmitting) return;
    setShowRenewalModal(false);
  }

  useEffect(() => {
    setHasConsumedInitialRenewalIntent(false);
  }, [player.id, startWithRenewalModal]);

  useEffect(() => {
    if (!canRenew || !startWithRenewalModal || showRenewalModal || hasConsumedInitialRenewalIntent) {
      return;
    }

    setHasConsumedInitialRenewalIntent(true);
    openRenewalModal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasConsumedInitialRenewalIntent, canRenew, showRenewalModal, startWithRenewalModal]);

  useEffect(() => {
    if (!showRenewalModal || !isRenewalWageValid) {
      setRenewalProjection(null);
      return;
    }

    let cancelled = false;

    const loadProjection = async (): Promise<void> => {
      try {
        const result = await invoke<RenewalProjectionData>("preview_renewal_financial_impact", {
          playerId: player.id,
          annualWage: renewalOfferedWage,
        });
        if (!cancelled) setRenewalProjection(result.projection ?? null);
      } catch {
        if (!cancelled) setRenewalProjection(null);
      }
    };

    void loadProjection();

    return () => {
      cancelled = true;
    };
  }, [isRenewalWageValid, player.id, renewalOfferedWage, showRenewalModal]);

  async function handleRenewalSubmit(): Promise<void> {
    if (renewalSubmitDisabled) return;

    setRenewalSubmitting(true);
    setRenewalStatus("idle");
    setRenewalError(null);
    setRenewalCooledOff(false);

    try {
      const result = await invoke<RenewalResponseData>("propose_renewal", {
        playerId: player.id,
        annualWage: renewalOfferedWage,
        contractYears: renewalOfferedYears,
      });

      onGameUpdate?.(result.game);
      setRenewalStatus(result.outcome);
      setRenewalSuggestedWage(result.suggested_wage);
      setRenewalSuggestedYears(result.suggested_years);
      setRenewalSessionStatus(result.session_status);
      setRenewalIsTerminal(result.is_terminal);
      setRenewalCooledOff(result.cooled_off ?? false);
      setRenewalFeedback(result.feedback ?? null);

      if (result.session_status === "blocked") setRenewalStatus("blocked");

      if (result.outcome === "counter_offer") {
        if (result.suggested_wage !== null) setRenewalWage(String(result.suggested_wage));
        if (result.suggested_years !== null) setRenewalLength(String(result.suggested_years));
      }
    } catch (error) {
      setRenewalStatus("error");
      setRenewalError(String(error));
      setRenewalCooledOff(false);
    } finally {
      setRenewalSubmitting(false);
    }
  }

  async function handleDelegateRenewal(): Promise<void> {
    if (renewalSubmitting) return;

    setRenewalSubmitting(true);
    setRenewalError(null);
    setRenewalCooledOff(false);

    try {
      const result = await invoke<DelegatedRenewalResponseData>("delegate_renewals", {
        playerIds: [player.id],
        maxWageIncreasePct: 35,
        maxContractYears: 3,
      });

      onGameUpdate?.(result.game);
      const delegatedCase: DelegatedRenewalCaseData | undefined = result.report.cases.find(
        (renewalCase) => renewalCase.player_id === player.id,
      );

      if (!delegatedCase) {
        setRenewalStatus("error");
        setRenewalError(t("playerProfile.renewalDelegateMissingReport"));
        return;
      }

      if (delegatedCase.status === "successful") {
        setRenewalStatus("accepted");
        setRenewalSessionStatus("agreed");
        setRenewalIsTerminal(true);
        setRenewalSuggestedWage(null);
        setRenewalSuggestedYears(null);
        setRenewalCooledOff(false);
        setRenewalFeedback(null);
        return;
      }

      const note = resolveBackendText(
        delegatedCase.note_key,
        delegatedCase.note,
        formatDelegatedNoteParams(delegatedCase.note_params),
      );

      if (delegatedCase.status === "stalled") {
        setRenewalStatus("rejected");
        setRenewalSessionStatus("stalled");
        setRenewalIsTerminal(false);
        setRenewalCooledOff(false);
        setRenewalFeedback(null);
        setRenewalError(note);
        return;
      }

      setRenewalStatus("blocked");
      setRenewalSessionStatus("blocked");
      setRenewalIsTerminal(true);
      setRenewalCooledOff(false);
      setRenewalFeedback(null);
      setRenewalError(note);
    } catch (error) {
      setRenewalStatus("error");
      setRenewalError(String(error));
      setRenewalCooledOff(false);
    } finally {
      setRenewalSubmitting(false);
    }
  }

  return {
    showRenewalModal,
    renewalWage,
    renewalLength,
    renewalIsTerminal,
    isRenewalWageValid,
    renewalViolatesSoftCap,
    renewalProjection,
    renewalStatusMessage,
    renewalStatusClassName,
    renewalCooledOff,
    renewalFeedback,
    renewalSubmitting,
    renewalSubmitDisabled,
    setRenewalWage,
    setRenewalLength,
    openRenewalModal,
    closeRenewalModal,
    handleRenewalSubmit,
    handleDelegateRenewal,
  };
}
