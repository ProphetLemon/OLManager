import { Menu } from "@base-ui/react/menu";
import { MoreHorizontal, Pause, Play, RotateCcw, SkipForward } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, buttonVariants } from "@/ui-v2/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/ui-v2/components/ui/dialog";
import { SegmentedControl } from "@/ui-v2/components/ui/segmented-control";
import { cn } from "@/ui-v2/lib/utils";

import "./liveMatch.css";

/** The speeds of the screen: the label, and the engine's own speed value (match seconds per second). */
export const SPEEDS = [
  { id: "x1", value: 4 },
  { id: "x2", value: 8 },
  { id: "x4", value: 16 },
  { id: "x8", value: 32 },
  { id: "x12", value: 48 },
] as const;

type Confirm = "skip" | "reset";

/** What each destructive choice says in its dialog. */
const CONFIRM_KEYS: Readonly<Record<Confirm, { title: string; body: string; action: string }>> = {
  skip: {
    title: "onAir.match.controls.skipTitle",
    body: "onAir.match.controls.skipBody",
    action: "onAir.match.controls.skipConfirm",
  },
  reset: {
    title: "onAir.match.controls.resetTitle",
    body: "onAir.match.controls.resetBody",
    action: "onAir.match.controls.resetConfirm",
  },
};

export interface MatchControlsProps {
  running: boolean;
  /** The engine's speed value, one of `SPEEDS`. */
  speed: number;
  /** After the winner, or while the rest of the match is being played: nothing can be pressed. */
  disabled?: boolean;
  onTogglePlay: () => void;
  onSpeedChange: (speed: number) => void;
  /** Confirmed skip: the rest of this same match is played at once and the result is shown. */
  onSkip: () => void;
  /** Confirmed reset: a new match from minute 0. */
  onReset: () => void;
}

/**
 * Pause and speed are the controls of the moment, so they sit in the open. Skip and Reset change
 * the match for good, so they live in the options menu and each asks first, in a modal dialog
 * (focus trap, inert page, Escape and return of focus come from the Dialog primitive). Cancel is
 * where focus lands, because it is the safe answer.
 */
export function MatchControls({
  running,
  speed,
  disabled = false,
  onTogglePlay,
  onSpeedChange,
  onSkip,
  onReset,
}: MatchControlsProps) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<Confirm | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const optionsRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const noteId = useId();
  const active = SPEEDS.find((entry) => entry.value === speed);
  const speedNote = active
    ? t("onAir.match.controls.speedNote", { count: active.value, label: active.id })
    : undefined;
  const confirmKeys = pending ? CONFIRM_KEYS[pending] : null;

  const confirm = () => {
    const choice = pending;
    setPending(null);
    if (choice === "skip") onSkip();
    else if (choice === "reset") onReset();
  };

  return (
    <section className="arena-controls" aria-label={t("match.liveControls")} data-testid="match-controls">
      <Button
        type="button"
        variant="club"
        size="touch"
        className="arena-play"
        disabled={disabled}
        onClick={() => onTogglePlay()}
      >
        {running ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        {running ? t("match.pause") : t("match.play")}
      </Button>

      <SegmentedControl
        ariaLabel={t("match.simSpeed")}
        className="arena-speed"
        describedBy={speedNote ? noteId : undefined}
        title={speedNote}
        value={String(speed)}
        onValueChange={(value) => onSpeedChange(Number(value))}
        options={SPEEDS.map((entry) => ({ value: String(entry.value), label: entry.id, disabled }))}
      />
      {/* Hidden by the stylesheet where the row is too narrow; it stays the speed group's description. */}
      {speedNote ? (
        <span id={noteId} className="arena-speed-note">
          {speedNote}
        </span>
      ) : null}

      <Menu.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <Menu.Trigger
          ref={optionsRef}
          aria-expanded={menuOpen}
          title={t("onAir.match.controls.options")}
          disabled={disabled}
          className={cn(buttonVariants({ variant: "ghost", size: "touch" }), "arena-options")}
        >
          <MoreHorizontal aria-hidden="true" />
          {/* Clipped, not removed, where the row is narrow: the button keeps its name and becomes an icon. */}
          <span className="arena-btn-label">{t("onAir.match.controls.options")}</span>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner align="end" sideOffset={4} className="z-50">
            <Menu.Popup className="min-w-48 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none">
              <Menu.Item
                onClick={() => setPending("skip")}
                className="flex min-h-[var(--hit)] cursor-default items-center gap-2 rounded-md px-3 text-sm outline-none data-[highlighted]:bg-muted data-[highlighted]:text-foreground [&_svg]:size-4"
              >
                <SkipForward aria-hidden="true" />
                {t("onAir.match.controls.skip")}
              </Menu.Item>
              <Menu.Item
                onClick={() => setPending("reset")}
                className="flex min-h-[var(--hit)] cursor-default items-center gap-2 rounded-md px-3 text-sm text-destructive outline-none data-[highlighted]:bg-destructive/10 [&_svg]:size-4"
              >
                <RotateCcw aria-hidden="true" />
                {t("onAir.match.controls.reset")}
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>

      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent
          role="alertdialog"
          aria-describedby="arena-confirm-body"
          initialFocus={cancelRef}
          finalFocus={() => (optionsRef.current?.isConnected ? optionsRef.current : true)}
        >
          {confirmKeys ? (
            <>
              <DialogTitle className="text-lg text-foreground">{t(confirmKeys.title)}</DialogTitle>
              <p id="arena-confirm-body" className="mt-2 text-sm text-muted-foreground">
                {t(confirmKeys.body)}
              </p>
              <DialogFooter className="mt-6 flex-col sm:flex-row sm:justify-end">
                <Button ref={cancelRef} type="button" variant="outline" size="touch" onClick={() => setPending(null)}>
                  {t("match.cancel")}
                </Button>
                <Button
                  type="button"
                  variant={pending === "reset" ? "destructive" : "club"}
                  size="touch"
                  onClick={confirm}
                >
                  {t(confirmKeys.action)}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
