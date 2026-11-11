import { useTranslation } from "react-i18next";

export type ResultKind = "win" | "loss" | "draw";

const LETTER_KEYS: Record<ResultKind, { key: string; fallback: string }> = {
  win: { key: "onAir.home.formWinLetter", fallback: "W" },
  loss: { key: "onAir.home.formLossLetter", fallback: "L" },
  draw: { key: "onAir.home.formDrawLetter", fallback: "D" },
};

const WORD_KEYS: Record<ResultKind, { key: string; fallback: string }> = {
  win: { key: "onAir.home.formWin", fallback: "Win" },
  loss: { key: "onAir.home.formLoss", fallback: "Loss" },
  draw: { key: "onAir.home.formDraw", fallback: "Draw" },
};

/** One-letter result badge in the app language; assistive technology reads the whole word. */
export function ResultLetter({ kind }: { kind: ResultKind }) {
  const { t } = useTranslation();
  return (
    <>
      <span aria-hidden="true">{t(LETTER_KEYS[kind].key, { defaultValue: LETTER_KEYS[kind].fallback })}</span>
      <span className="sr-only">{t(WORD_KEYS[kind].key, { defaultValue: WORD_KEYS[kind].fallback })}</span>
    </>
  );
}
