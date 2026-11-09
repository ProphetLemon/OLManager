import { Bug, CheckCircle, Loader2 } from "lucide-react";
import { useState, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

import { exportBugReport } from "@/services/bugReportService";
import { Button } from "@/ui-v2/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/ui-v2/components/ui/dialog";

interface ContextData {
  appVersion: string;
  route: string;
  activeTab: string;
  currentDate: string;
  dayPhase: string;
  teamName: string;
  leagueName: string;
  lolPatch: string;
}

interface ReportBugModalProps {
  context: ContextData;
  saveJson: string;
  onClose: () => void;
}

type Status = "form" | "exporting" | "done" | "error";

export default function ReportBugModal({
  context,
  saveJson,
  onClose,
}: ReportBugModalProps): JSX.Element {
  const { t } = useTranslation();
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<Status>("form");
  const [zipPath, setZipPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async (): Promise<void> => {
    setStatus("exporting");
    setError(null);
    try {
      const fullContext: ContextData & { description: string } = {
        ...context,
        description,
      };
      const path = await exportBugReport(
        JSON.stringify(fullContext, null, 2),
        saveJson,
      );
      setZipPath(path);
      setStatus("done");
    } catch (err) {
      setError(String(err));
      setStatus("error");
    }
  };

  const handleOpenFolder = async (): Promise<void> => {
    if (!zipPath) return;
    try {
      await revealItemInDir(zipPath);
    } catch {
      // Fallback: if reveal fails, the path is still shown in the modal
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent aria-modal="true">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-club text-club-foreground">
          <Bug className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <DialogTitle className="text-lg tracking-wide text-gray-900 dark:text-white">
            {t("bugReport.title", { defaultValue: "Report bug / suggest improvement" })}
          </DialogTitle>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t("bugReport.subtitle", { defaultValue: "Share the ZIP file with the development team" })}
          </p>
        </div>
      </div>

      {status === "form" && (
        <>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("bugReport.placeholder", { defaultValue: "Describe what happened, what you expected, and how to reproduce it..." })}
            className="mb-3 w-full rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800 placeholder-gray-400 dark:border-navy-600 dark:bg-navy-800 dark:text-gray-200 dark:placeholder-gray-500"
            rows={4}
            aria-label={t("bugReport.placeholder", { defaultValue: "Describe what happened, what you expected, and how to reproduce it..." })}
          />

          <details className="mb-4">
            <summary className="cursor-pointer text-xs font-heading font-bold uppercase tracking-wider text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
              {t("bugReport.contextPreview", { defaultValue: "Context that will be included" })}
            </summary>
            <pre className="mt-2 rounded-lg bg-gray-50 p-3 text-xs text-gray-600 dark:bg-navy-800 dark:text-gray-400 overflow-x-auto">
{JSON.stringify({ description, ...context }, null, 2)}
            </pre>
          </details>

          <div className="flex gap-3">
            <Button type="button" variant="secondary" size="touch" onClick={onClose} className="flex-1 font-heading font-bold uppercase tracking-wider">
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="club"
              size="touch"
              onClick={handleGenerate}
              disabled={description.trim().length === 0}
              className="flex-1 font-heading font-bold uppercase tracking-wider"
            >
              <Bug aria-hidden="true" />
              {t("bugReport.generate", { defaultValue: "Generate report" })}
            </Button>
          </div>
        </>
      )}

      {status === "exporting" && (
        <div className="flex flex-col items-center gap-3 py-6">
          <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t("bugReport.exporting", { defaultValue: "Generating ZIP file..." })}
          </p>
        </div>
      )}

      {status === "done" && (
        <div className="flex flex-col items-center gap-3 py-4">
          <CheckCircle className="h-10 w-10 text-green-500" />
          <p className="text-sm font-heading font-bold text-gray-800 dark:text-gray-100">
            {t("bugReport.done", { defaultValue: "Report generated successfully" })}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 text-center break-all">
            {zipPath}
          </p>
          <div className="flex gap-3 mt-2">
            <Button type="button" variant="club" size="touch" onClick={handleOpenFolder} className="font-heading font-bold uppercase tracking-wider">
              {t("bugReport.openFolder", { defaultValue: "Open location" })}
            </Button>
            <Button type="button" variant="secondary" size="touch" onClick={onClose} className="font-heading font-bold uppercase tracking-wider">
              {t("common.close")}
            </Button>
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="flex flex-col items-center gap-3 py-4">
          <p className="text-sm font-heading font-bold text-red-500">
            {t("bugReport.error", { defaultValue: "Failed to generate the report" })}
          </p>
          <p className="text-xs text-red-400 text-center break-all">{error}</p>
          <Button type="button" variant="club" size="touch" onClick={() => setStatus("form")} className="font-heading font-bold uppercase tracking-wider">
            {t("common.retry")}
          </Button>
        </div>
      )}
    </DialogContent>
    </Dialog>
  );
}
