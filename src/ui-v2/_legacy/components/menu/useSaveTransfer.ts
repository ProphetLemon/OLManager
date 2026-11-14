import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SaveImportPreview, SaveRepository } from "@/api/types";
import { parseTransferError } from "@/lib/menu/saveTransfer";

export interface TransferNotice {
  tone: "success" | "error";
  text: string;
}

/**
 * Export and import of save files for the saves list. The native picker and the
 * file access sit behind `saves`; this only sequences the calls and words the result.
 */
export function useSaveTransfer(
  getSaves: () => SaveRepository,
  onImported: () => void | Promise<void>,
) {
  const { t } = useTranslation();
  // The client only exists once the app has initialized it, so it is resolved per call.
  const getSavesRef = useRef(getSaves);
  getSavesRef.current = getSaves;
  const onImportedRef = useRef(onImported);
  onImportedRef.current = onImported;
  const [notice, setNotice] = useState<TransferNotice | null>(null);
  const [pendingReplace, setPendingReplace] = useState<SaveImportPreview | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = useCallback(
    (error: unknown) => {
      const { code, message } = parseTransferError(error);
      setNotice({
        tone: "error",
        text:
          code === "unknown"
            ? t("menu.transfer.error.unknown", { error: message })
            : t(`menu.transfer.error.${code}`),
      });
    },
    [t],
  );

  const store = useCallback(
    async (replace: boolean) => {
      const entry = await getSavesRef.current().confirmImport(replace);
      setPendingReplace(null);
      setNotice({ tone: "success", text: t("menu.transfer.imported", { name: entry.name }) });
      await onImportedRef.current();
    },
    [t],
  );

  const exportSave = useCallback(
    async (saveId: string) => {
      setBusy(true);
      setNotice(null);
      try {
        const target = await getSavesRef.current().exportToFile(saveId);
        if (target !== null) setNotice({ tone: "success", text: t("menu.transfer.exported") });
      } catch (error) {
        fail(error);
      } finally {
        setBusy(false);
      }
    },
    [t, fail],
  );

  const startImport = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    try {
      const preview = await getSavesRef.current().pickImport();
      if (preview === null) return;
      if (preview.replaces) setPendingReplace(preview);
      else await store(false);
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  }, [store, fail]);

  const confirmReplace = useCallback(async () => {
    setBusy(true);
    try {
      await store(true);
    } catch (error) {
      setPendingReplace(null);
      fail(error);
    } finally {
      setBusy(false);
    }
  }, [store, fail]);

  const cancelReplace = useCallback(async () => {
    setPendingReplace(null);
    try {
      await getSavesRef.current().cancelImport();
    } catch (error) {
      fail(error);
    }
  }, [fail]);

  return { notice, pendingReplace, busy, exportSave, startImport, confirmReplace, cancelReplace };
}
