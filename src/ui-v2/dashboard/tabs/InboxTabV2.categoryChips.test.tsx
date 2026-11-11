import { render, screen } from "@testing-library/react";
import i18next from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import type { GameStateData } from "@/store/gameStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

vi.mock("@/lib/i18n/backendI18n", () => ({
  resolveBackendText: (_key?: string, fallback?: string) => fallback ?? "",
  resolveMessage: (v: unknown) => v,
}));

vi.mock("@/services/inboxService", () => ({
  markMessageRead: vi.fn().mockResolvedValue({}),
  markAllMessagesRead: vi.fn().mockResolvedValue({}),
  clearOldMessages: vi.fn().mockResolvedValue({}),
  deleteMessage: vi.fn().mockResolvedValue({}),
  resolveMessageAction: vi.fn().mockResolvedValue({ game: { messages: [] } }),
}));

function message(id: string, category: string) {
  return {
    id,
    subject: `Subject ${id}`,
    body: "Body",
    sender: "Board",
    sender_role: null,
    sender_icon: null,
    date: "2027-01-10",
    read: true,
    category,
    priority: "Normal",
    actions: [],
  };
}

async function renderInbox(language: "en" | "es") {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    lng: language,
    resources: { en: { translation: en }, es: { translation: es } },
    interpolation: { escapeValue: false },
  });
  const { InboxTabV2 } = await import("./InboxTabV2");
  const gs = {
    messages: [
      message("m1", "Training"),
      message("m2", "Training"),
      message("m3", "MatchResult"),
    ],
  } as unknown as GameStateData;
  render(
    <I18nextProvider i18n={instance}>
      <InboxTabV2 gameState={gs} onGameUpdate={vi.fn()} />
    </I18nextProvider>,
  );
}

describe("InboxTabV2 category filter chips", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("shows the Spanish label for a Training message in a Spanish render", async () => {
    await renderInbox("es");
    expect(screen.getByRole("button", { name: "Entrenamiento (2)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resultado (1)" })).toBeInTheDocument();
    expect(screen.queryByText("Training (2)")).not.toBeInTheDocument();
  });

  it("labels and counts the first chip like the others in a Spanish render", async () => {
    await renderInbox("es");
    expect(screen.getByRole("button", { name: "Todos (3)" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^All/ })).not.toBeInTheDocument();
  });

  it("shows the English label for a Training message in an English render", async () => {
    await renderInbox("en");
    const label = en.inbox.categories.training;
    expect(screen.getByRole("button", { name: `${label} (2)` })).toBeInTheDocument();
  });

  it("gives the filter chips and the search input the minimum target height", async () => {
    await renderInbox("en");
    expect(screen.getByRole("button", { name: /^All/ })).toHaveClass("min-h-[var(--target-min)]");
    expect(screen.getByRole("button", { name: /Training \(2\)/ })).toHaveClass("min-h-[var(--target-min)]");
    expect(screen.getByRole("textbox")).toHaveClass("min-h-[var(--target-min)]");
  });
});
