import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { APP_EDITION } from "@/lib/common/edition";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    i18n: { language: "es" },
    t: (key: string) => (key === "titleBar.appName" ? "OL Manager" : key),
  }),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: () => Promise.resolve(false),
    onResized: () => Promise.resolve(() => {}),
  }),
}));

describe("TitleBarV2", () => {
  it("shows the app name followed by the edition", async () => {
    const { TitleBarV2 } = await import("./TitleBarV2");
    render(<TitleBarV2 />);

    expect(screen.getByText("OL Manager")).toBeInTheDocument();
    expect(screen.getByText(APP_EDITION)).toBeInTheDocument();
  });
});
