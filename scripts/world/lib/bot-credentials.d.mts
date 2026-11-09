import type { MediaWikiClient } from "./mediawiki-client.mjs";

export const USER_KEY: string;
export const PASSWORD_KEY: string;
export class CredentialsError extends Error {}
export function defaultCredentialsPath(): string;
export function parseCredentialsText(text: string): Record<string, string>;
export function readBotCredentials(file?: string, options?: { platform?: string }): { user: string; password: string };
export function loginFromFile(client: MediaWikiClient, options?: { file?: string; log?: (message: string) => void }): Promise<boolean>;
