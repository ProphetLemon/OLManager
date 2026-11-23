import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { dismissOverlayWithBack } from "@/ui-v2/palette/paletteHistory";
import MainMenu from "./MainMenu";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));
vi.mock("@/api/client", () => ({
  getApiClientSync: () => ({
    saves: { list: vi.fn(() => Promise.resolve([])) },
    serverCommands: { debugLog: vi.fn(() => Promise.resolve()) },
  }),
  setApiClient: () => {},
}));
vi.mock("@/ui-v2/_legacy/components/menu/MenuBackground", () => ({ default: () => null }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

// Guards the claim that the phone work leaves a non-phone user agent on the original layout.
describe("MainMenu off the phone", () => {
  it("keeps all six items in the nav and the absolutely placed version label", () => {
    render(
      <MemoryRouter>
        <MainMenu />
      </MemoryRouter>,
    );

    expect(within(screen.getByRole("navigation")).getAllByRole("button")).toHaveLength(6);
    expect(screen.getByText(/app\.version/).className).toMatch(/(^|\s)absolute(\s|$)/);
    expect(document.querySelector("[data-menu-column]")).toBeNull();
  });

  it("keeps the centred, padded panel wrapper and registers no Back dismisser", async () => {
    render(
      <MemoryRouter>
        <MainMenu />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "menu.community" }));
    const heading = await screen.findByRole("heading", { name: "community.title" });

    expect(heading.closest(".overflow-y-auto")).toHaveClass("justify-center", "p-6");
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    expect(dismissOverlayWithBack()).toBe(false);
  });
});
