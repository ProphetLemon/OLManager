export const PUBLIC_KEY_FILE: string;
export const DEFAULT_KEY_PATH: string;
export function resolveKeyPath(env?: Record<string, string | undefined>): string;
export function publicKeyFromPrivatePem(pem: string): string;
export function fingerprint(publicKeyBase64: string): string;
export function generateKeypair(keyPath: string): { created: boolean; publicKey: string };
export function signBytes(bytes: Uint8Array, privatePem: string): string;
export function verifyBytes(bytes: Uint8Array, signatureBase64: string, publicKeyBase64: string): boolean;
export function signOverlayFile(file: string, privatePem: string): string;
export function verifyOverlayFile(
  file: string,
  publicKeyBase64: string,
): { ok: true } | { ok: false; reason: "missing-signature" | "invalid-signature" };
