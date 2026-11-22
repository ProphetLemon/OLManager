import { useTranslation } from "react-i18next";

import { LATEST_RELEASE_URL, openExternal } from "@/lib/openExternal";
import { Button } from "@/ui-v2/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/ui-v2/components/ui/dialog";

interface AndroidUpdateNoticeProps {
  onDismiss: () => void;
}

/**
 * Android launch notice: the updater manifest has a newer release but no Android entry,
 * so the player downloads the new APK from the release page instead.
 */
export default function AndroidUpdateNotice({ onDismiss }: AndroidUpdateNoticeProps) {
  const { t } = useTranslation();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <DialogContent className="space-y-4">
        <DialogTitle>{t("settings.updateAvailable")}</DialogTitle>
        <DialogDescription>
          {t("settings.androidUpdateAvailable")} {t("settings.androidUpdateKeepsSaves")}
        </DialogDescription>
        <DialogFooter className="flex-wrap justify-end">
          <Button type="button" variant="ghost" size="touch" onClick={onDismiss}>
            {t("settings.androidUpdateLater")}
          </Button>
          <Button
            type="button"
            variant="club"
            size="touch"
            onClick={() => openExternal(LATEST_RELEASE_URL)}
          >
            {t("settings.androidUpdateDownload")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
