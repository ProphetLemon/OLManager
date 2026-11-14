import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { formatDate } from "@/lib/common/helpers";
import { Play, Clock, Trash2, X, Loader2, Download, Upload } from "lucide-react";
import type { SaveImportPreview } from "@/api/types";
import type { TransferNotice } from "./useSaveTransfer";
import { useRovingFocus } from "@/hooks/useRovingFocus";

interface SaveEntry {
  id: string;
  name: string;
  manager_name: string;
  db_filename: string;
  checksum: string;
  created_at: string;
  last_played_at: string;
}

interface SavesListProps {
  saves: SaveEntry[];
  isLoading: boolean;
  loadingSaveId?: string | null;
  confirmDeleteId: string | null;
  onLoad: (saveId: string) => void;
  onDelete: (saveId: string) => void;
  onConfirmDelete: (saveId: string | null) => void;
  onClose: () => void;
  onExport: (saveId: string) => void;
  onImport: () => void;
  onConfirmReplace: () => void;
  onCancelReplace: () => void;
  transferBusy: boolean;
  transferNotice: TransferNotice | null;
  pendingReplace: SaveImportPreview | null;
}

export default function SavesList({
  saves,
  isLoading,
  loadingSaveId,
  confirmDeleteId,
  onLoad,
  onDelete,
  onConfirmDelete,
  onClose,
  onExport,
  onImport,
  onConfirmReplace,
  onCancelReplace,
  transferBusy,
  transferNotice,
  pendingReplace,
}: SavesListProps) {
  const { t, i18n } = useTranslation();

  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const { activeIndex, handleKeyDown, getTabIndex } = useRovingFocus({
    itemCount: saves.length,
    columns: 1,
    loop: false,
    onSelect: (i) => onLoad(saves[i]?.id),
    getItemLabel: (i) => saves[i]?.name ?? "",
  });

  useEffect(() => {
    if (!isLoading && saves.length > 0) {
      itemRefs.current[activeIndex]?.focus();
    }
  }, [activeIndex, isLoading, saves.length]);

  return (
    <div className="flex flex-col" onKeyDown={handleKeyDown}>
      <div className="flex justify-between items-center pb-5">
        <h2 className="text-2xl font-heading font-bold uppercase tracking-wider text-white drop-shadow">
          {t("menu.loadGame")}
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onImport}
            disabled={transferBusy || isLoading}
            className="flex items-center gap-2 px-3 py-1.5 border border-white/20 text-gray-200 hover:border-white/40 hover:bg-white/5 disabled:opacity-50 text-sm font-heading font-bold uppercase tracking-wide rounded-lg transition-colors"
          >
            <Upload className="w-4 h-4" />
            {t("menu.transfer.import")}
          </button>
        <button
          type="button"
          onClick={onClose}
          className="text-gray-400 hover:text-white transition-colors p-2 rounded-lg hover:bg-white/10"
        >
          <X className="w-5 h-5" />
        </button>
        </div>
      </div>

      {pendingReplace && (
        <div role="alertdialog" className="flex flex-col gap-2 pb-4">
          <p className="text-sm text-gray-300">
            {t("menu.transfer.replacePrompt", { name: pendingReplace.name })}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onConfirmReplace}
              disabled={transferBusy}
              className="flex-1 py-2 border border-red-500/50 text-red-400 hover:border-red-500 hover:bg-red-500/10 text-sm font-heading font-bold uppercase tracking-wide rounded-lg transition-colors"
            >
              {t("menu.transfer.replace")}
            </button>
            <button
              type="button"
              onClick={onCancelReplace}
              className="flex-1 py-2 border border-white/20 text-gray-200 hover:border-white/40 hover:bg-white/5 text-sm font-heading font-bold uppercase tracking-wide rounded-lg transition-colors"
            >
              {t("menu.cancel")}
            </button>
          </div>
        </div>
      )}

      {transferNotice && (
        <p
          role={transferNotice.tone === "error" ? "alert" : "status"}
          className={`pb-4 text-sm ${transferNotice.tone === "error" ? "text-red-400" : "text-emerald-400"}`}
        >
          {transferNotice.text}
        </p>
      )}

      <div className="max-h-[60vh] overflow-y-auto overscroll-contain border-t border-white/10 scrollbar-v2">
        {isLoading ? (
          <div className="flex flex-col items-center gap-3 py-10 text-gray-400">
            <Loader2 className="w-8 h-8 animate-spin text-accent-400" />
            <span className="text-sm font-heading uppercase tracking-wider">
              {t("menu.loadingSaves")}
            </span>
          </div>
        ) : saves.length === 0 ? (
          <div className="text-gray-400 text-center py-10">
            {t("menu.noSaves")}
          </div>
        ) : (
          saves.map((save, i) => (
            <div
              key={save.id}
              className="group relative flex flex-col gap-2 w-full py-4 text-left transition-colors border-b border-white/10 hover:bg-white/5"
            >
              {confirmDeleteId === save.id ? (
                <div className="flex flex-col gap-2">
                  <p
                    className="text-sm text-gray-300"
                    dangerouslySetInnerHTML={{
                      __html: t("menu.deleteConfirm", { name: save.name }),
                    }}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => onDelete(save.id)}
                      className="flex-1 py-2 border border-red-500/50 text-red-400 hover:border-red-500 hover:bg-red-500/10 text-sm font-heading font-bold uppercase tracking-wider rounded-lg transition-colors"
                    >
                      {t("menu.delete")}
                    </button>
                    <button
                      onClick={() => onConfirmDelete(null)}
                      className="flex-1 py-2 border border-white/20 text-gray-200 hover:border-white/40 hover:bg-white/5 text-sm font-heading font-bold uppercase tracking-wider rounded-lg transition-colors"
                    >
                      {t("menu.cancel")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 w-full">
                  <button
                    ref={(el) => { itemRefs.current[i] = el; }}
                    tabIndex={getTabIndex(i)}
                    onClick={() => onLoad(save.id)}
                    className="flex flex-col gap-2 flex-1 text-left min-w-0 px-1"
                  >
                    <div className="flex justify-between items-center w-full">
                      <span className="font-heading font-bold text-white text-lg uppercase tracking-wide truncate">
                        {save.name}
                      </span>
                      {loadingSaveId === save.id ? (
                        <Loader2 className="w-4 h-4 text-accent-400 animate-spin shrink-0" />
                      ) : (
                        <Play className="w-4 h-4 text-accent-400 opacity-0 group-hover:opacity-100 transition-all shrink-0" />
                      )}
                    </div>
                    <div className="flex justify-between items-center w-full text-sm text-gray-400">
                      <span>
                        {t("menu.manager", { name: save.manager_name })}
                      </span>
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        <span>
                          {formatDate(save.last_played_at, i18n.language)}
                        </span>
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onExport(save.id);
                    }}
                    disabled={transferBusy}
                    className="p-1.5 rounded-lg text-gray-300 hover:text-white hover:bg-white/10 opacity-70 hover:opacity-100 focus-visible:opacity-100 transition-all shrink-0"
                    title={t("menu.transfer.export")}
                    aria-label={t("menu.transfer.export")}
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onConfirmDelete(save.id);
                    }}
                    className="p-1.5 rounded-lg text-gray-300 hover:text-red-400 hover:bg-red-500/10 opacity-70 hover:opacity-100 focus-visible:opacity-100 transition-all shrink-0"
                    title={t("menu.deleteSave")}
                    aria-label={t("menu.deleteSave")}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
