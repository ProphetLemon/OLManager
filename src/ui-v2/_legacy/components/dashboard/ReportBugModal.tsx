import { Bug, CheckCircle, Loader2 } from "lucide-react";
import { useState, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

import { exportBugReport } from "@/services/bugReportService";
import DashboardModalFrame from "@/ui-v2/_legacy/components/dashboard/DashboardModalFrame";

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
    <DashboardModalFrame maxWidthClassName="max-w-md">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-red-500 to-orange-500 text-white">
          <Bug className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-lg font-heading font-bold uppercase tracking-wide text-gray-900 dark:text-white">
            {t("bugReport.title", "Reportar Bug / Sugerir Mejora")}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t("bugReport.subtitle", "Compartí el archivo ZIP con el equipo de desarrollo")}
          </p>
        </div>
      </div>

      {status === "form" && (
        <>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("bugReport.placeholder", "Describí qué pasó, qué esperabas que pase, y cómo reproducirlo...")}
            className="mb-3 w-full rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800 placeholder-gray-400 dark:border-navy-600 dark:bg-navy-800 dark:text-gray-200 dark:placeholder-gray-500"
            rows={4}
          />

          <details className="mb-4">
            <summary className="cursor-pointer text-xs font-heading font-bold uppercase tracking-wider text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
              {t("bugReport.contextPreview", "Contexto que se incluirá")}
            </summary>
            <pre className="mt-2 rounded-lg bg-gray-50 p-3 text-xs text-gray-600 dark:bg-navy-800 dark:text-gray-400 overflow-x-auto">
{JSON.stringify({ description, ...context }, null, 2)}
            </pre>
          </details>

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 rounded-lg bg-gray-100 px-4 py-2.5 text-sm font-heading font-bold uppercase tracking-wider text-gray-700 transition-colors hover:bg-gray-200 dark:bg-navy-700 dark:text-gray-300 dark:hover:bg-navy-600"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={handleGenerate}
              disabled={description.trim().length === 0}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-red-500 to-orange-500 px-4 py-2.5 text-sm font-heading font-bold uppercase tracking-wider text-white transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Bug className="h-4 w-4" />
              {t("bugReport.generate", "Generar Reporte")}
            </button>
          </div>
        </>
      )}

      {status === "exporting" && (
        <div className="flex flex-col items-center gap-3 py-6">
          <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t("bugReport.exporting", "Generando archivo ZIP...")}
          </p>
        </div>
      )}

      {status === "done" && (
        <div className="flex flex-col items-center gap-3 py-4">
          <CheckCircle className="h-10 w-10 text-green-500" />
          <p className="text-sm font-heading font-bold text-gray-800 dark:text-gray-100">
            {t("bugReport.done", "Reporte generado con éxito")}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 text-center break-all">
            {zipPath}
          </p>
          <div className="flex gap-3 mt-2">
            <button
              onClick={handleOpenFolder}
              className="flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-heading font-bold uppercase tracking-wider text-white transition-colors hover:bg-primary-600"
            >
              {t("bugReport.openFolder", "Abrir ubicación")}
            </button>
            <button
              onClick={onClose}
              className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-heading font-bold uppercase tracking-wider text-gray-700 transition-colors hover:bg-gray-200 dark:bg-navy-700 dark:text-gray-300 dark:hover:bg-navy-600"
            >
              {t("common.close")}
            </button>
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="flex flex-col items-center gap-3 py-4">
          <p className="text-sm font-heading font-bold text-red-500">
            {t("bugReport.error", "Error al generar el reporte")}
          </p>
          <p className="text-xs text-red-400 text-center break-all">{error}</p>
          <button
            onClick={() => setStatus("form")}
            className="rounded-lg bg-primary-500 px-4 py-2 text-sm font-heading font-bold uppercase tracking-wider text-white transition-colors hover:bg-primary-600"
          >
            {t("common.retry")}
          </button>
        </div>
      )}
    </DashboardModalFrame>
  );
}
