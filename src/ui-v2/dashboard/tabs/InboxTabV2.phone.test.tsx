import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { GameStateData } from "@/store/gameStore";

// The whole file runs as a phone: the tab reads the user agent while it renders.
vi.hoisted(() => {
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value: "Mozilla/5.0 (Linux; Android 14; CPH2449) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36",
  });
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const TEXT: Record<string, string> = {
  "common.search": "Buscar...",
  "inbox.selectMessage": "Selecciona un mensaje",
  "inbox.close": "Cerrar",
};

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({ i18n: { language: "es" }, t: (key: string) => TEXT[key] ?? key }),
}));

vi.mock("@/lib/i18n/backendI18n", () => ({
  resolveBackendText: (key?: string, fallback?: string) => fallback ?? key ?? "",
  resolveMessage: (v: unknown) => v,
}));

vi.mock("@/services/inboxService", () => ({
  markMessageRead: vi.fn().mockResolvedValue({}),
  markAllMessagesRead: vi.fn().mockResolvedValue({}),
  clearOldMessages: vi.fn().mockResolvedValue({}),
  deleteMessage: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/lib/inbox/helpers", () => ({
  getFilteredMessages: (messages: unknown[]) => messages,
  getNavigationTarget: () => ({ tab: "Home", context: {} }),
  isNavigateAction: () => false,
  sortInboxMessages: (messages: unknown[]) => messages,
  UNREAD_FILTER: "__unread__",
}));

const message = (id: string, subject: string) => ({
  id,
  subject,
  body: `Body of ${subject}`,
  sender: "Staff",
  date: "2026-03-29",
  read: true,
  category: "System",
  actions: [],
});

describe("InboxTabV2 on a phone", () => {
  it("shows the list or the open message, never both, and the message's back arrow returns to the list", async () => {
    const { InboxTabV2 } = await import("./InboxTabV2");
    const gs = { messages: [message("a", "First"), message("b", "Second")] } as unknown as GameStateData;
    render(<InboxTabV2 gameState={gs} onGameUpdate={vi.fn()} />);

    // Nothing open: the list alone, with no empty reading pane taking half the height.
    expect(screen.getByText("Second")).toBeInTheDocument();
    expect(screen.queryByText("Selecciona un mensaje")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("First"));

    // A message open: it has the whole area. The toolbar, the chips and the list are gone.
    expect(screen.getByRole("heading", { name: "First" })).toBeInTheDocument();
    expect(screen.queryByText("Second")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Buscar...")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));

    expect(screen.getByText("Second")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Buscar...")).toBeInTheDocument();
  });
});
