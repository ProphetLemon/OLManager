import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/** The same strip the scrim result notice uses, shown while the last save failed and the game is not on disk. */
export function AutoSaveFailedNotice({ failed, failCount }: { failed: boolean; failCount: number }) {
  const { t } = useTranslation();
  const sentence = t("onAir.bar.autoSaveFailed", {
    defaultValue: "Auto-save failed. Press Save to keep your progress.",
  });
  // Cleared, then set again on every failure: a text that does not change is not spoken twice.
  const [spoken, setSpoken] = useState("");
  useEffect(() => {
    setSpoken("");
    if (!failed) return;
    const timer = window.setTimeout(() => setSpoken(sentence), 100);
    return () => window.clearTimeout(timer);
  }, [failed, failCount, sentence]);

  return (
    <>
      <div role="status" aria-live="polite" className="sr-only" data-slot="auto-save-failed-live">
        {spoken}
      </div>
      {failed ? (
        <section
          data-slot="auto-save-failed-notice"
          className="flex shrink-0 items-center gap-2 border-b border-line bg-secondary px-4 py-2 text-sm text-foreground"
        >
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-warning" />
          <p className="min-w-0">{sentence}</p>
        </section>
      ) : null}
    </>
  );
}
