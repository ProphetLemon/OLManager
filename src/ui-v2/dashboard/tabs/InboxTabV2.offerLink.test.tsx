import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GameStateData, MessageData } from "@/store/gameStore";
import { DEFAULT_TAB_UI_STATES, useTabUiStore } from "@/store/tabUiStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    i18n: { language: "es" },
    t: (key: string) => key,
  }),
}));

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

function offerMessage(): MessageData {
  return {
    id: "offer_o1",
    subject: "Oferta recibida",
    body: "Cuerpo",
    sender: "Director de Fútbol",
    sender_role: "Director",
    date: "2027-01-10",
    read: true,
    category: "Transfer",
    priority: "High",
    actions: [
      {
        id: "view_offer",
        label: "Ver oferta",
        resolved: false,
        action_type: { NavigateTo: { route: "/dashboard?tab=Transfers&view=offers" } },
      },
    ],
    context: { team_id: null, player_id: null },
  } as unknown as MessageData;
}

describe("InboxTabV2 offer link", () => {
  beforeEach(() => {
    useTabUiStore.setState({ tabs: DEFAULT_TAB_UI_STATES });
  });

  it("opens the Transfers tab on the offers view", async () => {
    const { InboxTabV2 } = await import("./InboxTabV2");
    const onNavigate = vi.fn();
    const gs = { messages: [offerMessage()] } as unknown as GameStateData;
    render(
      <InboxTabV2
        gameState={gs}
        onGameUpdate={vi.fn()}
        initialMessageId="offer_o1"
        onNavigate={onNavigate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ver oferta" }));

    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith("Transfers", undefined));
    expect(useTabUiStore.getState().tabs.transfers.view).toBe("offers");
  });
});
