import "@testing-library/jest-dom/vitest";

import { beforeEach } from "vitest";

// Node 22+ ships an experimental Web Storage global that, without a
// `--localstorage-file`, exposes an unusable `localStorage` and shadows the one
// jsdom provides (`localStorage.clear` is then undefined). Install an
// in-memory Storage whenever the ambient one is missing or broken.
function installStorageIfBroken(name: "localStorage" | "sessionStorage"): void {
  const current = (globalThis as Record<string, unknown>)[name] as Storage | undefined;
  if (current && typeof current.clear === "function") return;
  const data = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => (data.has(String(key)) ? (data.get(String(key)) as string) : null),
    key: (index) => Array.from(data.keys())[index] ?? null,
    removeItem: (key) => {
      data.delete(String(key));
    },
    setItem: (key, value) => {
      data.set(String(key), String(value));
    },
  };
  const targets: object[] = typeof window === "undefined" ? [globalThis] : [globalThis, window];
  for (const target of targets) {
    Object.defineProperty(target, name, { value: storage, configurable: true, writable: true });
  }
}

installStorageIfBroken("localStorage");
installStorageIfBroken("sessionStorage");

// Services call `getApiClientSync()`, which throws unless a client has been
// wired up. In production that happens via environment detection in
// `getApiClient()`; in tests we install the Tauri adapter directly. The adapter
// is imported lazily inside `beforeEach` (not at module top) so it resolves
// *after* each test file's `vi.mock("@tauri-apps/api/core")` has registered —
// setup files otherwise run before per-file mocks, binding the real `invoke`.
beforeEach(async () => {
  const { setApiClient } = await import("./api/client");
  const { tauriAdapter } = await import("./api/adapters/tauri.adapter");
  setApiClient(tauriAdapter);
});
