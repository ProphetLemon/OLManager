// Reads the opt-in Leaguepedia bot-password credentials from a private env file.
// Nothing here ever echoes the password: errors name the file and the missing key only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const USER_KEY = "LEAGUEPEDIA_BOT_USER";
export const PASSWORD_KEY = "LEAGUEPEDIA_BOT_PASSWORD";
const SETUP_HINT = 'See the "Logging in" section of scripts/champions/README.md for the setup steps.';

export class CredentialsError extends Error {
  constructor(message) {
    super(message);
    this.name = "CredentialsError";
  }
}

export function defaultCredentialsPath() {
  return path.join(os.homedir(), ".config", "olmanager", "leaguepedia-bot.env");
}

/** Parses KEY=VALUE lines; blank lines and lines starting with # are ignored, whitespace is trimmed. */
export function parseCredentialsText(text) {
  const values = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    values[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return values;
}

/**
 * @param {string} [file] credentials path, injectable for tests
 * @param {{ platform?: string }} [options]
 * @returns {{ user: string, password: string }}
 */
export function readBotCredentials(file = defaultCredentialsPath(), options = {}) {
  const platform = options.platform ?? process.platform;
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    throw new CredentialsError(`Leaguepedia credentials file not found at ${file}. ${SETUP_HINT}`);
  }
  if (platform !== "win32" && (stat.mode & 0o077) !== 0) {
    throw new CredentialsError(`${file} is readable by other users. Run: chmod 600 ${file}`);
  }
  const values = parseCredentialsText(fs.readFileSync(file, "utf8"));
  for (const key of [USER_KEY, PASSWORD_KEY]) {
    if (!values[key]) throw new CredentialsError(`${file} has no ${key} line. ${SETUP_HINT}`);
  }
  return { user: values[USER_KEY], password: values[PASSWORD_KEY] };
}

/**
 * Shared --login step for the CLIs: read the credentials and log in once, before the first query.
 * Offline runs skip it without touching the file or the network.
 */
export async function loginFromFile(client, { file, log = () => {} } = {}) {
  if (client.offline) {
    log("--login skipped: offline mode makes no network requests");
    return false;
  }
  await client.login(readBotCredentials(file));
  log("Logged in to Leaguepedia with a bot password");
  return true;
}
