import type { RosterOverlay } from "./overlay-schema.mjs";

export const SOURCE_NAME: string;
export const SOURCE_URL: string;
export const OFFLINE_LICENSE: Readonly<{ text: string; url: string }>;
export function buildAttribution(license: { text: string; url: string }): string;
export function buildOverlay(input: {
  asOf: string;
  license: { text: string; url: string };
  coverage: string[];
  players: Array<{ op: Record<string, any> }>;
  staff: Array<{ op: Record<string, any> }>;
}): RosterOverlay;
export function todayUtc(): string;
export function serializeOverlay(overlay: unknown): string;
