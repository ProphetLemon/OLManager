/** Codes the backend puts before the `|` of an import error. */
export const IMPORT_ERROR_CODES = [
  "too_small",
  "wrong_version",
  "corrupt",
  "storage",
  "id_taken",
] as const;

export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[number];

export interface ParsedTransferError {
  /** A known code, or `unknown` when the backend sent something else. */
  code: ImportErrorCode | "unknown";
  /** The backend text, useful only as detail for the unknown case. */
  message: string;
}

/** Backend errors arrive as `<code>|<message>`; anything else is unknown. */
export function parseTransferError(raw: unknown): ParsedTransferError {
  const text = typeof raw === "string" ? raw : raw instanceof Error ? raw.message : String(raw);
  const split = text.indexOf("|");
  if (split > 0) {
    const code = text.slice(0, split);
    if ((IMPORT_ERROR_CODES as readonly string[]).includes(code)) {
      return { code: code as ImportErrorCode, message: text.slice(split + 1) };
    }
  }
  return { code: "unknown", message: text };
}
