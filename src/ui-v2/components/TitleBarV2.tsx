import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";

import { APP_EDITION } from "@/lib/common/edition";

export function TitleBarV2() {
  const { t } = useTranslation();
  const [maximized, setMaximized] = useState(false);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const win = getCurrentWindow();
    win.isMaximized().then(setMaximized);
    const unlisten = win.onResized(async () => setMaximized(await win.isMaximized()));
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const handleMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button")) return;
    dragStart.current = { x: e.screenX, y: e.screenY };
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!dragStart.current) return;
    const dx = e.screenX - dragStart.current.x;
    const dy = e.screenY - dragStart.current.y;
    // Start dragging only after the mouse has actually moved
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      dragStart.current = null;
      getCurrentWindow().startDragging().catch(() => {});
    }
  };

  const handleMouseUp = () => {
    dragStart.current = null;
  };

  const handleDoubleClick = () => {
    dragStart.current = null;
    getCurrentWindow().toggleMaximize().catch(() => {});
  };

  const handleMinimize = async () => { try { await getCurrentWindow().minimize(); } catch {} };
  const handleMaximize = async () => { try { await getCurrentWindow().toggleMaximize(); } catch {} };
  const handleClose = async () => { try { await getCurrentWindow().destroy(); } catch {} };

  return (
    <div
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onDoubleClick={handleDoubleClick}
      className="flex h-9 shrink-0 items-center justify-between bg-zinc-950 px-3 select-none"
    >
      {/* App title */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <img src="/logo.webp" alt={t("titleBar.appLogoAlt")} className="size-5 object-contain" />
        <span className="font-heading text-xs font-bold uppercase tracking-widest text-muted-foreground">
          {t("titleBar.appName")}
        </span>
        <span aria-hidden="true" className="text-xs text-muted-foreground/60">
          ·
        </span>
        <span className="truncate font-heading text-xs font-bold uppercase tracking-widest text-primary">
          {APP_EDITION}
        </span>
      </div>

      {/* OS window controls */}
      <div className="ml-auto flex items-center">
        <button
          type="button"
          onClick={handleMinimize}
          className="flex h-9 w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-zinc-800 hover:text-foreground"
          aria-label={t("titleBar.minimize")}
        >
          <Minus className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={handleMaximize}
          className="flex h-9 w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-zinc-800 hover:text-foreground"
          aria-label={t(maximized ? "titleBar.restore" : "titleBar.maximize")}
        >
          {maximized ? <MinimizeIcon className="size-3.5" /> : <Square className="size-3" />}
        </button>
        <button
          type="button"
          onClick={handleClose}
          className="flex h-9 w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-negative hover:text-negative-foreground"
          aria-label={t("titleBar.close")}
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

function MinimizeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
      <path d="M5 8h6" />
    </svg>
  );
}
