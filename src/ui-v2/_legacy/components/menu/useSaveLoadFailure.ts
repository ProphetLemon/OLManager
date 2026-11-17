import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { parseLoadError } from "@/lib/menu/saveTransfer";
import type { TransferNotice } from "./useSaveTransfer";

/**
 * Words a failed load for the saves list and refreshes the list, so a save the
 * backend refused shows the status it really has instead of failing silently.
 */
export function useSaveLoadFailure(onRefresh: () => void | Promise<void>) {
  const { t } = useTranslation();
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  const [notice, setNotice] = useState<TransferNotice | null>(null);

  const report = useCallback(
    async (error: unknown) => {
      const parsed = parseLoadError(error);
      const text =
        parsed.kind === "incompatible"
          ? t("menu.saveStatus.otherVersionReason", { found: parsed.found ?? "?" })
          : parsed.kind === "unreadable"
            ? t("menu.saveStatus.unreadableReason")
            : t("menu.loadFailed", { error: parsed.message });
      setNotice({ tone: "error", text });
      try {
        await onRefreshRef.current();
      } catch (refreshError) {
        console.error("Failed to refresh the saves list:", refreshError);
      }
    },
    [t],
  );

  const clear = useCallback(() => setNotice(null), []);

  return { notice, report, clear };
}
